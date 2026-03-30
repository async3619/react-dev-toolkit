import type { HocBadge, ProfileFiberNode, ComponentNode, ChangedProp, ChangedContext } from "@/types";

// --- Component name collection ---

export interface ComponentNameEntry {
  name: string;
  typeId: number | null;
  count: number;
}

export function collectComponentNames(
  tree: ComponentNode[],
): ComponentNameEntry[] {
  const counts = new Map<number | string, { name: string; typeId: number | null; count: number }>();
  const walk = (nodes: ComponentNode[]) => {
    for (const node of nodes) {
      // Use typeId when available, fall back to name for backward compat
      const key: number | string = node.typeId ?? node.name;
      const entry = counts.get(key);
      if (entry) {
        entry.count++;
      } else {
        counts.set(key, { name: node.name, typeId: node.typeId ?? null, count: 1 });
      }
      walk(node.children);
    }
  };
  walk(tree);
  return [...counts.values()]
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- Constants ---

export const ROW_HEIGHT = 24;
export const TOOLTIP_OFFSET = 12;
export const CANVAS_PAD = 8;
export const LERP_SPEED = 0.18;

// --- Types ---

export interface FlatBar {
  nodeId: number;
  depth: number;
  leftPct: number;
  widthPct: number;
  name: string;
  selfDuration: number;
  totalDuration: number;
  hocs?: HocBadge[];
  didRender: boolean;
  intensity: number;
  renderReasons?: string[];
  changedHookIndices?: number[];
  changedProps?: ChangedProp[];
  changedContexts?: ChangedContext[];
  /** 0 = gray (not rendered), 1 = fully colored. Used for transition blending. */
  colorBlend?: number;
}

export interface FlameZoom {
  leftPct: number;
  widthPct: number;
  depth: number;
  anchorLeft: number;
  anchorWidth: number;
}

export interface ZoomAnim {
  currentLeft: number;
  currentWidth: number;
  targetLeft: number;
  targetWidth: number;
  depth: number;
  anchorLeft: number;
  anchorWidth: number;
}

export interface CommitTransition {
  progress: number;
  matched: Array<{
    bar: FlatBar;
    fromLeft: number;
    fromWidth: number;
    fromColorBlend: number;
    fromIntensity: number;
  }>;
  exiting: FlatBar[];
  entering: FlatBar[];
}

export interface DisplayRect {
  x: number;
  y: number;
  w: number;
  h: number;
  dimmed: boolean;
}

// --- Tree flattening ---

function effectiveDuration(node: ProfileFiberNode): number {
  return node.totalDuration > 0 ? node.totalDuration : node.baseDuration;
}

function findMaxSelfDuration(nodes: ProfileFiberNode[]): number {
  let max = 0;
  for (const node of nodes) {
    if (node.didRender && node.selfDuration > max) max = node.selfDuration;
    const childMax = findMaxSelfDuration(node.children);
    if (childMax > max) max = childMax;
  }
  return max;
}

function collectBars(
  node: ProfileFiberNode,
  depth: number,
  leftPct: number,
  widthPct: number,
  maxSelf: number,
  bars: FlatBar[],
) {
  const isRendered = node.didRender;
  const intensity =
    isRendered && maxSelf > 0 ? Math.min(1, node.selfDuration / maxSelf) : 0;

  bars.push({
    nodeId: node.nodeId,
    depth,
    leftPct,
    widthPct,
    name: node.name,
    selfDuration: node.selfDuration,
    totalDuration: node.totalDuration,
    hocs: node.hocs,
    didRender: isRendered,
    intensity,
    renderReasons: node.renderReasons,
    changedHookIndices: node.changedHookIndices,
    changedProps: node.changedProps,
    changedContexts: node.changedContexts,
  });

  if (node.children.length === 0) return;

  const childEffectiveSum = node.children.reduce(
    (s, c) => s + effectiveDuration(c),
    0,
  );

  let childLeftPct = leftPct;
  for (const child of node.children) {
    const childWidthPct =
      childEffectiveSum > 0
        ? (effectiveDuration(child) / childEffectiveSum) * widthPct
        : 0;
    if (childWidthPct > 0) {
      collectBars(child, depth + 1, childLeftPct, childWidthPct, maxSelf, bars);
    }
    childLeftPct += childWidthPct;
  }
}

export function flattenTree(
  roots: ProfileFiberNode[],
): { bars: FlatBar[]; maxDepth: number } {
  const bars: FlatBar[] = [];
  let maxDepth = 0;
  const maxSelf = findMaxSelfDuration(roots);

  const rootEffectiveSum = roots.reduce(
    (s, r) => s + effectiveDuration(r),
    0,
  );
  let rootLeftPct = 0;

  for (const root of roots) {
    const rootWidthPct =
      rootEffectiveSum > 0
        ? (effectiveDuration(root) / rootEffectiveSum) * 100
        : 100 / roots.length;
    if (rootWidthPct > 0) {
      collectBars(root, 0, rootLeftPct, rootWidthPct, maxSelf, bars);
    }
    rootLeftPct += rootWidthPct;
  }

  for (const bar of bars) {
    if (bar.depth > maxDepth) maxDepth = bar.depth;
  }

  return { bars, maxDepth };
}

export function collectRendered(
  nodes: ProfileFiberNode[],
): ProfileFiberNode[] {
  const result: ProfileFiberNode[] = [];
  for (const node of nodes) {
    if (node.didRender) result.push(node);
    result.push(...collectRendered(node.children));
  }
  return result;
}

// --- Transition ---

export function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

export function buildTransition(
  oldBars: FlatBar[],
  newBars: FlatBar[],
): CommitTransition {
  const oldMap = new Map<string, FlatBar[]>();
  for (const bar of oldBars) {
    const key = `${bar.name}\0${bar.depth}`;
    const arr = oldMap.get(key);
    if (arr) arr.push(bar);
    else oldMap.set(key, [bar]);
  }

  const matched: CommitTransition["matched"] = [];
  const entering: FlatBar[] = [];

  for (const bar of newBars) {
    const key = `${bar.name}\0${bar.depth}`;
    const arr = oldMap.get(key);
    if (arr && arr.length > 0) {
      const old = arr.shift()!;
      matched.push({
        bar,
        fromLeft: old.leftPct,
        fromWidth: old.widthPct,
        fromColorBlend: old.didRender ? 1 : 0,
        fromIntensity: old.intensity,
      });
    } else {
      entering.push(bar);
    }
  }

  const exiting = [...oldMap.values()].flat();

  return { progress: 0, matched, exiting, entering };
}

// --- Display rect & color ---

export function getDisplayRect(
  bar: FlatBar,
  contentWidth: number,
  zoom: FlameZoom | null,
): DisplayRect | null {
  let leftPct = bar.leftPct;
  let widthPct = bar.widthPct;
  let dimmed = false;

  if (zoom) {
    if (zoom.depth >= 0 && bar.depth < zoom.depth) {
      const barRight = bar.leftPct + bar.widthPct;
      const anchorRight = zoom.anchorLeft + zoom.anchorWidth;
      if (bar.leftPct <= zoom.anchorLeft && barRight >= anchorRight - 0.001) {
        leftPct = 0;
        widthPct = 100;
        dimmed = true;
      } else {
        return null;
      }
    } else if (zoom.depth >= 0 && bar.depth === zoom.depth) {
      if (
        Math.abs(bar.leftPct - zoom.anchorLeft) > 0.001 ||
        Math.abs(bar.widthPct - zoom.anchorWidth) > 0.001
      ) {
        return null;
      }
      leftPct = ((bar.leftPct - zoom.leftPct) / zoom.widthPct) * 100;
      widthPct = (bar.widthPct / zoom.widthPct) * 100;
    } else {
      leftPct = ((bar.leftPct - zoom.leftPct) / zoom.widthPct) * 100;
      widthPct = (bar.widthPct / zoom.widthPct) * 100;
      if (leftPct + widthPct <= 0 || leftPct >= 100) return null;
      if (leftPct < 0) {
        widthPct += leftPct;
        leftPct = 0;
      }
    }
  }

  const w = (widthPct / 100) * contentWidth;
  if (w < 0.5) return null;

  return {
    x: (leftPct / 100) * contentWidth + CANVAS_PAD,
    y: bar.depth * ROW_HEIGHT + CANVAS_PAD,
    w,
    h: ROW_HEIGHT - 1,
    dimmed,
  };
}

export function getBarColorBlended(
  intensity: number,
  blend: number,
  hover: boolean,
): string {
  const colorH = 45 - intensity * 20;
  const colorS = 50 + intensity * 20;
  const colorL = (hover ? 48 : 40) + intensity * 5;

  const grayH = 220;
  const grayS = 10;
  const grayL = hover ? 28 : 22;

  const h = grayH + (colorH - grayH) * blend;
  const s = grayS + (colorS - grayS) * blend;
  const l = grayL + (colorL - grayL) * blend;

  return `hsl(${h}, ${s}%, ${l}%)`;
}

export function getBarColor(intensity: number): string {
  return getBarColorBlended(intensity, 1, false);
}

export function getBarColorHover(intensity: number): string {
  return getBarColorBlended(intensity, 1, true);
}
