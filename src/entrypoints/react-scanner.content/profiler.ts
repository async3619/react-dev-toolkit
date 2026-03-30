import type { FiberNode } from "./types";
import type { ProfileCommitData, ProfileFiberNode, HookInfo } from "@/types";
import { getFiberName, findNearestDomElement } from "./fiber";
import { highlightElement, hideHighlight } from "./highlight";
import { inspectHooksOfFiberDirect } from "./hooks";

const componentTags = new Set([0, 1, 11, 14, 15]);

let profiling = false;
let anchorComponent: string | undefined;
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

export function startProfiling(anchor?: string) {
  profiling = true;
  anchorComponent = anchor?.trim() || undefined;
  commitIdCounter = 0;
  profilerNodeIdCounter = 0;
  profilerNodeToElementMap.clear();
  profilerNodeToFiberMap.clear();
}

export function stopProfiling() {
  profiling = false;
}

/**
 * Called from watcher.ts on every onCommitFiberRoot.
 * Only collects data when profiling is active.
 */
export function onCommitForProfiling(fiberRoot: { current?: FiberNode }) {
  if (!profiling) return;
  if (!fiberRoot?.current) return;

  const roots: ProfileFiberNode[] = [];

  if (anchorComponent) {
    const anchorFibers = findAnchorFibers(fiberRoot.current, anchorComponent);
    for (const fiber of anchorFibers) {
      walkFiberForProfiling(fiber, roots);
    }
  } else {
    walkFiberForProfiling(fiberRoot.current, roots);
  }

  if (roots.length === 0) return;

  // When anchored, only record commits where at least one anchor instance actually rendered
  if (anchorComponent && !roots.some((r) => r.didRender)) return;

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

function findAnchorFibers(fiber: FiberNode, name: string): FiberNode[] {
  const results: FiberNode[] = [];
  collectAnchorFibers(fiber, name, results);
  return results;
}

function collectAnchorFibers(
  fiber: FiberNode,
  name: string,
  out: FiberNode[],
): void {
  if (componentTags.has(fiber.tag)) {
    const nameResult = getFiberName(fiber);
    if (nameResult && nameResult.name === name) {
      out.push(fiber);
      // Don't recurse into children — nested instances are part of this subtree
      return;
    }
  }
  let child = fiber.child;
  while (child) {
    collectAnchorFibers(child, name, out);
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

      // selfDuration = this component's own cost (subtract ALL children's subtree time)
      const childrenTotalSum = children.reduce(
        (sum, c) => sum + c.totalDuration,
        0,
      );
      const selfDuration = Math.max(0, totalDuration - childrenTotalSum);

      // Component rendered itself if it had self-cost
      const didRender = selfDuration > 0;

      const nodeId = nextProfilerNodeId();
      profilerNodeToFiberMap.set(nodeId, fiber);
      const domEl = findNearestDomElement(fiber);
      if (domEl) {
        profilerNodeToElementMap.set(nodeId, domEl);
      }

      let renderReasons: string[] | undefined;
      let changedHookIndices: number[] | undefined;
      if (didRender) {
        const result = detectRenderReasons(fiber);
        renderReasons = result.reasons;
        changedHookIndices = result.changedHookIndices;
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

function detectRenderReasons(fiber: FiberNode): { reasons: string[]; changedHookIndices?: number[] } {
  const reasons: string[] = [];
  let changedHookIndices: number[] | undefined;
  const alt = fiber.alternate;

  if (!alt) {
    return { reasons: ["First render"] };
  }

  // Props changed
  const prevProps = alt.memoizedProps;
  const nextProps = fiber.memoizedProps;
  if (prevProps && nextProps && prevProps !== nextProps) {
    const changed: string[] = [];
    const allKeys = new Set([
      ...Object.keys(prevProps),
      ...Object.keys(nextProps),
    ]);
    for (const key of allKeys) {
      if (prevProps[key] !== nextProps[key]) {
        changed.push(key);
      }
    }
    if (changed.length > 0) {
      reasons.push(`Props changed: ${changed.join(", ")}`);
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
  if (fiber.dependencies?.firstContext) {
    let ctx = fiber.dependencies.firstContext as {
      memoizedValue?: unknown;
      context?: { _currentValue?: unknown };
      next?: unknown;
    } | null;
    while (ctx) {
      if (
        ctx.context &&
        ctx.memoizedValue !== ctx.context._currentValue
      ) {
        reasons.push("Context changed");
        break;
      }
      ctx = ctx.next as typeof ctx;
    }
  }

  if (reasons.length === 0) {
    reasons.push("Parent re-rendered");
  }

  return { reasons, changedHookIndices };
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
