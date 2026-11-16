// Recognises what went wrong from git's output, so the user is offered the right way out
// (src/extension/git/recovery.ts). No VS Code dependency: unit-tested on real git messages.
// Git runs with LC_ALL=C (see runner.ts), so its messages are in English.

export type ProblemKind =
  /** Index lock left by another (or a crashed) git process. */
  | "lock"
  /** user.name / user.email missing. */
  | "identity"
  /** gpg / ssh signing of the commit failed. */
  | "signing"
  /** SSH host key unknown or changed. */
  | "hostKey"
  | "auth"
  /** The server refused the push: protected branch, server hook, permissions. */
  | "remoteRejected"
  /** Force-with-lease refused: the remote branch moved since the last fetch. */
  | "staleLease"
  /** Push rejected: the remote branch has commits that are not here. */
  | "pushRejected"
  | "network"
  /** The upstream branch was deleted on the remote. */
  | "upstreamGone"
  | "noUpstream"
  | "detachedHead"
  | "noRemote"
  /** A merge, rebase, cherry-pick or revert is unfinished. */
  | "operationInProgress"
  /** The operation stopped on conflicts. */
  | "conflict"
  /** Untracked files would be overwritten. */
  | "untrackedOverwritten"
  /** Uncommitted changes would be overwritten, or forbid the operation. */
  | "localChanges"
  /** The commit to apply brings nothing new (cherry-pick / rebase / revert). */
  | "emptyCommit"
  | "nothingToCommit"
  | "unrelatedHistories"
  | "branchExists"
  /** The branch is checked out in another worktree. */
  | "checkedOutElsewhere"
  /** A local hook (pre-commit, commit-msg, pre-push…) failed. */
  | "hookFailed"
  | "unknownRevision"
  | "other";

export interface Problem {
  kind: ProblemKind;
  /** The most useful line of the message, for the notification. */
  summary: string;
  /** Files named by the message (local changes or untracked files in the way). */
  files: string[];
  /** Lock file path for "lock". */
  lockFile?: string;
}

/** Ordered: the first match wins, so specific messages come before generic ones. */
const RULES: [ProblemKind, RegExp][] = [
  ["lock", /Unable to create '[^']*\.lock'|\.lock': File exists/],
  ["identity", /Please tell me who you are|empty ident name|unable to auto-detect email/],
  [
    "signing",
    /gpg failed to sign|cannot run gpg|failed to sign the data|error: (?:couldn't|could not) sign/i,
  ],
  ["hostKey", /Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/],
  [
    "auth",
    /Authentication failed|could not read (?:Username|Password)|terminal prompts disabled|Permission denied \(publickey|HTTP Basic: Access denied|returned error: 40[13]\b|Invalid username or password|Access denied|Incorrect username or password/i,
  ],
  [
    "remoteRejected",
    /\[remote rejected\]|pre-receive hook declined|protected branch|You are not allowed to push|GH006|GH013/,
  ],
  ["staleLease", /\(stale info\)/],
  [
    "pushRejected",
    /\[rejected\][^\n]*\((?:fetch first|non-fast-forward)\)|Updates were rejected because/,
  ],
  [
    "network",
    /Could not resolve host|Failed to connect|Connection (?:timed out|refused|reset)|Network is unreachable|Could not read from remote repository|unable to access '|early EOF|RPC failed|SSL certificate problem|Operation timed out/i,
  ],
  [
    "upstreamGone",
    /couldn't find remote ref|no such ref was fetched|upstream branch .* (?:no longer exists|does not exist)/i,
  ],
  ["noUpstream", /has no upstream branch|no tracking information/],
  ["detachedHead", /You are not currently on a branch|HEAD is detached/],
  [
    "noRemote",
    /No configured push destination|does not appear to be a git repository|has no remote|No remote repository specified/,
  ],
  [
    "operationInProgress",
    /You have not concluded your|MERGE_HEAD exists|resolve your current index first|is not possible because you have unmerged files|already a rebase-(?:merge|apply) directory|(?:cherry-pick|revert) is already in progress|You are in the middle of|A (?:merge|rebase|cherry-pick|revert) is in progress/,
  ],
  [
    "conflict",
    /^CONFLICT \(|Automatic merge failed|could not apply|Resolve all conflicts manually|after resolving the conflicts|fix conflicts and then commit|could not revert|Applying autostash resulted in conflicts|conflicts? in the working tree/m,
  ],
  ["untrackedOverwritten", /untracked working tree files would be (?:overwritten|removed)/],
  [
    "localChanges",
    /Your local changes to the following files would be overwritten|Please commit your changes or stash them|You have unstaged changes|Your index contains uncommitted changes|cannot (?:pull|rebase) with rebase|contains uncommitted changes/,
  ],
  [
    "emptyCommit",
    /is now empty|previous cherry-pick is now empty|No changes - did you forget to use 'git add'/,
  ],
  ["nothingToCommit", /nothing to commit|no changes added to commit|nothing added to commit/],
  ["unrelatedHistories", /refusing to merge unrelated histories/],
  ["branchExists", /a branch named '[^']+' already exists|reference already exists/],
  ["checkedOutElsewhere", /is already (?:checked out|used by worktree) at/],
  ["hookFailed", /\bhook\b.*(?:failed|exit|declined)|husky/i],
  [
    "unknownRevision",
    /unknown revision|not a valid object name|invalid reference|did not match any file|not a commit|bad revision/,
  ],
];

/** The first `error:` / `fatal:` / `remote:` line, else the first non-empty line. */
export function summaryLine(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const pick =
    lines.find((l) => /^(?:fatal|error):/.test(l) && !/failed to push some refs/.test(l)) ??
    lines.find((l) => /^remote:\s*\S/.test(l) && !/^remote:\s*(?:=+|-+)\s*$/.test(l)) ??
    lines.find((l) => /^CONFLICT/.test(l)) ??
    lines[0] ??
    "";
  return pick.replace(/^(?:fatal|error|remote):\s*/, "").slice(0, 300);
}

/** Files listed under "…would be overwritten by checkout:" (tab-indented by git). */
export function listedFiles(text: string): string[] {
  const files: string[] = [];
  let inList = false;
  for (const line of text.split("\n")) {
    if (/following (?:untracked working tree )?files would be (?:overwritten|removed)/.test(line)) {
      inList = true;
      continue;
    }
    if (inList && /^\t\S/.test(line)) files.push(line.trim());
    else if (inList) inList = false;
  }
  return [...new Set(files)];
}

/** Messages a remote sends ("remote: …" lines), e.g. why a protected branch refused a push. */
export function remoteMessages(text: string): string[] {
  return text
    .split("\n")
    .map((l) => /^remote:\s*(.*)$/.exec(l.trim())?.[1]?.trim() ?? "")
    .filter((l) => l && !/^[=-]+$/.test(l) && !/^To create a merge request/.test(l));
}

export function classify(text: string): Problem {
  const kind = RULES.find(([, re]) => re.test(text))?.[0] ?? "other";
  const lockFile = kind === "lock" ? /Unable to create '([^']*\.lock)'/.exec(text)?.[1] : undefined;
  return { kind, summary: summaryLine(text), files: listedFiles(text), lockFile };
}

/** Text to classify from anything thrown: our GitError, the Git extension's error, an Error. */
export function errorText(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const parts: string[] = [];
    for (const x of [o.stderr, o.stdout, o.message])
      if (typeof x === "string" && x.trim() && !parts.some((p) => p.includes(x.trim())))
        parts.push(x);
    return parts.join("\n");
  }
  return String(e);
}
