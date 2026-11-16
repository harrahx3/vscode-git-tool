// Bundles the extension host (CommonJS, Node) and the two webviews (IIFE, browser) + their CSS,
// and copies the codicon font used by the webviews.
import { copyFileSync, mkdirSync } from "node:fs";
import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : "linked",
  logLevel: "info",
};

const webview = (name) => [
  {
    ...common,
    entryPoints: [`src/webview/${name}/main.ts`],
    outfile: `dist/${name}.js`,
    platform: "browser",
    format: "iife",
    target: "es2022",
  },
  { ...common, entryPoints: [`src/webview/${name}/${name}.css`], outfile: `dist/${name}.css` },
];

const builds = [
  {
    ...common,
    entryPoints: ["src/extension/extension.ts"],
    outfile: "dist/extension.js",
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
  },
  ...webview("log"),
  ...webview("commit"),
];

mkdirSync("dist", { recursive: true });
for (const file of ["codicon.css", "codicon.ttf"])
  copyFileSync(`node_modules/@vscode/codicons/dist/${file}`, `dist/${file}`);

if (watch) {
  for (const options of builds) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
