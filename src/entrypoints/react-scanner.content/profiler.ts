import type { FiberNode } from "./types";
import type { ProfileCommitData, ProfileFiberNode, HookInfo, ChangedProp, ChangedContext, DiffTreeNode } from "@/types";
import { getFiberName, findNearestDomElement } from "./fiber";
import { highlightElement, hideHighlight } from "./highlight";
import { inspectHooksOfFiberDirect } from "./hooks";
import { getTypeByTypeId } from "./state";

const componentTags = new Set([0, 1, 11, 14, 15]);

/**
 * Determines if a component fiber actually rendered during the current commit.
 *
 * Mirrors React DevTools' approach (recordProfilingDurations + didFiberRender):
 * DevTools stores each fiber's reference in fiberInstance.data across ALL commits.
 * On each commit it compares prevFiber !== nextFiber to detect bail-outs.
 *
 * We replicate this with a WeakSet maintained on EVERY commit (not just during
 * profiling). This means profiling starts with an accurate baseline — matching
 * React DevTools' behavior where fiberInstance.data is always up-to-date.
 */
function didFiberRender(fiber: FiberNode): boolean {
  return !previousCommitFibers.has(fiber);
}

/**
 * Fiber reference tracking — maintained on EVERY commit, not just during profiling.
 *
 * React DevTools keeps fiberInstance.data updated across all commits so that
 * profiling always has a correct baseline. We replicate this by collecting
 * all component fiber references on every onCommitFiberRoot call.
 *
 * - previousCommitFibers: component fibers from the previous commit
 * - currentCommitFibers: component fibers being collected for the current commit
 */
let previousCommitFibers = new WeakSet<FiberNode>();
let currentCommitFibers = new WeakSet<FiberNode>();

/**
 * Walks the fiber tree and collects all component fiber references into a set.
 * This is intentionally lightweight — only WeakSet.add per component fiber.
 */
function collectComponentFiberRefs(fiber: FiberNode, set: WeakSet<FiberNode>) {
  if (componentTags.has(fiber.tag)) {
    set.add(fiber);
  }
  let child = fiber.child;
  while (child) {
    collectComponentFiberRefs(child, set);
    child = child.sibling;
  }
}

let profiling = false;
let targetType: unknown | undefined;
let targetComponentName: string | undefined;
let commitIdCounter = 0;
let profilerNodeIdCounter = 0;

/** Maps profiler node IDs to their nearest DOM elements for highlighting */
export const profilerNodeToElementMap = new Map<number, Element>();

/** Maps profiler node IDs to fibers for hook inspection */
const profilerNodeToFiberMap = new Map<number, FiberNode>();

function nextProfilerNodeId(): number {
  return profilerNodeIdCounter++;
}

export function highlightProfilerNode(nodeId: number, nodeName: string) {
  const el = profilerNodeToElementMap.get(nodeId);
  if (!el) {
    hideHighlight();
    return;
  }
  highlightElement(nodeId, nodeName, el);
}

export function startProfiling(targetTypeId?: number, targetName?: string) {
  profiling = true;
  targetType = targetTypeId != null ? getTypeByTypeId(targetTypeId) : undefined;
  targetComponentName = targetName?.trim() || undefined;
  commitIdCounter = 0;
  profilerNodeIdCounter = 0;
  profilerNodeToElementMap.clear();
  profilerNodeToFiberMap.clear();
  // NOTE: previousCommitFibers/currentCommitFibers are NOT reset here.
  // They are maintained across all commits (even outside profiling) so that
  // profiling starts with an accurate baseline — matching React DevTools'
  // fiberInstance.data approach.
}

export function stopProfiling() {
  profiling = false;
}

/**
 * Called from watcher.ts on every onCommitFiberRoot.
 * Always tracks fiber references for bail-out detection (even when not profiling).
 * Only collects profiling data when profiling is active.
 */
export function onCommitForProfiling(fiberRoot: { current?: FiberNode }) {
  if (!fiberRoot?.current) return;

  // Always track fiber references — swap sets and collect current tree refs.
  // This runs on every commit so that when profiling starts, previousCommitFibers
  // already has the correct baseline (matching React DevTools' fiberInstance.data).
  previousCommitFibers = currentCommitFibers;
  currentCommitFibers = new WeakSet<FiberNode>();
  collectComponentFiberRefs(fiberRoot.current, currentCommitFibers);

  if (!profiling) return;

  const roots: ProfileFiberNode[] = [];

  const hasTarget = targetType !== undefined || targetComponentName !== undefined;

  if (hasTarget) {
    const targetFibers = targetType !== undefined
      ? findTargetFibersByType(fiberRoot.current, targetType)
      : findTargetFibersByName(fiberRoot.current, targetComponentName!);
    for (const fiber of targetFibers) {
      walkFiberForProfiling(fiber, roots);
    }
  } else {
    walkFiberForProfiling(fiberRoot.current, roots);
  }

  if (roots.length === 0) return;

  // When targeted, only record commits where at least one target instance actually rendered
  if (hasTarget && !roots.some((r) => r.didRender)) return;

  let duration = 0;
  for (const root of roots) {
    duration = Math.max(duration, root.totalDuration);
  }

  const commit: ProfileCommitData = {
    id: ++commitIdCounter,
    duration,
    timestamp: Date.now(),
    roots,
  };

  window.postMessage({ type: "PROFILING_COMMIT", commit }, "*");
}

function findTargetFibersByType(fiber: FiberNode, matchType: unknown): FiberNode[] {
  const results: FiberNode[] = [];
  collectTargetFibersByType(fiber, matchType, results);
  return results;
}

function collectTargetFibersByType(
  fiber: FiberNode,
  matchType: unknown,
  out: FiberNode[],
): void {
  if (componentTags.has(fiber.tag) && fiber.type === matchType) {
    out.push(fiber);
    return;
  }
  let child = fiber.child;
  while (child) {
    collectTargetFibersByType(child, matchType, out);
    child = child.sibling;
  }
}

function findTargetFibersByName(fiber: FiberNode, name: string): FiberNode[] {
  const results: FiberNode[] = [];
  collectTargetFibersByName(fiber, name, results);
  return results;
}

function collectTargetFibersByName(
  fiber: FiberNode,
  name: string,
  out: FiberNode[],
): void {
  if (componentTags.has(fiber.tag)) {
    const nameResult = getFiberName(fiber);
    if (nameResult && nameResult.name === name) {
      out.push(fiber);
      return;
    }
  }
  let child = fiber.child;
  while (child) {
    collectTargetFibersByName(child, name, out);
    child = child.sibling;
  }
}

function walkFiberForProfiling(
  fiber: FiberNode,
  out: ProfileFiberNode[],
): void {
  const isComponent = componentTags.has(fiber.tag);

  if (isComponent) {
    const nameResult = getFiberName(fiber);
    if (nameResult) {
      const children: ProfileFiberNode[] = [];
      let child = fiber.child;
      while (child) {
        walkFiberForProfiling(child, children);
        child = child.sibling;
      }

      // totalDuration = full subtree time (includes children)
      const totalDuration = fiber.actualDuration ?? 0;
      const baseDuration = fiber.treeBaseDuration ?? fiber.selfBaseDuration ?? 0;

      // selfDuration = this component's own render cost.
      // React accumulates actualDuration by adding each direct fiber child's
      // actualDuration in bubbleProperties, so:
      //   fiber.actualDuration = ownRenderTime + Σ directFiberChild.actualDuration
      // We sum ALL direct fiber children (not just component children) to
      // avoid "leaking" time from intermediate non-component fibers (DOM
      // elements, Context.Provider, Fragment, etc.) into selfDuration.
      let directChildrenDuration = 0;
      let fiberChild = fiber.child;
      while (fiberChild) {
        directChildrenDuration += fiberChild.actualDuration ?? 0;
        fiberChild = fiberChild.sibling;
      }
      const selfDuration = Math.max(0, totalDuration - directChildrenDuration);

      const didRender = didFiberRender(fiber);

      const nodeId = nextProfilerNodeId();
      profilerNodeToFiberMap.set(nodeId, fiber);
      const domEl = findNearestDomElement(fiber);
      if (domEl) {
        profilerNodeToElementMap.set(nodeId, domEl);
      }

      let renderReasons: string[] | undefined;
      let changedHookIndices: number[] | undefined;
      let changedProps: ChangedProp[] | undefined;
      let changedContexts: ChangedContext[] | undefined;
      if (didRender) {
        const result = detectRenderReasons(fiber);
        renderReasons = result.reasons;
        changedHookIndices = result.changedHookIndices;
        changedProps = result.changedProps;
        changedContexts = result.changedContexts;
      }

      out.push({
        nodeId,
        name: nameResult.name,
        hocs: nameResult.hocs.length > 0 ? nameResult.hocs : undefined,
        selfDuration,
        totalDuration,
        baseDuration,
        children,
        didRender,
        renderReasons,
        changedHookIndices,
        changedProps,
        changedContexts,
      });
      return;
    }
  }

  // Not a component — pass through to children
  let child = fiber.child;
  while (child) {
    walkFiberForProfiling(child, out);
    child = child.sibling;
  }
}

const MAX_SERIALIZED_LENGTH = 200;
const MAX_DIFF_DEPTH = 10;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !("$$typeof" in (value as Record<string, unknown>));
}

function buildDiffTree(prev: unknown, next: unknown, depth: number, seen = new WeakSet()): DiffTreeNode[] {
  if (depth > MAX_DIFF_DEPTH) return [];

  // Guard against circular references.
  // When prev === next (same object, e.g. state-change re-render), only add
  // once to avoid the second guard falsely detecting a cycle.
  if (typeof prev === "object" && prev !== null) {
    if (seen.has(prev)) return [];
    seen.add(prev);
  }
  if (typeof next === "object" && next !== null && next !== prev) {
    if (seen.has(next)) return [];
    seen.add(next);
  }

  if (isPlainObject(prev) && isPlainObject(next)) {
    const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    const nodes: DiffTreeNode[] = [];
    for (const key of allKeys) {
      const pv = prev[key];
      const nv = next[key];
      const changed = pv !== nv;
      // Always recurse into nested objects/arrays so the tree structure is
      // visible even when values haven't changed.
      const children = buildDiffTree(pv, nv, depth + 1, seen);
      nodes.push({
        key,
        changed,
        ...(children.length > 0
          ? { children }
          : { prevValue: serializePropValue(pv), nextValue: serializePropValue(nv) }),
      });
    }
    return nodes;
  }

  if (Array.isArray(prev) && Array.isArray(next)) {
    const nodes: DiffTreeNode[] = [];
    const maxLen = Math.max(prev.length, next.length);
    for (let i = 0; i < Math.min(maxLen, 10); i++) {
      const pv = i < prev.length ? prev[i] : undefined;
      const nv = i < next.length ? next[i] : undefined;
      const changed = pv !== nv;
      const children = buildDiffTree(pv, nv, depth + 1, seen);
      nodes.push({
        key: String(i),
        changed,
        ...(children.length > 0
          ? { children }
          : { prevValue: serializePropValue(pv), nextValue: serializePropValue(nv) }),
      });
    }
    if (prev.length !== next.length) {
      nodes.push({ key: "length", changed: true, prevValue: String(prev.length), nextValue: String(next.length) });
    }
    return nodes;
  }

  return [];
}

function serializePropValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "function") {
    return value.name ? `ƒ ${value.name}()` : "ƒ ()";
  }
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  // React element
  if (
    typeof value === "object" &&
    value !== null &&
    "$$typeof" in value
  ) {
    const el = value as { type?: { name?: string; displayName?: string } | string };
    const typeName =
      typeof el.type === "string"
        ? el.type
        : el.type?.displayName ?? el.type?.name ?? "Unknown";
    return `<${typeName} />`;
  }

  try {
    const json = JSON.stringify(value, (_key, v) => {
      if (typeof v === "function") return v.name ? `ƒ ${v.name}()` : "ƒ ()";
      if (typeof v === "symbol") return v.toString();
      if (typeof v === "undefined") return "undefined";
      return v;
    });
    if (json && json.length > MAX_SERIALIZED_LENGTH) {
      return json.slice(0, MAX_SERIALIZED_LENGTH) + "…";
    }
    return json ?? "undefined";
  } catch {
    if (Array.isArray(value)) return `Array(${value.length})`;
    return "{…}";
  }
}

/**
 * Walk up fiber.return to find the nearest ancestor component that actually
 * rendered in this commit (i.e. its fiber reference changed). Returns its
 * display name, or null if none found.
 */
function findRenderedAncestorName(fiber: FiberNode): string | null {
  let parent = fiber.return;
  while (parent) {
    if (componentTags.has(parent.tag) && !previousCommitFibers.has(parent)) {
      const nameResult = getFiberName(parent);
      if (nameResult) return nameResult.name;
    }
    parent = parent.return;
  }
  return null;
}

function detectRenderReasons(fiber: FiberNode): { reasons: string[]; changedHookIndices?: number[]; changedProps?: ChangedProp[]; changedContexts?: ChangedContext[] } {
  const reasons: string[] = [];
  let changedHookIndices: number[] | undefined;
  let changedProps: ChangedProp[] | undefined;
  let changedContexts: ChangedContext[] | undefined;
  const alt = fiber.alternate;

  if (!alt) {
    return { reasons: ["First render"] };
  }

  // Props changed — compare individual keys regardless of object reference.
  // (prevProps === nextProps can happen on state-change re-renders, but we
  // still compare keys so we don't miss anything.)
  const prevProps = alt.memoizedProps;
  const nextProps = fiber.memoizedProps;
  if (prevProps && nextProps) {
    const changed: string[] = [];
    const propDiffs: ChangedProp[] = [];
    const allKeys = new Set([
      ...Object.keys(prevProps),
      ...Object.keys(nextProps),
    ]);
    for (const key of allKeys) {
      if (prevProps[key] !== nextProps[key]) {
        changed.push(key);
        const diffTree = buildDiffTree(prevProps[key], nextProps[key], 0);
        propDiffs.push({
          name: key,
          prevValue: serializePropValue(prevProps[key]),
          nextValue: serializePropValue(nextProps[key]),
          ...(diffTree.length > 0 ? { diffTree } : {}),
        });
      }
    }
    if (changed.length > 0) {
      reasons.push(`Props changed: ${changed.join(", ")}`);
      changedProps = propDiffs;
    }
  }

  // Hook changes — compare raw memoizedState values, map to hook tree IDs
  if (alt.memoizedState !== fiber.memoizedState) {
    const indices = detectHookChanges(
      alt.memoizedState,
      fiber.memoizedState,
      fiber._debugHookTypes,
    );
    if (indices.length > 0) {
      changedHookIndices = indices;
      reasons.push(`Hook(s) ${indices.join(", ")} changed`);
    }
  }

  // Context changed
  // Context changed — compare memoizedValue between alternate and current fiber dependencies
  if (fiber.dependencies?.firstContext && alt.dependencies?.firstContext) {
    type ContextDep = {
      memoizedValue?: unknown;
      context?: { displayName?: string; _context?: { displayName?: string } };
      next?: unknown;
    };
    const contextDiffs: ChangedContext[] = [];
    let currCtx = fiber.dependencies.firstContext as ContextDep | null;
    let prevCtx = alt.dependencies.firstContext as ContextDep | null;
    let contextIndex = 0;
    while (currCtx && prevCtx) {
      const prevValue = prevCtx.memoizedValue;
      const nextValue = currCtx.memoizedValue;
      if (prevValue !== nextValue) {
        const contextName =
          currCtx.context?.displayName ??
          currCtx.context?._context?.displayName ??
          `Context(${contextIndex})`;
        const diffTree = buildDiffTree(prevValue, nextValue, 0);
        contextDiffs.push({
          name: contextName,
          prevValue: serializePropValue(prevValue),
          nextValue: serializePropValue(nextValue),
          ...(diffTree.length > 0 ? { diffTree } : {}),
        });
      }
      contextIndex++;
      currCtx = currCtx.next as ContextDep | null;
      prevCtx = prevCtx.next as ContextDep | null;
    }
    if (contextDiffs.length > 0) {
      reasons.push(`Context changed: ${contextDiffs.map((c) => c.name).join(", ")}`);
      changedContexts = contextDiffs;
    }
  }

  if (reasons.length === 0) {
    // Walk up the fiber tree to find the nearest ancestor component that
    // actually rendered, so the user knows exactly who triggered this render.
    const parentName = findRenderedAncestorName(fiber);
    reasons.push(parentName
      ? `Parent re-rendered: ${parentName}`
      : "Parent re-rendered");
  }

  return { reasons, changedHookIndices, changedProps, changedContexts };
}

// --- Hook change detection ---
// Uses raw memoizedState comparison (avoids serialization false positives)
// and maps to hook tree IDs via _debugHookTypes

interface HookNode {
  memoizedState: unknown;
  next: HookNode | null;
}

function isHookNode(v: unknown): v is HookNode {
  return (
    typeof v === "object" &&
    v !== null &&
    "memoizedState" in v &&
    "next" in v
  );
}

/**
 * Hooks that can CAUSE a re-render (matching React DevTools' isStateEditable).
 * Only useState and useReducer — their memoizedState is the raw state value,
 * so reference comparison works reliably.
 * Other hooks (useMemo, useEffect, useTransition, etc.) change as a RESULT
 * of re-rendering and should not be reported as causes.
 */
const STATEFUL_HOOK_TYPES = new Set([
  "useState",
  "useReducer",
  "useSyncExternalStore",
]);

/** Hooks that don't create memoizedState linked list entries */
const NO_MEMOIZED_STATE_HOOKS = new Set([
  "useContext",
  "useDebugValue",
  "use",
]);

/**
 * Composite hooks that create EXTRA memoizedState nodes internally,
 * beyond the one tracked by _debugHookTypes.
 * - useSyncExternalStore: creates 1 extra node (internal mountEffect for subscription)
 * - useTransition: creates 1 extra node (startTransition function)
 */
const EXTRA_HOOK_NODES: Record<string, number> = {
  useSyncExternalStore: 1,
  useTransition: 1,
};

/**
 * Detect changed hooks by walking raw memoizedState linked lists.
 * Returns hook tree IDs (1-based, matching buildHookTree's nativeHookID assignment)
 * so that sidebar highlighting works correctly.
 */
function detectHookChanges(
  prevState: unknown,
  nextState: unknown,
  debugHookTypes?: string[] | null,
): number[] {
  const ids: number[] = [];

  if (!debugHookTypes) {
    return ids;
  }

  let prev = prevState;
  let next = nextState;
  // Matches buildHookTree: nativeHookID starts at 1, increments for every
  // hook EXCEPT Context, DebugValue, and "use" (which get id=null)
  let treeId = 1;

  for (let i = 0; i < debugHookTypes.length; i++) {
    const hookType = debugHookTypes[i];

    // These hooks don't create memoizedState entries and get no tree ID
    if (NO_MEMOIZED_STATE_HOOKS.has(hookType)) {
      continue;
    }

    if (!isHookNode(prev) || !isHookNode(next)) break;

    // Check stateful hooks for changes using raw reference comparison
    if (STATEFUL_HOOK_TYPES.has(hookType)) {
      if (prev.memoizedState !== next.memoizedState) {
        ids.push(treeId);
      }
    }

    treeId++;
    prev = (prev as HookNode).next;
    next = (next as HookNode).next;

    // Composite hooks (useSyncExternalStore, useTransition) create extra
    // internal memoizedState nodes that aren't tracked in _debugHookTypes.
    // Skip them to keep the linked list aligned.
    const extra = EXTRA_HOOK_NODES[hookType] ?? 0;
    for (let j = 0; j < extra; j++) {
      if (!isHookNode(prev) || !isHookNode(next)) break;
      prev = (prev as HookNode).next;
      next = (next as HookNode).next;
    }
  }

  return ids;
}

/** Inspect hooks of a profiler node by its profiler-assigned nodeId */
export function inspectProfilerNodeHooks(profilerNodeId: number): HookInfo[] | null {
  const fiber = profilerNodeToFiberMap.get(profilerNodeId);
  if (!fiber) return null;
  return inspectHooksOfFiberDirect(fiber);
}
