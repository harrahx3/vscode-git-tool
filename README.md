# Git Changelists & Log

Git tool windows for VS Code, inspired by PyCharm's: a commit graph with branches and commit details in the
bottom panel, and a Commit view whose file list works like VS Code's Source Control view, with
changelists and per-file checkboxes added. It uses VS Code's theme
colors and native menus, and sits next to VS Code's own Source Control view without changing it.

## What you get

**Git tool window** (bottom panel, tab _Git → Log_; command _Git Tool: Show Log_)

- **Branches** pane: HEAD, Local, Remote and Tags, with branch names grouped into folders on `/`
  and ahead/behind counts. A click jumps to the branch's commit, a double-click shows only its
  history, and a right-click gives Checkout, New Branch, Compare with Current, Rebase Current
  onto This, Merge into Current, Push, Rename and Delete.
- **Commit graph**: colored lanes, branch and tag labels (`origin & main` when both point to
  the same commit), author, date and hash. Only the visible rows are drawn, so large histories
  scroll smoothly, and older commits load as you scroll.
- **Filters**: text or hash, branch, user and path. _Show History_ and _Show History for
  Selection_ open the log filtered on a file or on the selected lines.
- **Commit menu** (right-click): Copy Revision Number, Checkout Revision, New Branch, New Tag,
  Cherry-Pick, Revert Commit, Undo Commit (HEAD only), Reset Current Branch to Here (soft, mixed,
  hard or keep), and Interactively Rebase from Here.
- **Several commits**: Ctrl/Cmd+click adds or removes a commit, Shift+click or Shift+arrows
  select a range, Ctrl/Cmd+A selects all loaded commits. Right-click the selection for Compare
  the Two Commits (two selected, older on the left), Copy Selected Hashes, Cherry-Pick Selected
  Commits (oldest first) and Revert Selected Commits.
- **Details** pane: the changed files grouped by folder. Double-click a file for its diff;
  right-click for Compare with Local, Open Repository Version and Show History. The message,
  author, committer and parents (click a parent to jump to it) are shown below the files.

**Branches and Compare** (activity-bar icon _Git Tool_, below Commit)

- While git runs (a refresh, fetch, pull, push…), the _Git Tool_ activity-bar icon shows the
  turning arrows, like VS Code's Source Control, and a progress bar runs at the top of the
  Commit view and of the Log.

- **Branches** view: HEAD, Local, Remote and Tags, with names grouped into folders on `/`. HEAD
  comes first, as in PyCharm, with the current branch (or "detached at <commit>") next to it.
  The current branch has a check mark, and ↑/↓ show commits to push and to pull. A click shows
  the branch's commit in the Log.
  - Right-click HEAD: New Branch from Here, New Tag…, Compare with…, Show History, and Push when
    a branch is checked out.
  - Hover buttons: _Checkout_ and _Compare with Current_.
  - Right-click: Checkout, New Branch from Here, Compare with Current, Compare with…, Show
    History, Rebase Current onto This, Merge into Current, Push, Rename, Delete.
  - Several selected (Ctrl/Shift+click): the right-click menu changes to _Compare Selected
    Branches_ (two branches or tags) and _Delete Selected…_ (one confirmation; the current
    branch is kept).
  - Title bar: Fetch, Pull, New Branch, Checkout…, Compare Branches…; Show Log
    and Refresh are under `…`.
- **Compare** view (PyCharm's _Compare with Current_), shown once you compare two branches,
  tags or revisions:
  - the commits _Only in_ each side, newest first. A click shows the commit in the Log;
    right-click for Copy Revision Number or Cherry-Pick;
  - the _Files changed_ from the first tip to the second, with Git status colors. A click opens
    the diff; right-click for _Compare with Local_;
  - title bar: Swap Sides, Refresh, Close.
- The Log toolbar has the same New Branch, Checkout and Compare buttons. Its branch menus offer
  Compare with Current and Compare with….

**Commit tool window** (activity-bar icon _Commit_; command _Git Tool: Commit…_)

One section: the commit message box at the top and, right under it, the changed files grouped
into PyCharm's changelists with a checkbox per file. Git status colors and a change count on
the activity-bar icon work as in VS Code's Source Control view.

- The **Commit** box shows how many files are ticked. **Amend** fills in the last message. Use
  **Commit** (Ctrl+Enter in the message box) or **Commit and Push…**.
- **Click a file** to open its diff against HEAD (a conflicted file opens in the merge editor).
  Click a changelist to fold or unfold it. Arrows, Home/End and Enter work too.
- **Row buttons** appear when you hover a row: _Open File_ and _Rollback_ (_Delete_ for an
  unversioned file). A changelist row has a _Rollback_ button for all its files.
- **Several files**: Ctrl+click and Shift+click (Shift+arrows) select several rows. Menus,
  buttons and checkboxes on a selected row act on the whole selection.
- **Roll back several files at once**: select them, then use a row's Rollback button, the
  Rollback button in the view title, the context menu, or Ctrl+Alt+Z. Rollback asks for
  confirmation. Added files are unstaged and kept on disk, and unversioned files are left alone.
- Changed files are grouped into **changelists**, plus _Unversioned Files_. New changes join
  the active changelist. Drag files onto a changelist (its header or one of its files) or use
  _Move to Another Changelist…_. Changelists are stored per workspace; Git does not know about
  them.
- **A checkbox on each file** chooses what gets committed, whatever is staged; the Git index is
  left alone. Files in the active changelist are ticked by default. Ticking a changelist ticks
  all its files (Space ticks the selected rows).
- Right-click a file for Show Diff, Open File, Show History, Move to Another Changelist,
  Rollback, Delete or Add to .gitignore; a changelist for Set Active, New, Edit, Rollback or
  Delete Changelist. The message box keeps Cut / Copy / Paste.

**Remote and merge requests** (GitLab, including self-hosted instances, GitHub and Bitbucket)

- **Open in Browser** opens the page on the remote's web host:
  - a branch or tag: right-click it in the Branches view or the Log;
  - a commit: right-click it in the Log or the Compare view;
  - a file: _Git → Open File in Browser_ in the editor or Explorer menu, or the editor tab menu.
    The selected lines are highlighted. The link points to the current commit when it is pushed,
    else to the upstream branch. _Copy Link to File_ copies the link instead;
  - a file changed by a commit: right-click it in the Log's details;
  - the repository and its merge request list: _Git Tool: Open Repository in Browser_ and _Open
    Merge Requests in Browser_ (also in the Branches and Merge Requests view menus).
- **Open Merge Request** (branch menus, the commit menu, the palette for the current branch) opens
  the open merge request of the branch, or the merge requests that contain a commit. With no
  merge request, it offers to create one.
- **Create Merge Request…** opens the service's "new merge request" page for the branch. When the
  branch was never pushed, it offers to push it first. On GitHub and Bitbucket these are pull
  requests.
- The remote used is the upstream of the current branch, else `origin`, else the first remote.
  Commits and branches the remote does not have yet get a warning before the page opens.

**Merge Requests view** (activity-bar icon _Git Tool_, collapsed at first; _Git Tool: Show Merge
Requests_)

- The open merge requests (GitLab) or pull requests (GitHub) of the remote, as one list. Each
  row shows the number, the author, _current branch_ for the one opened from the branch you are
  on, and the status (draft, conflicts, pipeline running…). Hover a row for the branches, dates,
  labels, reviewers and the description.
- _Sort By…_ (title bar) orders the list by last update (default), creation date, creator,
  assignee, title or number; the choice is remembered and shown next to the view's title.
- Expand a merge request to see its changed files, and click a file for its diff. The extension
  fetches the merge request's head and target branch into your repository with `git fetch`;
  your branches and working tree are not touched.
- Hover buttons: _Open in Browser_ and _Checkout Branch_. Right-click for _Copy Link_ and _Show
  in Compare View_, which lists its commits and files.
- Title bar: Refresh, Sort By…, Create Merge Request…, Open Merge Requests in Browser. _Sign In
  / Set Access Token…_ and _Forget Access Token_ are under `…`.
- **Credentials** (first match wins):
  1. an access token set with _Sign In / Set Access Token…_. It needs the `read_api` scope on
     GitLab, and is kept in VS Code's secret storage;
  2. on github.com, VS Code's GitHub sign-in;
  3. the `glab` (GitLab) or `gh` (GitHub) command-line tool, when it is installed and logged in
     to the host.
- The view only reads from the server (GET requests). Bitbucket is supported for the browser
  links, not for this view.

**Issues view** (activity-bar icon _Git Tool_, under Merge Requests, collapsed at first; _Git
Tool: Show Issues_)

- The open issues of the remote (GitLab or GitHub; pull requests are left out), as one list.
  Each row shows the number, the author and the labels; confidential issues have a lock. Hover
  a row for the dates, assignees, milestone, due date and the description.
- _Sort By…_ (title bar) orders the list by last update (default), creation date, creator,
  assignee, title or number; the choice is remembered, separately from the Merge Requests view.
- Hover buttons: _Open in Browser_ and _Create Branch…_, which suggests GitLab's branch name
  `<number>-<title>` (`12-fix-the-login-page`), creates it from the current branch and checks it
  out. Right-click for _Copy Link_.
- Title bar: Refresh, Sort By…, New Issue… (the service's "new issue" page), Open Issues in
  Browser.
  Sign-in and credentials are the same as for the Merge Requests view (on GitLab the token's
  `read_api` scope covers issues). Read-only, like the Merge Requests view.

**Worktrees view** (activity-bar icon _Git Tool_, collapsed at first; _Git Tool: Switch
Worktree…_)

- Every working tree of the repository (`git worktree list`), with the branch or detached commit
  it has checked out. The one the views show has a check mark; the main working tree, locked
  worktrees and worktrees whose folder is gone (_missing_) are marked. A click shows its commit
  in the Log.
- Hover buttons: _Open (Switch to Worktree)_ and _Open in New Window_. Switching to a worktree
  that is already a folder of the workspace changes what the views show; otherwise the window
  reopens on its folder.
- Right-click: Open, Open in New Window, Add to Workspace, Show in Log, Copy Path and _Delete
  Worktree…_. Delete asks for confirmation, offers to delete the branch too, and asks again
  before deleting uncommitted changes or untracked files. The main worktree and the one open
  here cannot be deleted. Several selected worktrees can be deleted at once (also with the
  Delete key).
- Title bar: New Worktree… and Refresh; _Switch Worktree…_ and _Prune Missing Worktrees_ are
  under `…`.
- _New Worktree…_ (also _Check Out in New Worktree…_ on a branch in the Branches view or the Log)
  checks out a local branch, a remote branch (creating its tracking branch), or a tag or
  revision (on a new branch or a detached HEAD). A branch already checked out elsewhere gets a
  new branch. The suggested folder is `<repo>.worktrees/<branch>` next to the main working tree.
- Checking out a branch that another worktree has checked out offers to open that worktree.

**Everywhere**

- **Branches popup**: click the branch name on the right of the status bar. It offers Update
  Project, Commit, Push, New Branch, Checkout Tag or Revision, and every branch with its
  actions.
- **Annotate**: right-click the line numbers, or _Git → Annotate with Git Blame_ in the editor
  menu. It shows the date and author per block of lines, shaded by age. Hover a line for the
  commit and a link to it in the log. Unsaved edits show as _Not committed yet_.
- **Pull** (fetch the upstream's remote, then merge or rebase per setting, local
  changes stashed around it), **Fetch** and **Push…** (with Force Push, which uses
  `--force-with-lease`). Fetch and push go through VS Code's Git extension, so you are asked
  to sign in like in Source Control.
- **Tags**: _New Tag…_ (Branches view title, Log toolbar, commit and branch menus) suggests the
  next name from the previous tags: the same prefix with today's date for `PREFIX_YYMMDD`
  tags (the KNIME repositories' convention), or the next patch version for `v1.2.3`. Give a
  message for an annotated tag, or leave it empty for a lightweight one; then push it in one
  click. _Push Tag_ and _Push All Tags_; deleting a tag offers to delete it on the remote too.
- **Stash Changes…** and **Unstash Changes** in the Commit view's `…` menu.

Every command that changes the repository is logged in the _Git Tool_ output channel.

**When git fails**, the extension recognises the problem and offers the way out:

| Problem                                                                              | What you get                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local changes or untracked files in the way                                          | _Stash and Retry_ (stash, run, unstash; PyCharm's smart checkout), or _Force Checkout_                                                                                                                                     |
| Conflicts (merge, rebase, cherry-pick, revert, unstash)                              | _Resolve Conflicts_ in VS Code's merge editor, or _Abort_                                                                                                                                                                  |
| Merge, rebase, cherry-pick or revert in progress                                     | Commit view: a _Merge Conflicts_ group, a notice, and Continue / Skip / Abort / Resolve buttons; right-click a conflicted file for Accept Ours / Theirs                                                                    |
| A hook refused the commit or the push                                                | A report beside the editor (pre-commit results table, ruff / linter problems linked to their lines, full output), the problems in the Problems panel, and _Commit Again_ (picks up files a formatter fixed), _Skip Hooks…_ |
| Authentication failed, unknown SSH host key                                          | _Retry_, or _Run in Terminal_ to sign in or accept the key                                                                                                                                                                 |
| Push rejected (the remote has new commits)                                           | _Pull and Push_, or _Force Push_ (with lease)                                                                                                                                                                              |
| Force push refused (stale info), remote refused (protected branch, server hook)      | The reason given by the server, _Fetch_                                                                                                                                                                                    |
| No upstream branch / upstream deleted on the remote                                  | _Push and Track_, _Track Remote Branch…_ / _Push to Recreate It_, _Stop Tracking_                                                                                                                                          |
| No remote, detached HEAD                                                             | _Add Remote…_ / _New Branch Here…_, _Checkout Branch…_                                                                                                                                                                     |
| Name and email not set, signing failed                                               | _Set Name and Email…_ / _Retry Without Signing_                                                                                                                                                                            |
| Stale `index.lock`, unrelated histories, empty cherry-pick, existing branch, network | _Remove Lock and Retry_ / _Merge Anyway_ / _Skip It_ / _Check It Out_ / _Retry_                                                                                                                                            |

When a pre-commit hook passes, its summary (`pre-commit: 5 passed`) or its first line
(`KNIME state OK: …`) shows in the status bar after the commit.

## Settings

| Setting                         | Default |                                                        |
| ------------------------------- | ------- | ------------------------------------------------------ |
| `gitTool.showBranchInStatusBar` | `true`  | Show the current branch on the right of the status bar |
| `gitTool.updateMethod`          | `merge` | `merge` or `rebase` for _Pull_                         |
| `gitTool.hostingProviders`      | `{}`    | Service of a remote host when it can't be guessed      |

`gitTool.hostingProviders` maps a host to `gitlab`, `github` or `bitbucket`, for example
`{"git.example.com": "github"}` for a GitHub Enterprise server. Without an entry, `github.com`
and `bitbucket.org` are recognised, and any other host is taken as a GitLab instance.

No keyboard shortcuts are bound by default, because PyCharm's (Ctrl+K, Ctrl+T, Alt+9) clash with
VS Code's. Bind the `gitTool.*` commands in _Keyboard Shortcuts_ if you want them.

## Install

From the Visual Studio Marketplace: search for **Git Changelists & Log** in the Extensions view, or run

```bash
code --install-extension harrahx3.vscode-git-tool
```

Each release's `.vsix` is also attached to the [GitHub Releases](https://github.com/harrahx3/vscode-git-tool/releases)
(_Extensions view → … → Install from VSIX…_).

It needs VS Code 1.90 or later with the built-in Git extension enabled. It works in VS Code
connected to WSL.

## Develop

```bash
npm install
npm run build          # or: npm run watch
npm run lint && npm run typecheck
npm test               # unit tests (parsers, graph layout, commit/rollback on real repos)
npm run test:browser   # the webviews in headless Chromium, with screenshots
npm run test:vscode    # integration tests in a downloaded VS Code
npm run package        # → vscode-git-tool-<version>.vsix
```

Press F5 in this folder to start an Extension Development Host.

Layout: `src/extension/` holds the extension host (git queries and operations, the two view
providers, commands, annotate), `src/webview/log/` and `src/webview/commit/` hold the two webview
interfaces, and `src/shared/` holds the message types, git output parsers and graph lane layout.

Release: bump `version` in `package.json` (`npm version X.Y.Z --no-git-tag-version`), add a
`CHANGELOG.md` entry, commit, then push a tag `vX.Y.Z`. The _Publish_ workflow
(`.github/workflows/publish.yml`) runs the tests, builds the `.vsix`, attaches it to a GitHub
Release and publishes it to the Visual Studio Marketplace (Trusted Publishing, no stored token).

## License

[MIT](LICENSE). The bundled third-party libraries keep their own licenses, listed in
[ThirdPartyNotices.txt](ThirdPartyNotices.txt).

PyCharm and IntelliJ IDEA are trademarks of JetBrains s.r.o. This extension is not affiliated with
or endorsed by JetBrains.
