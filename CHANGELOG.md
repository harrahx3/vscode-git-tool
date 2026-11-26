# Changelog

## Unreleased

- _Update (Fast-Forward)_ updates a local branch from its upstream without checking it out:
  it fetches, then moves the branch forward if it has no commits of its own. Right-click a
  branch in the Branches view or the Log, pick it in the Branches popup, or select several
  branches in the Branches view for _Update Selected (Fast-Forward)_. Diverged branches and
  branches checked out in another worktree are reported and left alone; the current branch is
  pulled as usual.
- A hook can now ask a yes/no question although git runs it without a terminal: it prints
  `GIT_HOOK_CONFIRM: <question>` after its warnings and exits non-zero. The extension shows the
  question and the warnings in a dialog, and _Push Anyway_ (or _Commit Anyway_…) runs the
  command again with `GIT_HOOK_CONFIRMED=1`. See _Hooks that ask a question_ in the README.
- Resolve Conflicts now handles a file that one side deleted or renamed (_deleted by us_ /
  _deleted by them_, _added by us_ / _added by them_): instead of failing to open an editor,
  it asks whether to keep the surviving version or delete the file. _Accept Ours_ and _Accept
  Theirs_ in the Changes view do the same, and remove the file when that side deleted it.
- Pull warns before it starts when uncommitted changes touch files the incoming commits also
  change (renames and deletions included), the usual cause of a conflict when the stashed
  changes are re-applied. You can cancel and commit or roll back those files first.
- After resolving a conflict left by the autostash of a pull, _Mark Resolved_ / _Continue_
  offers to drop that stale stash.

## 1.2.0 — 2026-11-24

- New setting `gitTool.workspaceScope`: in a workspace with several repositories, choose
  whether the Commit, Branches, Merge Requests, Issues and Worktrees views show only the active
  repository (`active`, the default, as before) or every repository (`all`), one section per
  repository. Commit then commits the ticked files of each repository with the same message.

## 1.1.0 — 2026-11-23

- **New Tag** now creates a local tag only and no longer offers to push it. Push it later with
  _Push Tag_ in the right-click menu.
- Tags that exist only locally are drawn with a dashed border in the Log (tooltip: local only)
  and marked _local only_ in the Branches view. This relies on `git ls-remote`, cached for a
  minute; when the remote cannot be reached, no tag is flagged.

## 1.0.1 — 2026-11-16

- The changelog of 1.0.0 now lists every change of that release; the first 1.0.0 package
  left several out. No change to the extension itself.

## 1.0.0 — 2026-11-16

- Published on GitHub and the Visual Studio Marketplace under the MIT license, as
  _Git Changelists & Log_. The extension ID is now `harrahx3.vscode-git-tool`:
  uninstall a build installed earlier from a `.vsix` with another ID, or both run side by side.
- The command palette category, the activity-bar icon, the settings section and the output
  channel are now called _Git Changelists & Log_ too. Settings (`gitTool.*`) and command IDs are
  unchanged.
- _Update Project_ is now called _Pull_ everywhere (title bar, Log toolbar, progress messages,
  the _Pull and Push_ fix of a rejected push). Same behaviour: fetch, then merge or rebase per
  `gitTool.updateMethod`, with local changes stashed around it.
- **Commit view**: the changed files are now right under the commit message, Amend and Commit
  buttons, in a single view. It keeps changelists (foldable, active one marked), a checkbox per
  file and per changelist, Git status colors, a click for the diff (merge editor for
  conflicts), hover buttons (Open File, Rollback, Delete, Resolve), multi-selection with
  Ctrl/Shift+click and the keyboard, right-click menus, drag and drop between changelists and
  the change-count badge. The title-bar buttons (Continue / Abort / Resolve, Rollback, Refresh,
  New Changelist, Stash) are on this view.
- **Branches view** in the side bar: HEAD first (current branch or "detached at <commit>", with
  ahead/behind counts), then Local, Remote and Tags with folders on "/". A click shows the branch
  in the Log; hover buttons for Checkout and Compare with Current; right-click for Checkout, New
  Branch, Compare, Show History, Rebase, Merge, Push, Rename and Delete. On a multi-selection:
  Compare Selected Branches and Delete Selected….
- **Compare view**, like PyCharm's _Compare with Current_: the commits only on each side and the
  files that differ between the two tips, with diffs; Swap, Refresh and Close in the title bar.
- **Log**: New Branch, Checkout and Compare Branches buttons in the toolbar. Several commits can be
  selected (Ctrl/Cmd+click, Shift+click, Shift+arrows, Ctrl/Cmd+A) to compare two commits, copy
  their hashes, cherry-pick or revert them. New Branch and Checkout have distinct icons.
- **Worktrees view**: every working tree of the repository, with its branch or commit and the
  current, main, locked and missing ones marked. Open (switch), Open in New Window, Add to
  Workspace, New Worktree… (also _Check Out in New Worktree…_ from the Branches view and the
  Log), Delete Worktree… with confirmations, Prune Missing Worktrees, and a _Switch Worktree…_
  quick pick.
- **Open in Browser** for the repository, a branch or tag, a commit, a file with the selected
  lines (or _Copy Link to File_) and a file changed by a commit, on GitLab (self-hosted too),
  GitHub and Bitbucket. _Open Merge Request_ finds the merge request of a branch or the ones that
  contain a commit; _Create Merge Request…_ opens the "new merge request" page and offers to push
  the branch first.
- **Merge Requests view** (merge requests on GitLab, pull requests on GitHub): expand one to see
  its changed files with diffs; check it out, compare it, open it or copy its link. **Issues
  view**: open issues of the remote, open in the browser, copy the link, or create a branch named
  `<number>-<title>`. API access is read-only and uses a token kept in VS Code's secret storage,
  VS Code's GitHub sign-in, or the `glab` / `gh` command-line tools.
- Merge Requests and Issues views: one flat list instead of the _Current Branch_, _Assigned to
  Me_, _Created by Me_ and _All Open_ groups. A _Sort By…_ title button orders it by last update
  (default), creation date, creator, assignee, title or number; the choice is remembered per
  view. The current branch's merge request is marked _current branch_ in its row.
- Merge Requests and Issues views on a GitHub remote: a missing `gh` command-line tool no
  longer fails with `spawn gh EACCES` (a Windows folder on the WSL PATH makes Node report a
  permission error instead of "not found"). The views now offer "Sign In / Set Access
  Token…" as they do when `gh` is absent.
- **Recovery from git errors**: a failed command now says what went wrong and offers the way out.
  Stash and Retry or Force Checkout when local changes are in the way; Resolve Conflicts (merge
  editor) or Abort for a merge, rebase, cherry-pick, revert or unstash, with Continue / Skip /
  Abort buttons while it is in progress; Retry or Run in Terminal for authentication and SSH host
  keys; Pull and Push or Force Push (with lease) for a rejected push, with the server's reason;
  and clear messages for a missing upstream, remote or identity, a detached HEAD, failed signing,
  a stale `index.lock`, unrelated histories, network errors and more.
- **Hooks**: when a pre-commit or pre-push hook refuses, a report opens beside the editor (with
  `file:line` findings linked to their lines), the findings go to the Problems panel, and the
  notification offers Commit Again or Skip Hooks. A passing pre-commit summary shows in the
  status bar.
- **Tags**: New Tag suggests the next name (`PREFIX_YYMMDD` or the next patch version), creates
  an annotated or lightweight tag and offers to push it; Push Tag, Push All Tags, and deleting a
  tag can delete it on the remote.
- While git runs, the activity-bar icon shows turning arrows (like Source Control) and a progress
  bar runs at the top of the Commit view and of the Log.
- Fixed: the change-count badge on the activity-bar icon now shows from the start, not only
  after the views were opened once.
- Fixed: the right-click menus of the Log view were always empty.

## 0.2.0 — 2026-11-09

- The Commit tool window's file list is now a native tree like VS Code's Source Control view:
  click a file to open its diff, inline Open File / Rollback buttons on each row (Rollback for
  a whole changelist on its row), file icons, Git status colors and a change-count badge.
- Roll back several files at once: select them and use the inline Rollback button, the title
  button, the context menu or Ctrl+Alt+Z.
- Changelists, per-file checkboxes and drag and drop between changelists are kept; the commit
  message, Amend and Commit buttons move to a compact _Commit_ view above the list.

## 0.1.0

- Git tool window (bottom panel): branches tree, commit graph with branch and tag labels,
  commit details with changed files and diffs; filters by text/hash, branch, user and path.
- Commit tool window: changelists, checkboxes per file, unversioned files, Amend, Commit and
  Commit and Push.
- Branches popup from the status bar; checkout, new branch, compare, merge, rebase, push, rename,
  delete.
- Annotate (git blame) in the gutter; Show History for a file and for a selection.
