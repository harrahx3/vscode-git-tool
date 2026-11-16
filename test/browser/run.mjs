// Drives the real webview bundles in headless Chromium with a fake VS Code host.
// Usage: npm run test:browser [-- --chromium=<path-to-chrome>]
import assert from "node:assert/strict";
import { join } from "node:path";
import { finish, postToPage, scenario, sent, shots } from "./harness.mjs";
import { commitTests } from "./commit.mjs";

// ---- Fixture history -------------------------------------------------------------------------

const hex = (n) => n.toString(16).padStart(40, "0");
const T0 = 1762600000;
/** A small history with a feature branch merged back, a branch in progress and a tag. */
function history() {
  const c = (n, parents, subject, author = "Jane Doe", dt = 0) => ({
    hash: hex(n),
    parents: parents.map(hex),
    author,
    email: "dev@example.invalid",
    authorTime: T0 - n * 3600 - dt,
    subject,
  });
  return [
    c(1, [2], "feat(log): virtualised commit table"),
    c(2, [3, 20], "Merge branch 'feat/graph' into main"),
    c(20, [21], "feat(graph): colour lanes by branch", "Alex Doe"),
    c(3, [4], "fix: keep the selection when the log refreshes"),
    c(21, [4], "feat(graph): lane layout", "Alex Doe"),
    c(30, [4], "wip: changelists in the commit view", "Sam Lee"),
    c(4, [5], "docs: README"),
    c(5, [6], "chore: pin dependencies"),
    c(6, [], "Initial commit"),
  ];
}
const REFS = [
  { name: "main", kind: "head", hash: hex(1), upstream: "origin/main", ahead: 1 },
  { name: "origin/main", kind: "remote", hash: hex(2) },
  { name: "feat/changelists", kind: "head", hash: hex(30) },
  { name: "origin/feat/graph", kind: "remote", hash: hex(20) },
  { name: "v0.1.0", kind: "tag", hash: hex(4) },
];
const HEAD = { branch: "main", hash: hex(1) };

const details = (hash) => ({
  hash,
  parents: [hex(2)],
  author: "Jane Doe",
  email: "dev@example.invalid",
  authorTime: T0,
  committer: "Jane Doe",
  committerTime: T0,
  subject: "feat(log): virtualised commit table",
  message:
    "feat(log): virtualised commit table\n\nOnly the visible rows are in the DOM, so 50 000 commits scroll smoothly.",
  files: [
    { status: "M", path: "src/webview/log/table.ts" },
    { status: "A", path: "src/webview/log/graphSvg.ts" },
    { status: "R", path: "src/webview/log/main.ts", oldPath: "src/webview/main.ts" },
    { status: "D", path: "src/old.ts" },
    { status: "M", path: "README.md" },
  ],
  refs: ["main"],
});

const lastQuery = async (p) => (await sent(p, "query")).at(-1);

/** Answers the log's queries with `commits`, like the host does. */
async function bootLog(p, commits = history(), refs = REFS) {
  await postToPage(p, { type: "repos", repos: [{ root: "/r", name: "repo" }], current: "/r" });
  await postToPage(p, { type: "refs", head: HEAD, refs });
  const q = await lastQuery(p);
  await postToPage(p, {
    type: "commits",
    requestId: q.requestId,
    commits,
    graph: true,
    hasMore: false,
  });
}

console.log("browser tests — log");

await scenario("log: graph, labels, HEAD selected and details requested", "log", async (p) => {
  await bootLog(p);
  await p.waitForSelector(".row");
  assert.equal(await p.locator(".row").count(), 9);
  assert.equal(
    await p.locator(".row.selected .subject").textContent(),
    "feat(log): virtualised commit table",
  );
  // Merge row spans two lanes.
  const mergeSvg = p.locator(`.row[data-hash="${hex(2)}"] svg.graph`);
  assert.equal(await mergeSvg.getAttribute("width"), "24");
  // origin & main merged into one label only where both point to the same commit.
  const labels = await p.locator(".ref").allTextContents();
  assert.ok(labels.includes("main"), labels.join());
  assert.ok(labels.includes("origin/main"));
  assert.ok(labels.includes("v0.1.0"));
  // Context-menu data on rows.
  const ctx = JSON.parse(await p.locator(".row.selected").getAttribute("data-vscode-context"));
  assert.equal(ctx.webviewSection, "commit");
  assert.equal(ctx.isHead, true);
  await p.waitForFunction(() => window.__sent.some((m) => m.type === "details"));
  await postToPage(p, { type: "details", details: details(hex(1)) });
  await p.waitForSelector(".details-message .subject");
  assert.equal(await p.locator(".file-row[data-path]").count(), 5);
  await p.screenshot({ path: join(shots, "log-dark.png") });
});

await scenario(
  "log: light theme",
  "log",
  async (p) => {
    await bootLog(p);
    await p.waitForSelector(".row");
    await postToPage(p, { type: "details", details: details(hex(1)) });
    await p.waitForSelector(".details-message .subject");
    await p.screenshot({ path: join(shots, "log-light.png") });
  },
  "light",
);

await scenario("log: keyboard, double-click diff, filters re-query", "log", async (p) => {
  await bootLog(p);
  await p.waitForSelector(".row");
  await p.locator(".table-scroll").focus();
  await p.keyboard.press("ArrowDown");
  assert.equal(await p.locator(".row.selected").getAttribute("data-hash"), hex(2));
  await postToPage(p, { type: "details", details: details(hex(2)) });
  await p.waitForSelector(".file-row[data-path]");
  await p.locator(".file-row[data-path='src/webview/log/main.ts']").dblclick();
  const diff = (await sent(p, "openDiff")).at(-1);
  assert.deepEqual(
    { path: diff.path, oldPath: diff.oldPath, parent: diff.parent },
    { path: "src/webview/log/main.ts", oldPath: "src/webview/main.ts", parent: hex(2) },
  );
  await p.fill(".filter-text", "graph");
  await p.waitForFunction(
    () => window.__sent.filter((m) => m.type === "query").at(-1).filter.text === "graph",
  );
  await p.selectOption(".filter-branch", "feat/changelists");
  const q = await lastQuery(p);
  assert.equal(q.filter.branch, "feat/changelists");
  assert.equal(q.filter.text, "graph");
});

await scenario("log: branch tree reveal and filter, path chip", "log", async (p) => {
  await bootLog(p);
  await p.waitForSelector(".tree-row.branch-ref");
  await p.locator(".tree-row.branch-ref", { hasText: "changelists" }).click();
  assert.equal(await p.locator(".row.selected").getAttribute("data-hash"), hex(30));
  // Folders: feat/changelists sits under a "feat" folder.
  assert.equal(await p.locator(".tree-row.folder", { hasText: "feat" }).count(), 2);
  await p.locator(".tree-row.branch-ref", { hasText: "changelists" }).dblclick();
  assert.equal((await lastQuery(p)).filter.branch, "feat/changelists");
  await postToPage(p, { type: "setFilter", filter: { path: "src/a.ts" } });
  await p.waitForSelector(".chip");
  assert.match(await p.locator(".chip").textContent(), /src\/a\.ts/);
  await p.locator(".chip button").click();
  assert.equal((await lastQuery(p)).filter.path, undefined);
});

await scenario("log: multi-selection with Ctrl/Shift and its context menu", "log", async (p) => {
  await bootLog(p);
  await p.waitForSelector(".row");
  const row = (n) => p.locator(`.row[data-hash="${hex(n)}"]`);
  const ctxOf = async (n) => JSON.parse(await row(n).getAttribute("data-vscode-context"));
  const selected = () =>
    p.locator(".row.selected").evaluateAll((rs) => rs.map((r) => r.dataset.hash));
  const lastSelection = async () => (await sent(p, "selection")).at(-1)?.hashes;
  // The toolbar's New Branch and Checkout buttons have their own icons.
  assert.equal(await p.locator(".toolbar .svg-icon svg").count(), 2);

  // Ctrl+click adds a second commit: both rows offer the multi-commit menu.
  await row(3).click({ modifiers: ["Control"] });
  assert.deepEqual(await selected(), [hex(1), hex(3)]);
  assert.deepEqual(await lastSelection(), [hex(1), hex(3)]);
  for (const n of [1, 3]) {
    const ctx = await ctxOf(n);
    assert.equal(ctx.webviewSection, "commits");
    assert.equal(ctx.isPair, true);
    assert.equal(ctx.count, 2);
  }
  assert.equal((await ctxOf(2)).webviewSection, "commit");
  assert.equal(await p.locator(".selection-count").textContent(), "2 selected");

  // A right-click inside the selection keeps it; Shift+click selects a range from the anchor.
  await row(1).click({ button: "right" });
  assert.deepEqual(await selected(), [hex(1), hex(3)]);
  await row(30).click({ modifiers: ["Shift"] });
  assert.deepEqual(await selected(), [hex(3), hex(21), hex(30)]);
  assert.equal((await ctxOf(21)).isPair, false);
  await p.screenshot({ path: join(shots, "log-multi-selection.png") });

  // Shift+ArrowUp shrinks the range; Ctrl+click removes a commit.
  await p.keyboard.press("Shift+ArrowUp");
  assert.deepEqual(await selected(), [hex(3), hex(21)]);
  await row(21).click({ modifiers: ["Control"] });
  assert.deepEqual(await selected(), [hex(3)]);
  assert.equal((await ctxOf(3)).webviewSection, "commit");
  assert.equal(await p.locator(".selection-count").textContent(), "");

  // A right-click outside the selection, or a plain click, selects that commit only.
  await row(1).click({ modifiers: ["Control"] });
  await row(4).click({ button: "right" });
  assert.deepEqual(await selected(), [hex(4)]);
  await row(5).click({ modifiers: ["Control"] });
  await row(6).click();
  assert.deepEqual(await selected(), [hex(6)]);
  assert.deepEqual(await lastSelection(), [hex(6)]);
});

await scenario("log: stale answers dropped, show-in-log selects", "log", async (p) => {
  await bootLog(p);
  await p.waitForSelector(".row");
  await postToPage(p, { type: "commits", requestId: 0, commits: [], graph: true, hasMore: false });
  assert.equal(await p.locator(".row").count(), 9);
  await postToPage(p, { type: "select", hash: hex(21) });
  await p.waitForFunction(
    (h) => document.querySelector(".row.selected")?.dataset.hash === h,
    hex(21),
  );
});

await scenario("log: 30 000 commits scroll virtualised and page in", "log", async (p) => {
  await postToPage(p, { type: "refs", head: { branch: "main", hash: hex(1) }, refs: [] });
  const q = await lastQuery(p);
  // Built and timed inside the page: the cost measured is the webview's, not the test's transfer.
  const elapsed = await p.evaluate(
    async ([requestId, T0]) => {
      const hex = (n) => n.toString(16).padStart(40, "0");
      const many = Array.from({ length: 30000 }, (_, i) => ({
        hash: hex(i + 1),
        parents:
          i % 50 === 0 && i < 29990 ? [hex(i + 2), hex(i + 5)] : i < 29999 ? [hex(i + 2)] : [],
        author: `Dev ${i % 7}`,
        email: "d@x",
        authorTime: T0 - i * 600,
        subject: `Commit number ${i + 1}`,
      }));
      const start = performance.now();
      window.postMessage(
        { type: "commits", requestId, commits: many, graph: true, hasMore: true },
        "*",
      );
      while (!document.querySelector(".row.selected")) await new Promise((r) => setTimeout(r, 5));
      return performance.now() - start;
    },
    [q.requestId, T0],
  );
  console.log(`    (30 000 commits laid out and drawn in ${elapsed.toFixed(0)} ms)`);
  assert.ok(elapsed < 1500, `took ${elapsed} ms`);
  assert.ok((await p.locator(".row").count()) < 60, "only visible rows are in the DOM");
  await p.locator(".table-scroll").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await p.waitForFunction(
    () => window.__sent.filter((m) => m.type === "query").at(-1).limit === 2000,
  );
});

await scenario("log: toolbar runs New Branch, Checkout and Compare", "log", async (p) => {
  await bootLog(p);
  const buttons = [
    ["New branch…", "gitTool.newBranch"],
    ["Checkout…", "gitTool.checkout"],
    ["Compare branches…", "gitTool.compareBranches"],
    ["Fetch all remotes", "gitTool.fetch"],
    ["Pull", "gitTool.update"],
  ];
  for (const [title, command] of buttons) {
    await p.click(`button[title="${title}"]`);
    assert.equal((await sent(p, "command")).at(-1).command, command);
  }
});

await commitTests();
await finish();
