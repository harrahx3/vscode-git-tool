// Small DOM helpers shared by both webviews.

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const api = acquireVsCodeApi();

export function post<T>(message: T): void {
  api.postMessage(message);
}

export function loadState<T>(fallback: T): T {
  return { ...fallback, ...((api.getState() as Partial<T> | undefined) ?? {}) };
}

export function saveState<T>(state: T): void {
  api.setState(state);
}

type Attrs = Record<string, string | number | boolean | undefined | null>;
type Child = Node | string | null | undefined | false;

/** Creates an element: `h("div.row.selected", { title: "x" }, child, …)`. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tagAndClasses: K | `${K}.${string}`,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = tagAndClasses.split(".");
  const el = document.createElement(tag as K);
  if (classes.length) el.className = classes.join(" ");
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "text") el.textContent = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

/** `data-vscode-context` value: drives the native context menus (`webview/context`). */
export function menuContext(ctx: Record<string, unknown>): string {
  return JSON.stringify({ preventDefaultContextMenuItems: true, ...ctx });
}

export function icon(name: string, title?: string): HTMLElement {
  return h(("span.codicon.codicon-" + name) as "span", {
    title,
    "aria-hidden": title ? undefined : "true",
  });
}

/** A toolbar button; `name` is a codicon name, or an element such as `svgIcon(…)`. */
export function iconButton(
  name: string | HTMLElement,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const glyph = typeof name === "string" ? icon(name) : name;
  const b = h("button.icon-button", { title, "aria-label": title }, glyph);
  b.addEventListener("click", onClick);
  return b;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Lets the user drag a splitter to resize `target` (width in px), remembered via `onDone`. */
export function makeSplitter(
  splitter: HTMLElement,
  target: HTMLElement,
  side: "left" | "right",
  onDone: (width: number) => void,
): void {
  splitter.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    splitter.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = target.getBoundingClientRect().width;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const w = Math.max(120, startW + (side === "left" ? dx : -dx));
      target.style.width = `${w}px`;
    };
    const up = () => {
      splitter.removeEventListener("pointermove", move);
      splitter.removeEventListener("pointerup", up);
      onDone(target.getBoundingClientRect().width);
    };
    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("pointerup", up);
  });
}
