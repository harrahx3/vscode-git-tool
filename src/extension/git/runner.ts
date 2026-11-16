import { spawn } from "child_process";

export class GitError extends Error {
  /** The repository and command that failed, so a recovery action can run it again. */
  git?: Git;
  args?: string[];
  input?: string;

  constructor(
    message: string,
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
  }
}

/**
 * Another way to run a network command (fetch, push): through VS Code's Git extension, which
 * asks for credentials. Returns the task, or undefined when it cannot handle these arguments.
 */
export type NetworkRunner = (args: string[]) => (() => Promise<void>) | undefined;

export interface RunOptions {
  /** Text written to git's standard input. */
  input?: string;
  /** Exit codes treated as success besides 0. */
  okCodes?: number[];
}

/** Runs git commands in one repository with the git binary VS Code's Git extension uses. */
export class Git {
  constructor(
    readonly root: string,
    private readonly gitPath: string,
    /** Receives write commands and their output (see {@link write}). */
    private readonly log: (line: string) => void = () => undefined,
    /** Wraps every command, to show that git is working (see BusyTracker). */
    private readonly track: <T>(task: () => Promise<T>) => Promise<T> = (task) => task(),
    private readonly networkRunner?: NetworkRunner,
  ) {}

  private noVerify = false;

  /** Runs `fn` with the hooks skipped (`--no-verify` on commit, push and merge). */
  async withoutHooks<T>(fn: () => Promise<T>): Promise<T> {
    this.noVerify = true;
    try {
      return await fn();
    } finally {
      this.noVerify = false;
    }
  }

  private hooksArgs(args: string[]): string[] {
    if (!this.noVerify || !["commit", "push", "merge"].includes(args[0])) return args;
    return [args[0], "--no-verify", ...args.slice(1)];
  }

  /**
   * Runs a command that talks to a remote (fetch, push). Through VS Code's Git extension when
   * available, so the user is asked for credentials like in Source Control; else plain git.
   */
  async network(args: string[]): Promise<void> {
    // The Git extension's API cannot skip hooks: plain git then.
    const task = this.noVerify ? undefined : this.networkRunner?.(args);
    if (!task) {
      await this.write(args);
      return;
    }
    this.log(`> git ${args.join(" ")}   (through VS Code's Git extension)`);
    try {
      await this.track(task);
    } catch (e) {
      const o = e as { message?: string; stderr?: string; exitCode?: number };
      const stderr = o.stderr ?? "";
      this.log((stderr || o.message || String(e)).trimEnd());
      throw this.failed(
        new GitError(stderr.trim() || o.message || String(e), stderr, o.exitCode ?? null),
        args,
      );
    }
  }

  /** Runs a command that changes the repository, logging it and its output. */
  async write(args: string[], input?: string): Promise<string> {
    return (await this.writeOutput(args, input)).stdout;
  }

  /**
   * Like {@link write}, also returning what git printed on stderr: progress, and the output of
   * hooks (a pre-commit hook may report on success too).
   */
  async writeOutput(args: string[], input?: string): Promise<{ stdout: string; stderr: string }> {
    this.log(`> git ${args.join(" ")}`);
    try {
      const out = await this.track(() => this.spawn(args, { input }));
      const text = [out.stdout, out.stderr].filter((x) => x.trim()).join("\n");
      if (text.trim()) this.log(text.trimEnd());
      return out;
    } catch (e) {
      if (e instanceof GitError) this.log((e.stderr || e.message).trimEnd());
      throw e;
    }
  }

  private failed(e: GitError, args: string[], input?: string): GitError {
    e.git = this;
    e.args = args;
    e.input = input;
    return e;
  }

  async run(args: string[], options: RunOptions = {}): Promise<string> {
    return (await this.track(() => this.spawn(args, options))).stdout;
  }

  private spawn(
    original: string[],
    options: RunOptions,
  ): Promise<{ stdout: string; stderr: string }> {
    const args = this.hooksArgs(original);
    return new Promise((resolve, reject) => {
      const child = spawn(this.gitPath, args, {
        cwd: this.root,
        // English messages (errors.ts recognises them); never wait for an editor or a prompt:
        // `rebase --continue` and friends keep the prepared commit message.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", GIT_EDITOR: "true" },
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on("data", (b: Buffer) => out.push(b));
      child.stderr.on("data", (b: Buffer) => err.push(b));
      child.on("error", (e) => reject(this.failed(new GitError(e.message, "", null), args)));
      child.on("close", (code) => {
        const stdout = Buffer.concat(out).toString("utf8");
        const stderr = Buffer.concat(err).toString("utf8");
        if (code === 0 || (code !== null && options.okCodes?.includes(code)))
          resolve({ stdout, stderr });
        else {
          const first = stderr.trim() || stdout.trim() || `git ${args[0]} failed`;
          // Conflicts are reported on stdout ("CONFLICT (content): …"): keep both.
          const text = [stderr, stdout].filter((x) => x.trim()).join("\n");
          reject(this.failed(new GitError(first, text, code), args, options.input));
        }
      });
      if (options.input !== undefined) child.stdin.end(options.input);
      else child.stdin.end();
    });
  }
}
