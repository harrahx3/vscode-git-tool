import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface MenuItem {
  command?: string;
  when?: string;
  group?: string;
}

const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8")) as {
  contributes: {
    menus: Record<string, MenuItem[]>;
    commands: { command: string; icon?: string | { light: string; dark: string } }[];
    views: Record<string, { id: string }[]>;
  };
};
const commands = new Set(pkg.contributes.commands.map((c) => c.command));
const views = new Set(Object.values(pkg.contributes.views).flatMap((v) => v.map((x) => x.id)));
const allMenuItems = Object.entries(pkg.contributes.menus).flatMap(([menu, items]) =>
  items.map((item) => ({ menu, ...item })),
);
const webviewMenu = pkg.contributes.menus["webview/context"];

describe("package.json menus", () => {
  it("webview context menus test `webviewId`, the key VS Code sets on webview right-clicks", () => {
    // VS Code adds `webviewId` (the view id) to the context of a webview right-click; a
    // `webview == …` clause never matches, so the menu would be empty.
    expect(webviewMenu.length).toBeGreaterThan(0);
    for (const item of webviewMenu) {
      expect(item.when).toMatch(/^webviewId == gitTool\.(log|commit) && /);
      expect(item.when).not.toMatch(/\bwebview ==/);
    }
  });

  it("menus only reference declared commands and views", () => {
    for (const item of allMenuItems) {
      if (item.command) expect(commands, `${item.menu}: ${item.command}`).toContain(item.command);
      for (const [, id] of (item.when ?? "").matchAll(/\bview == ([\w.]+)/g))
        expect(views, `${item.menu}: ${item.when}`).toContain(id);
    }
  });

  it("inline and title buttons have an icon", () => {
    const withIcon = new Set(pkg.contributes.commands.filter((c) => c.icon).map((c) => c.command));
    for (const item of allMenuItems)
      if (item.command && (item.menu === "view/title" || item.group?.startsWith("inline")))
        expect(withIcon, `${item.menu}: ${item.command}`).toContain(item.command);
  });

  it("icon files exist for both themes", () => {
    for (const c of pkg.contributes.commands)
      if (c.icon && typeof c.icon !== "string")
        for (const file of [c.icon.light, c.icon.dark])
          expect(existsSync(join(__dirname, "..", "..", file)), `${c.command}: ${file}`).toBe(true);
  });

  it("New Branch and Checkout have different icons", () => {
    const iconOf = (id: string) =>
      JSON.stringify(pkg.contributes.commands.find((c) => c.command === id)?.icon);
    expect(iconOf("gitTool.newBranch")).not.toBe(iconOf("gitTool.checkout"));
  });

  it("Commit view menus only test the context keys its rows set", () => {
    // src/shared/messages.ts RowContext: what `data-vscode-context` holds on a row.
    const keys = new Set([
      "webviewId",
      "webviewSection",
      "untracked",
      "conflict",
      "active",
      "empty",
    ]);
    const sections = new Set(["change", "changelist", "unversioned", "conflicts"]);
    const items = webviewMenu.filter((i) => i.when?.startsWith("webviewId == gitTool.commit"));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      const when = item.when!.replace(/'[^']*'/g, "");
      for (const [word] of when.matchAll(/\b[a-zA-Z]\w*\b/g))
        if (!["gitTool", "commit"].includes(word) && !sections.has(word))
          expect(keys, `${item.command}: ${item.when}`).toContain(word);
      const section = /webviewSection == (\w+)/.exec(when)?.[1];
      expect(sections, item.when).toContain(section);
    }
  });

  it("Worktrees view menus only test the flags the tree sets", () => {
    // worktreesTree.ts builds `worktree-canOpen-canSwitch-canAdd-canDelete` (a subset).
    const items = pkg.contributes.menus["view/item/context"].filter((i) =>
      i.when?.startsWith("view == gitTool.worktrees"),
    );
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.when, item.command).toMatch(/viewItem =~ \/\^worktree/);
      for (const [, flag] of item.when!.matchAll(/-(\w+)\//g))
        expect(["canOpen", "canSwitch", "canAdd", "canDelete"]).toContain(flag);
    }
    // Deleting the main worktree or the one open here is never offered.
    const del = items.find((i) => i.command === "gitTool.worktree.delete");
    expect(del?.when).toMatch(/-canDelete/);
  });

  it("the Branches view shows single-ref or multi-selection actions, never both", () => {
    const branchItems = pkg.contributes.menus["view/item/context"].filter(
      (i) => i.when?.startsWith("view == gitTool.branches") && !i.group?.startsWith("inline"),
    );
    for (const item of branchItems)
      expect(item.when, item.command).toMatch(/ (!)?listMultiSelection /);
    const multi = branchItems.filter((i) => /[^!]listMultiSelection/.test(i.when!));
    expect(multi.map((i) => i.command).sort()).toEqual([
      "gitTool.refs.compare",
      "gitTool.refs.delete",
    ]);
  });
});
