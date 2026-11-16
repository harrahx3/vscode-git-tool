// Lane layout of the commit graph. Pure, tested in test/unit/graph.test.ts.
//
// Commits arrive children-first (git log --date-order or --topo-order). Each lane holds the hash
// of the commit it is waiting for. A commit takes the leftmost lane waiting for it; any other
// lane waiting for it converges into it. Its first parent continues in its lane (same colour);
// further parents (merges) go to the lane already waiting for them or to a new lane.

/** Vertical positions within a row: top edge, centre (the commit dot), bottom edge. */
export type RowY = 0 | 0.5 | 1;

export interface Segment {
  x1: number;
  y1: RowY;
  x2: number;
  y2: RowY;
  /** Colour index (cycle it through a palette). */
  color: number;
}

export interface GraphRow {
  /** Lane of the commit dot. */
  col: number;
  color: number;
  /** Number of lanes the row spans. */
  width: number;
  segments: Segment[];
}

export function layoutGraph(commits: { hash: string; parents: string[] }[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  const laneColor: number[] = [];
  let nextColor = 0;
  const rows: GraphRow[] = [];

  const allocate = (): number => {
    const free = lanes.indexOf(null);
    if (free >= 0) return free;
    lanes.push(null);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    const segments: Segment[] = [];
    const widthBefore = lanes.length;

    // Top half: every live lane runs down to the centre, those waiting for this commit bend in.
    let col = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === commit.hash && col < 0) col = i;
    }
    if (col < 0) {
      col = allocate();
      laneColor[col] = nextColor++;
    }
    for (let i = 0; i < lanes.length; i++) {
      const waiting = lanes[i];
      if (waiting === null) continue;
      const target = waiting === commit.hash ? col : i;
      segments.push({ x1: i, y1: 0, x2: target, y2: 0.5, color: laneColor[i] });
      if (waiting === commit.hash) lanes[i] = null;
    }
    const color = laneColor[col];

    // Bottom half: parents.
    const fresh = new Set<number>();
    const [first, ...others] = commit.parents;
    if (first !== undefined) {
      const existing = lanes.indexOf(first);
      if (existing >= 0) {
        segments.push({ x1: col, y1: 0.5, x2: existing, y2: 1, color });
      } else {
        lanes[col] = first;
        laneColor[col] = color;
        fresh.add(col);
        segments.push({ x1: col, y1: 0.5, x2: col, y2: 1, color });
      }
    }
    for (const parent of others) {
      let lane = lanes.indexOf(parent);
      if (lane < 0) {
        lane = allocate();
        lanes[lane] = parent;
        laneColor[lane] = nextColor++;
        fresh.add(lane);
      }
      segments.push({ x1: col, y1: 0.5, x2: lane, y2: 1, color: laneColor[lane] });
    }
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] !== null && !fresh.has(i) && i !== col) {
        segments.push({ x1: i, y1: 0.5, x2: i, y2: 1, color: laneColor[i] });
      }
    }

    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    const width = Math.max(widthBefore, lanes.length, col + 1);
    rows.push({ col, color, width, segments });
  }
  return rows;
}
