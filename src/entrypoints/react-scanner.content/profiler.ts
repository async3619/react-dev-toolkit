import type { FiberNode } from "./types";
import type { ProfileCommitData, ProfileFiberNode, HookInfo } from "@/types";
import { getFiberName, findNearestDomElement } from "./fiber";
import { highlightElement, hideHighlight } from "./highlight";
import { inspectHooksOfFiberDirect } from "./hooks";

const componentTags = new Set([0, 1, 11, 14, 15]);

let profiling = false;
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

export function startProfiling() {
  profiling = true;
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
  walkFiberForProfiling(fiberRoot.current, roots);

  if (roots.length === 0) return;

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

  // Hook changes — walk linked list using _debugHookTypes for accurate classification
  if (alt.memoizedState !== fiber.memoizedState) {
    const hookResult = detectHookChanges(
      alt.memoizedState,
      fiber.memoizedState,
      fiber._debugHookTypes,
    );
    if (hookResult.ids.length > 0) {
      changedHookIndices = hookResult.ids;
      reasons.push(`Hook(s) ${hookResult.ids.join(", ")} changed`);
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

/** Noise hooks whose memoizedState changes are internal / not actionable */
const SKIP_HOOK_TYPES = new Set([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
  "useImperativeHandle",
  "useDebugValue",
]);

function detectHookChanges(
  prevState: unknown,
  nextState: unknown,
  debugHookTypes?: string[] | null,
): { ids: number[] } {
  const ids: number[] = [];
  let prev = prevState;
  let next = nextState;
  let index = 0;

  while (isHookNode(prev) && isHookNode(next)) {
    const hookType = debugHookTypes?.[index] ?? null;

    if (prev.memoizedState !== next.memoizedState) {
      if (!hookType || !SKIP_HOOK_TYPES.has(hookType)) {
        // 1-based hook ID (matching hook tree ID assignment)
        ids.push(index + 1);
      }
    }

    prev = prev.next;
    next = next.next;
    index++;
  }

  return { ids };
}

/** Inspect hooks of a profiler node by its profiler-assigned nodeId */
export function inspectProfilerNodeHooks(profilerNodeId: number): HookInfo[] | null {
  const fiber = profilerNodeToFiberMap.get(profilerNodeId);
  if (!fiber) return null;
  return inspectHooksOfFiberDirect(fiber);
}
