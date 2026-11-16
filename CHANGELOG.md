# Changelog

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

- Merge Requests and Issues views: one flat list instead of the _Current Branch_, _Assigned to
  Me_, _Created by Me_ and _All Open_ groups. A _Sort By…_ title button orders it by last update
  (default), creation date, creator, assignee, title or number; the choice is remembered per
  view. The current branch's merge request is marked _current branch_ in its row.
- Merge Requests and Issues views on a GitHub remote: a missing `gh` command-line tool no
  longer fails with `spawn gh EACCES` (a Windows folder on the WSL PATH makes Node report a
  permission error instead of "not found"). The views now offer "Sign In / Set Access
  Token…" as they do when `gh` is absent.

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
