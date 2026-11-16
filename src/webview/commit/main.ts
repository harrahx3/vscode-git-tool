// Commit view: message, Amend, Commit / Commit and Push, and right under them the changed files
// grouped by changelist, ticked for the next commit (changes.ts).
import type { CommitFromWebview, CommitToWebview, CommitViewState } from "../../shared/messages";
import { h, icon, loadState, post, saveState } from "../common/dom";
import { ChangesList } from "./changes";

interface Persisted {
  message: string;
  amend: boolean;
  /** Keys of the collapsed groups. */
  collapsed: string[];
}

const persisted = loadState<Persisted>({ message: "", amend: false, collapsed: [] });
let view: CommitViewState = { included: 0, total: 0, lists: [] };
let busy = false;

const send = (m: CommitFromWebview) => post(m);
const persist = () => saveState(persisted);

const app = document.getElementById("app")!;
const branchLabel = h("span.branch");
const amendBox = h("input", { type: "checkbox", id: "amend" });
const message = h("textarea.message", {
  rows: 4,
  "aria-label": "Commit message",
  // Cut / Copy / Paste on right-click (the rest of the view shows only its own menu items).
  "data-vscode-context": JSON.stringify({ preventDefaultContextMenuItems: false }),
});
const commitButton = h("button.primary", { text: "Commit" });
const pushButton = h("button.secondary", { text: "Commit and Push…" });
const summary = h("span.summary");
const busyLabel = h("span.busy", { hidden: true });
const errorBar = h("div.error-bar", { hidden: true });

app.append(
  h(
    "div.commit-box",
    {},
    message,
    h("div.options", {}, h("label.amend", { for: "amend" }, amendBox, " Amend"), summary),
    h("div.buttons", {}, commitButton, pushButton),
    h("div.status", {}, branchLabel, busyLabel),
    errorBar,
  ),
);

const collapsed = new Set(persisted.collapsed);
const list = new ChangesList({
  send,
  collapsed,
  onCollapse: () => {
    persisted.collapsed = [...collapsed];
    persist();
  },
});
app.append(list.element);

message.value = persisted.message;
amendBox.checked = persisted.amend;

message.addEventListener("input", () => {
  persisted.message = message.value;
  persist();
  updateButtons();
});
message.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    doCommit(false);
  }
});
amendBox.addEventListener("change", () => {
  persisted.amend = amendBox.checked;
  if (amendBox.checked && !message.value.trim() && view.lastMessage)
    message.value = view.lastMessage;
  else if (!amendBox.checked && message.value === view.lastMessage) message.value = "";
  persisted.message = message.value;
  persist();
  updateButtons();
});
commitButton.addEventListener("click", () => doCommit(false));
pushButton.addEventListener("click", () => doCommit(true));

function updateButtons(): void {
  const n = view.included;
  const ready = !busy && !!message.value.trim() && (n > 0 || amendBox.checked);
  commitButton.disabled = pushButton.disabled = !ready;
  commitButton.textContent = amendBox.checked ? "Amend Commit" : "Commit";
  pushButton.textContent = amendBox.checked ? "Amend and Push…" : "Commit and Push…";
  commitButton.title = n
    ? `Commit ${n} file${n === 1 ? "" : "s"} (Ctrl+Enter)`
    : "Tick the files to commit in the list below";
  summary.textContent = view.total
    ? `${n} of ${view.total} file${view.total === 1 ? "" : "s"}`
    : "";
  const on = view.branch ? ` on '${view.branch}'` : "";
  message.placeholder = `Message (Ctrl+Enter to commit${on})`;
}

function doCommit(push: boolean): void {
  updateButtons();
  if (commitButton.disabled) return;
  send({ type: "commit", message: message.value, amend: amendBox.checked, push });
}

window.addEventListener("message", (event: MessageEvent<CommitToWebview>) => {
  const m = event.data;
  switch (m.type) {
    case "state": {
      view = m.state;
      errorBar.hidden = true;
      const ahead = view.ahead ? ` ↑${view.ahead}` : "";
      const parts = [view.repoName, view.branch && `${view.branch}${ahead}`].filter(Boolean);
      branchLabel.replaceChildren(
        ...(parts.length ? [icon("git-branch"), " ", parts.join(" · ")] : []),
      );
      list.update(view.lists, view.notice);
      updateButtons();
      break;
    }
    case "busy":
      busy = m.busy;
      busyLabel.hidden = !m.busy;
      busyLabel.textContent = m.label ?? "";
      updateButtons();
      break;
    case "committed":
      message.value = "";
      amendBox.checked = false;
      persisted.message = "";
      persisted.amend = false;
      persist();
      updateButtons();
      break;
    case "error":
      errorBar.textContent = m.message;
      errorBar.hidden = false;
      break;
  }
});

updateButtons();
send({ type: "ready" });
