import * as vscode from "vscode";

/** HTML shell of a webview view, with a strict Content-Security-Policy (bundled assets only). */
export function webviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  bundle: "log" | "commit",
  title: string,
): string {
  const asset = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", file));
  const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join(
    "",
  );
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${asset("codicon.css")}">
  <link rel="stylesheet" href="${asset(`${bundle}.css`)}">
  <title>${title}</title>
</head>
<body data-vscode-context='{"preventDefaultContextMenuItems": true}'>
  <div id="app"></div>
  <script nonce="${nonce}" src="${asset(`${bundle}.js`)}"></script>
</body>
</html>`;
}
