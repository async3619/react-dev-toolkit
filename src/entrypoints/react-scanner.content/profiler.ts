import type { FiberNode } from "./types";
import type { ProfileCommitData, ProfileFiberNode } from "@/types";
import { getFiberName, findNearestDomElement } from "./fiber";
import { highlightElement, hideHighlight } from "./highlight";

const componentTags = new Set([0, 1, 11, 14, 15]);

let profiling = false;
let commitIdCounter = 0;
let profilerNodeIdCounter = 0;

/** Maps profiler node IDs to their nearest DOM elements for highlighting */
export const profilerNodeToElementMap = new Map<number, Element>();

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
      const domEl = findNearestDomElement(fiber);
      if (domEl) {
        profilerNodeToElementMap.set(nodeId, domEl);
      }

      const renderReasons = didRender
        ? detectRenderReasons(fiber)
        : undefined;

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

function detectRenderReasons(fiber: FiberNode): string[] {
  const reasons: string[] = [];
  const alt = fiber.alternate;

  if (!alt) {
    reasons.push("First render");
    return reasons;
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

  // State changed (hook linked list comparison)
  if (alt.memoizedState !== fiber.memoizedState) {
    let prevHook = alt.memoizedState;
    let nextHook = fiber.memoizedState;
    let stateChanged = false;

    while (prevHook && nextHook) {
      if (
        typeof prevHook === "object" &&
        prevHook !== null &&
        "memoizedState" in prevHook &&
        typeof nextHook === "object" &&
        nextHook !== null &&
        "memoizedState" in nextHook
      ) {
        const prev = (prevHook as { memoizedState: unknown }).memoizedState;
        const next = (nextHook as { memoizedState: unknown }).memoizedState;
        if (prev !== next) {
          stateChanged = true;
          break;
        }
        prevHook = (prevHook as unknown as { next: unknown }).next;
        nextHook = (nextHook as unknown as { next: unknown }).next;
      } else {
        stateChanged = true;
        break;
      }
    }

    if (stateChanged) {
      reasons.push("State changed");
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

  return reasons;
}
