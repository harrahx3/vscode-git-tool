// Shared runner of the browser tests: the real webview bundles in headless Chromium with a fake
// VS Code host (see run.mjs).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const shots = join(root, "test", "browser", "screenshots");
mkdirSync(shots, { recursive: true });

/** Chromium from --chromium=<path>, else the newest one in Playwright's browser cache. */
function chromiumPath() {
  const arg = process.argv.find((a) => a.startsWith("--chromium="));
  if (arg) return arg.slice("--chromium=".length);
  const cache = join(homedir(), ".cache", "ms-playwright");
  const dirs = existsSync(cache)
    ? readdirSync(cache)
        .filter((d) => /^chromium-\d+$/.test(d))
        .sort()
    : [];
  for (const d of dirs.reverse()) {
    const exe = join(cache, d, "chrome-linux64", "chrome");
    if (existsSync(exe)) return exe;
  }
  throw new Error("No Chromium found: pass --chromium=<path>.");
}

const THEMES = {
  dark: `--vscode-editor-background:#1e1e1e; --vscode-panel-background:#1e1e1e; --vscode-sideBar-background:#252526;
    --vscode-foreground:#cccccc; --vscode-descriptionForeground:#9d9d9d; --vscode-font-family:system-ui, sans-serif; --vscode-font-size:13px;
    --vscode-editor-font-family:monospace; --vscode-input-background:#3c3c3c; --vscode-input-foreground:#cccccc;
    --vscode-dropdown-background:#3c3c3c; --vscode-dropdown-foreground:#f0f0f0; --vscode-button-background:#0e639c;
    --vscode-button-foreground:#ffffff; --vscode-button-secondaryBackground:#3a3d41; --vscode-button-secondaryForeground:#ffffff;
    --vscode-panel-border:#3c3c3c; --vscode-list-hoverBackground:#2a2d2e; --vscode-list-inactiveSelectionBackground:#37373d;
    --vscode-list-activeSelectionBackground:#04395e; --vscode-list-activeSelectionForeground:#ffffff;
    --vscode-badge-background:#4d4d4d; --vscode-badge-foreground:#ffffff; --vscode-textLink-foreground:#3794ff;
    --vscode-focusBorder:#007fd4; --vscode-icon-foreground:#c5c5c5;`,
  light: `--vscode-editor-background:#ffffff; --vscode-panel-background:#ffffff; --vscode-sideBar-background:#f3f3f3;
    --vscode-foreground:#3b3b3b; --vscode-descriptionForeground:#717171; --vscode-font-family:system-ui, sans-serif; --vscode-font-size:13px;
    --vscode-editor-font-family:monospace; --vscode-input-background:#ffffff; --vscode-input-foreground:#3b3b3b; --vscode-input-border:#cecece;
    --vscode-dropdown-background:#ffffff; --vscode-dropdown-foreground:#3b3b3b; --vscode-dropdown-border:#cecece;
    --vscode-button-background:#005fb8; --vscode-button-foreground:#ffffff; --vscode-button-secondaryBackground:#e5e5e5;
    --vscode-button-secondaryForeground:#3b3b3b; --vscode-panel-border:#e5e5e5; --vscode-list-hoverBackground:#f2f2f2;
    --vscode-list-inactiveSelectionBackground:#e4e6f1; --vscode-list-activeSelectionBackground:#e8e8e8;
    --vscode-badge-background:#cccccc; --vscode-badge-foreground:#3b3b3b; --vscode-textLink-foreground:#005fb8;
    --vscode-focusBorder:#005fb8; --vscode-icon-foreground:#3b3b3b;`,
};

function page(bundle, theme) {
  const js = readFileSync(join(root, "dist", `${bundle}.js`), "utf8");
  const css = readFileSync(join(root, "dist", `${bundle}.css`), "utf8");
  const codicon = readFileSync(join(root, "dist", "codicon.css"), "utf8").replace(
    /url\("\.\/codicon\.ttf[^"]*"\)/,
    `url("data:font/ttf;base64,${readFileSync(join(root, "dist", "codicon.ttf")).toString("base64")}")`,
  );
  // Same policy as the real webview (src/extension/html.ts), assets inlined.
  const csp =
    "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'nonce-test'";
  return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}">
<style>html{${THEMES[theme]}}</style><style>${codicon}</style><style>${css}</style></head>
<body class="vscode-${theme}"><div id="app"></div>
  <script nonce="test">window.__sent=[];window.acquireVsCodeApi=()=>({postMessage:(m)=>window.__sent.push(m),getState:()=>undefined,setState:()=>{}});
    document.addEventListener("securitypolicyviolation", (e) => console.error("CSP violation: " + e.violatedDirective));</script>
  <script nonce="test">${js.replace(/<\/script/g, "<\\/script")}</script>
</body></html>`;
}

// ---- Runner ---------------------------------------------------------------------------------

export const browser = await chromium.launch({ executablePath: chromiumPath() });
let failures = 0;

export function finish() {
  return browser.close().then(() => {
    console.log(failures ? `${failures} browser test(s) failed` : "all browser tests passed");
    process.exit(failures ? 1 : 0);
  });
}

export async function scenario(
  name,
  bundle,
  fn,
  theme = "dark",
  viewport = { width: 1300, height: 330 },
) {
  const p = await browser.newPage({ viewport });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await p.setContent(page(bundle, theme));
  try {
    await fn(p);
    assert.deepEqual(errors, [], "no page errors");
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name}\n    ${e.message.split("\n").join("\n    ")}`);
    await p.screenshot({ path: join(shots, `FAILED-${name.replace(/\W+/g, "_")}.png`) });
  }
  await p.close();
}

export const postToPage = (p, message) => p.evaluate((m) => window.postMessage(m, "*"), message);
export const sent = (p, type) => p.evaluate((t) => window.__sent.filter((m) => m.type === t), type);
