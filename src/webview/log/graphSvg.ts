import type { GraphRow } from "../../shared/graph";

export const ROW_HEIGHT = 22;
export const LANE_WIDTH = 12;

/** Lane colours, readable on light and dark backgrounds. */
export const LANE_COLORS = [
  "#3b82f6",
  "#e5892a",
  "#22a06b",
  "#d6457a",
  "#9b6ee6",
  "#14a3b8",
  "#c9a227",
  "#e5534b",
];

export const laneColor = (index: number): string => LANE_COLORS[index % LANE_COLORS.length];

const SVG = "http://www.w3.org/2000/svg";

/** One row of the graph; `isHead` draws the commit as a ring. */
export function graphSvg(row: GraphRow, isHead: boolean): SVGSVGElement {
  const width = row.width * LANE_WIDTH;
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(ROW_HEIGHT));
  svg.setAttribute("class", "graph");
  const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2;
  for (const s of row.segments) {
    const line = document.createElementNS(SVG, "line");
    line.setAttribute("x1", String(x(s.x1)));
    line.setAttribute("y1", String(s.y1 * ROW_HEIGHT));
    line.setAttribute("x2", String(x(s.x2)));
    line.setAttribute("y2", String(s.y2 * ROW_HEIGHT));
    line.setAttribute("stroke", laneColor(s.color));
    svg.append(line);
  }
  const dot = document.createElementNS(SVG, "circle");
  dot.setAttribute("cx", String(x(row.col)));
  dot.setAttribute("cy", String(ROW_HEIGHT / 2));
  dot.setAttribute("r", isHead ? "4" : "3.5");
  const color = laneColor(row.color);
  dot.setAttribute("fill", isHead ? "var(--vscode-editor-background, #fff)" : color);
  dot.setAttribute("stroke", color);
  dot.setAttribute("stroke-width", isHead ? "2" : "1");
  svg.append(dot);
  return svg;
}
