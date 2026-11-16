// Icons the codicon font lacks: `git-branch-create` is only an alias of `git-branch` there, so
// "New branch" and "Checkout" would look the same. Same drawings as media/branch-*.svg.
const BRANCH =
  '<circle cx="4" cy="3" r="1.6"/><circle cx="4" cy="13" r="1.6"/><circle cx="11" cy="3.5" r="1.6"/><path d="M4 4.6v6.8M11 5.1c0 3.2-6.2 2.6-6.8 6.3"/>';
const BADGES = {
  "branch-new": '<path d="M12.5 9.5v5.5M9.75 12.25h5.5"/>',
  "branch-checkout": '<path d="M9.5 9.5h5.5M13 7.5l2 2-2 2M15 13.3H9.5M11.5 11.3l-2 2 2 2"/>',
};

export type SvgIconName = keyof typeof BADGES;

/** A 16 px icon drawn in the current text color, sized like a codicon. */
export function svgIcon(name: SvgIconName): HTMLElement {
  const span = document.createElement("span");
  span.className = "svg-icon";
  span.setAttribute("aria-hidden", "true");
  span.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
    `stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${BRANCH}${BADGES[name]}</svg>`;
  return span;
}
