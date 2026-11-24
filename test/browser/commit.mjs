// Browser tests of the Commit view: the message box and the changed files right under it.
import assert from "node:assert/strict";
import { join } from "node:path";
import { postToPage, scenario, sent, shots } from "./harness.mjs";

const file = (path, status, included, extra = {}) => ({
  path,
  status,
  included,
  untracked: status === "?",
  conflict: status === "U",
  ...extra,
});

const LISTS = [
  {
    key: "|list:Changes",
    name: "Changes",
    kind: "changelist",
    active: true,
    files: [
      file("src/webview/commit/main.ts", "M", true),
      file("README.md", "M", true),
      file("src/old.ts", "D", true),
    ],
  },
  {
    key: "|list:Feature",
    name: "Feature",
    kind: "changelist",
    active: false,
    files: [file("src/feature.ts", "A", false)],
  },
  { key: "|list:Empty", name: "Empty", kind: "changelist", active: false, files: [] },
  {
    key: "unversioned",
    name: "Unversioned Files",
    kind: "unversioned",
    active: false,
    files: [file("notes.txt", "?", false)],
  },
];

const commitState = (over = {}) => ({
  type: "state",
  state: {
    repoName: "vscode-git-tool",
    branch: "main",
    ahead: 2,
    included: 3,
    total: 5,
    lastMessage: "feat: previous commit",
    lists: LISTS,
    ...over,
  },
});

const row = (p, key) => p.locator(`.row[data-key="${key}"]`);
const ctxOf = async (p, key) => JSON.parse(await row(p, key).getAttribute("data-vscode-context"));
const lastSent = async (p, type) => (await sent(p, type)).at(-1);

export async function commitTests() {
  console.log("browser tests — commit view");

  await scenario(
    "commit: message, included count, Ctrl+Enter commits",
    "commit",
    async (p) => {
      await postToPage(p, commitState());
      await p.waitForFunction(() => document.querySelector(".summary").textContent !== "");
      assert.equal(await p.locator(".summary").textContent(), "3 of 5 files");
      assert.match(await p.getAttribute("textarea.message", "placeholder"), /on 'main'/);
      assert.match(await p.locator(".branch").textContent(), /vscode-git-tool · main ↑2/);
      // The message box keeps Cut / Copy / Paste on right-click.
      assert.deepEqual(
        JSON.parse(await p.getAttribute("textarea.message", "data-vscode-context")),
        {
          preventDefaultContextMenuItems: false,
        },
      );
      assert.equal(await p.locator("button.primary").isDisabled(), true);
      await p.fill("textarea.message", "feat: changes view");
      assert.equal(await p.locator("button.primary").isDisabled(), false);
      await p.screenshot({ path: join(shots, "commit-dark.png") });
      await p.locator("textarea.message").press("Control+Enter");
      assert.deepEqual(await lastSent(p, "commit"), {
        type: "commit",
        message: "feat: changes view",
        amend: false,
        push: false,
      });
      await postToPage(p, { type: "committed" });
      await p.waitForFunction(() => document.querySelector("textarea").value === "");
    },
    "dark",
    { width: 380, height: 420 },
  );

  await scenario(
    "commit: nothing ticked disables, amend prefills and enables",
    "commit",
    async (p) => {
      await postToPage(p, commitState({ included: 0 }));
      await p.waitForFunction(() => document.querySelector(".summary").textContent !== "");
      await p.fill("textarea.message", "feat: x");
      assert.equal(await p.locator("button.primary").isDisabled(), true);
      await p.fill("textarea.message", "");
      await p.locator("#amend").check();
      assert.equal(await p.inputValue("textarea.message"), "feat: previous commit");
      assert.equal(await p.locator("button.primary").textContent(), "Amend Commit");
      assert.equal(await p.locator("button.primary").isDisabled(), false);
      await p.locator("button.secondary").click();
      const commit = await lastSent(p, "commit");
      assert.equal(commit.amend, true);
      assert.equal(commit.push, true);
      await p.screenshot({ path: join(shots, "commit-light.png") });
    },
    "light",
    { width: 380, height: 420 },
  );

  await scenario(
    "commit: changelists under the message, ticks, clicks, selection and menus",
    "commit",
    async (p) => {
      await postToPage(p, commitState());
      await p.waitForSelector(".row");
      // Groups and files, in order; the empty changelist is kept, its header has no checkbox.
      const keys = await p.locator(".row").evaluateAll((els) => els.map((e) => e.dataset.key));
      assert.deepEqual(keys, [
        "|list:Changes",
        "file:|src/webview/commit/main.ts",
        "file:|README.md",
        "file:|src/old.ts",
        "|list:Feature",
        "file:|src/feature.ts",
        "|list:Empty",
        "unversioned",
        "file:|notes.txt",
      ]);
      // The list sits right under the commit form, in the same view.
      const formBottom = await p
        .locator(".commit-box")
        .evaluate((e) => e.getBoundingClientRect().bottom);
      const listTop = await p.locator(".changes").evaluate((e) => e.getBoundingClientRect().top);
      assert.ok(Math.abs(listTop - formBottom) < 2, `${formBottom} vs ${listTop}`);
      assert.equal(await row(p, "|list:Changes").locator("input.tick").isChecked(), true);
      assert.equal(await row(p, "|list:Empty").locator("input.tick").count(), 0);
      assert.match(await row(p, "|list:Changes").textContent(), /Changes\s*active · 3 files/);
      assert.equal(await row(p, "file:|README.md").locator(".status").textContent(), "M");
      assert.equal(await row(p, "file:|notes.txt").locator(".status").textContent(), "U");
      assert.deepEqual(await ctxOf(p, "file:|notes.txt"), {
        webviewSection: "change",
        path: "notes.txt",
        list: "Unversioned Files",
        untracked: true,
        conflict: false,
      });
      assert.deepEqual(await ctxOf(p, "|list:Feature"), {
        webviewSection: "changelist",
        list: "Feature",
        active: false,
        empty: false,
      });
      assert.deepEqual(await ctxOf(p, "unversioned"), { webviewSection: "unversioned" });
      await p.screenshot({ path: join(shots, "commit-changes-dark.png") });

      // Ticks: a file, a whole changelist.
      await row(p, "file:|README.md").locator("input.tick").click();
      assert.deepEqual(await lastSent(p, "include"), {
        type: "include",
        files: [{ path: "README.md" }],
        on: false,
      });
      await row(p, "|list:Feature").locator("input.tick").click();
      assert.deepEqual(await lastSent(p, "include"), {
        type: "include",
        files: [{ path: "src/feature.ts" }],
        on: true,
      });
      assert.equal((await sent(p, "run")).length, 0, "a tick is not a click on the row");

      // A click opens the diff; Ctrl+click and Shift+click select several files.
      await row(p, "file:|README.md").locator(".name").click();
      const run = await lastSent(p, "run");
      assert.equal(run.command, "gitTool.change.diff");
      assert.equal(run.target.path, "README.md");
      await row(p, "file:|src/feature.ts")
        .locator(".name")
        .click({ modifiers: ["Control"] });
      assert.deepEqual((await lastSent(p, "selection")).keys, [
        "file:|README.md",
        "file:|src/feature.ts",
      ]);
      // Shift+click selects the range from the last clicked row (Ctrl+click moves it too).
      await row(p, "file:|README.md").locator(".name").click();
      await row(p, "file:|src/old.ts")
        .locator(".name")
        .click({ modifiers: ["Shift"] });
      assert.deepEqual((await lastSent(p, "selection")).keys.sort(), [
        "file:|README.md",
        "file:|src/old.ts",
      ]);
      // Ticking a selected row ticks the whole selection; Space does the same.
      await row(p, "file:|src/old.ts").locator("input.tick").click();
      assert.deepEqual((await lastSent(p, "include")).files.map((f) => f.path).sort(), [
        "README.md",
        "src/old.ts",
      ]);
      // A row button acts on its row.
      await row(p, "file:|src/old.ts").hover();
      await row(p, "file:|src/old.ts").locator('button[title="Rollback…"]').click();
      assert.equal((await lastSent(p, "run")).command, "gitTool.change.rollback");
      // Right-click outside the selection selects that row only.
      await row(p, "file:|notes.txt").click({ button: "right" });
      assert.deepEqual((await lastSent(p, "selection")).keys, ["file:|notes.txt"]);
      // Collapse a changelist: its files disappear, the collapsed state is kept.
      await row(p, "|list:Changes").locator(".twisty").click();
      assert.equal(await row(p, "file:|README.md").count(), 0);
      await postToPage(p, commitState());
      await p.waitForTimeout(50);
      assert.equal(await row(p, "file:|README.md").count(), 0);
      // Keyboard: arrows move (over the group rows too), Enter opens the diff.
      await row(p, "file:|src/feature.ts").locator(".name").click();
      for (let i = 0; i < 3; i++) await p.keyboard.press("ArrowDown");
      await p.keyboard.press("Enter");
      assert.equal((await lastSent(p, "run")).target.path, "notes.txt");
      // A click on a changelist header folds it, like a tree.
      await row(p, "|list:Feature").locator(".name").click();
      assert.equal(await row(p, "file:|src/feature.ts").count(), 0);
      await row(p, "|list:Feature").locator(".name").click();
      const status = await lastSent(p, "status");
      assert.ok(status.files.includes("src/feature.ts") && !status.files.includes("README.md"));
    },
    "dark",
    { width: 420, height: 520 },
  );

  await scenario(
    "commit: drag files between changelists with the pointer",
    "commit",
    async (p) => {
      await postToPage(p, commitState());
      await p.waitForSelector(".row");
      const drag = async (fromKey, toKey) => {
        const from = await row(p, fromKey).locator(".name").boundingBox();
        const to = await row(p, toKey).boundingBox();
        await p.mouse.move(from.x + 5, from.y + from.height / 2);
        await p.mouse.down();
        await p.mouse.move(from.x + 20, from.y + 20, { steps: 4 });
        await p.mouse.move(to.x + 40, to.y + to.height / 2, { steps: 6 });
        await p.mouse.up();
      };
      await drag("file:|README.md", "|list:Feature");
      assert.deepEqual(await lastSent(p, "move"), {
        type: "move",
        paths: ["README.md"],
        list: "Feature",
      });
      assert.equal((await sent(p, "run")).length, 0, "the drag did not open the diff");
      // Dropping on a file row moves to that file's changelist; on its own list does nothing.
      await drag("file:|src/feature.ts", "file:|README.md");
      assert.equal((await lastSent(p, "move")).list, "Changes");
      await drag("file:|README.md", "file:|src/old.ts");
      assert.equal((await sent(p, "move")).length, 2);
      // Unversioned files are not moved (they belong to no changelist).
      await drag("file:|notes.txt", "|list:Feature");
      assert.equal((await sent(p, "move")).length, 2);
    },
    "light",
    { width: 420, height: 520 },
  );

  await scenario(
    "commit: conflicts first, a click opens the merge editor, notice shown",
    "commit",
    async (p) => {
      const conflicts = {
        key: "conflicts",
        name: "Merge Conflicts",
        kind: "conflicts",
        active: false,
        files: [file("c.txt", "U", false)],
      };
      await postToPage(
        p,
        commitState({
          lists: [conflicts, ...LISTS],
          notice: "Merge in progress: resolve 1 conflicted file, then Continue (buttons above).",
        }),
      );
      await p.waitForSelector(".row");
      assert.match(await p.locator(".notice").textContent(), /Merge in progress/);
      assert.equal(await row(p, "file:|c.txt").locator("input.tick").count(), 0);
      await row(p, "file:|c.txt").locator(".name").click();
      assert.equal((await lastSent(p, "run")).command, "gitTool.change.resolve");
      assert.deepEqual(await ctxOf(p, "conflicts"), { webviewSection: "conflicts" });
      assert.equal((await lastSent(p, "status")).notice.startsWith("Merge in progress"), true);
    },
    "dark",
    { width: 420, height: 520 },
  );

  await scenario(
    "commit: several repositories get a header each and ticks name their repository",
    "commit",
    async (p) => {
      const list = (root, name, files) => ({
        root,
        key: `${root}|list:Changes`,
        name: "Changes",
        kind: "changelist",
        active: true,
        files,
      });
      await postToPage(
        p,
        commitState({
          repoName: undefined,
          branch: undefined,
          repos: [
            { root: "/w/alpha", name: "alpha", branch: "main", ahead: 1 },
            { root: "/w/beta", name: "beta", branch: "dev", notice: "Merge in progress" },
          ],
          lists: [
            list("/w/alpha", "alpha", [file("a.txt", "M", true)]),
            list("/w/beta", "beta", [file("a.txt", "M", false)]),
          ],
        }),
      );
      await p.waitForSelector(".row");
      assert.deepEqual(await p.locator(".row.repo .name").allTextContents(), ["alpha", "beta"]);
      assert.match(await p.locator(".row.repo").nth(1).textContent(), /Merge in progress/);
      // The same path in two repositories is two rows.
      await row(p, "file:/w/beta|a.txt").locator("input.tick").click();
      assert.deepEqual(await lastSent(p, "include"), {
        type: "include",
        files: [{ root: "/w/beta", path: "a.txt" }],
        on: true,
      });
      await row(p, "file:/w/alpha|a.txt").locator(".name").click();
      assert.deepEqual((await lastSent(p, "run")).target.root, "/w/alpha");
    },
    "light",
    { width: 380, height: 420 },
  );
}
