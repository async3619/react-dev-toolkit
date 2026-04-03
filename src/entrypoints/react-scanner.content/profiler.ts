import {
  type Fiber,
  type FiberRoot,
  isCompositeFiber,
  getDisplayName,
  getNearestHostFiber,
  getTimings,
  didFiberRender,
  traverseProps,
  traverseContexts,
  traverseFiber,
} from "bippy";
import type { ProfileCommitData, ProfileFiberNode, HookInfo, ChangedProp, ChangedContext, DiffTreeNode } from "@/types";
import { getFiberName, findNearestDomElement } from "./fiber";
import { highlightElement, hideHighlight } from "./highlight";
import { inspectHooksOfFiberDirect } from "./hooks";
import { getTypeByTypeId } from "./state";

let profiling = false;
let targetType: unknown | undefined;
let targetComponentName: string | undefined;
let commitIdCounter = 0;
let profilerNodeIdCounter = 0;

/** Maps profiler node IDs to their nearest DOM elements for highlighting */
export const profilerNodeToElementMap = new Map<number, Element>();

/** Maps profiler node IDs to fibers for hook inspection */
const profilerNodeToFiberMap = new Map<number, Fiber>();

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
}

export function stopProfiling() {
  profiling = false;
}

/**
 * Called from watcher.ts on every onCommitFiberRoot.
 * Only collects data when profiling is active.
 */
export function onCommitForProfiling(fiberRoot: FiberRoot) {
  if (!profiling) return;
  if (!fiberRoot?.current) return;

  const roots: ProfileFiberNode[] = [];
  const hasTarget = targetType !== undefined || targetComponentName !== undefined;

  if (hasTarget) {
    const targetFibers = findTargetFibers(fiberRoot.current);
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

function findTargetFibers(root: Fiber): Fiber[] {
  const results: Fiber[] = [];
  traverseFiber(root, (fiber) => {
    if (!isCompositeFiber(fiber)) return;
    if (targetType !== undefined && fiber.type === targetType) {
      results.push(fiber);
    } else if (targetComponentName !== undefined) {
      const name = getDisplayName(fiber.type);
      if (name === targetComponentName) {
        results.push(fiber);
      }
    }
  });
  return results;
}

function walkFiberForProfiling(fiber: Fiber, out: ProfileFiberNode[]): void {
  if (isCompositeFiber(fiber)) {
    const nameResult = getFiberName(fiber);
    if (nameResult) {
      const children: ProfileFiberNode[] = [];
      let child = fiber.child;
      while (child) {
        walkFiberForProfiling(child, children);
        child = child.sibling;
      }

      const { selfTime, totalTime } = getTimings(fiber);
      const baseDuration = fiber.treeBaseDuration ?? (fiber as unknown as { selfBaseDuration?: number }).selfBaseDuration ?? 0;
      const rendered = didFiberRender(fiber);

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
      if (rendered) {
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
        selfDuration: selfTime,
        totalDuration: totalTime,
        baseDuration,
        children,
        didRender: rendered,
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

// --- Value serialization for diffs ---

const MAX_SERIALIZED_LENGTH = 200;
const MAX_DIFF_DEPTH = 10;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && !("$$typeof" in (value as Record<string, unknown>));
}

function buildDiffTree(prev: unknown, next: unknown, depth: number, seen = new WeakSet()): DiffTreeNode[] {
  if (depth > MAX_DIFF_DEPTH) return [];

  if (typeof prev === "object" && prev !== null) {
    if (seen.has(prev)) return [];
    seen.add(prev);
  }
  if (typeof next === "object" && next !== null) {
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
      const children = changed ? buildDiffTree(pv, nv, depth + 1, seen) : [];
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
      const children = changed ? buildDiffTree(pv, nv, depth + 1, seen) : [];
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
    return value.name ? `\u0192 ${value.name}()` : "\u0192 ()";
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
      if (typeof v === "function") return v.name ? `\u0192 ${v.name}()` : "\u0192 ()";
      if (typeof v === "symbol") return v.toString();
      if (typeof v === "undefined") return "undefined";
      return v;
    });
    if (json && json.length > MAX_SERIALIZED_LENGTH) {
      return `${json.slice(0, MAX_SERIALIZED_LENGTH)}\u2026`;
    }
    return json ?? "undefined";
  } catch {
    if (Array.isArray(value)) return `Array(${value.length})`;
    return "{\u2026}";
  }
}

// --- Render reason detection ---

function detectRenderReasons(fiber: Fiber): {
  reasons: string[];
  changedHookIndices?: number[];
  changedProps?: ChangedProp[];
  changedContexts?: ChangedContext[];
} {
  const reasons: string[] = [];
  let changedHookIndices: number[] | undefined;
  let changedProps: ChangedProp[] | undefined;
  let changedContexts: ChangedContext[] | undefined;

  if (!fiber.alternate) {
    return { reasons: ["First render"] };
  }

  // Props changed — using bippy's traverseProps
  const propDiffs: ChangedProp[] = [];
  const changedPropNames: string[] = [];
  traverseProps(fiber, (name, next, prev) => {
    if (next !== prev) {
      changedPropNames.push(name);
      const diffTree = buildDiffTree(prev, next, 0);
      propDiffs.push({
        name,
        prevValue: serializePropValue(prev),
        nextValue: serializePropValue(next),
        ...(diffTree.length > 0 ? { diffTree } : {}),
      });
    }
  });
  if (changedPropNames.length > 0) {
    reasons.push(`Props changed: ${changedPropNames.join(", ")}`);
    changedProps = propDiffs;
  }

  // Hook changes — custom detection for hook tree ID mapping
  if (fiber.alternate.memoizedState !== fiber.memoizedState) {
    const indices = detectHookChanges(
      fiber.alternate.memoizedState,
      fiber.memoizedState,
      (fiber as unknown as { _debugHookTypes?: string[] | null })._debugHookTypes,
    );
    if (indices.length > 0) {
      changedHookIndices = indices;
      reasons.push(`Hook(s) ${indices.join(", ")} changed`);
    }
  }

  // Context changed — using bippy's traverseContexts
  const contextDiffs: ChangedContext[] = [];
  traverseContexts(fiber, (currCtx, prevCtx) => {
    if (!currCtx || !prevCtx) return;
    if (currCtx.memoizedValue !== prevCtx.memoizedValue) {
      const contextName =
        (currCtx.context as unknown as { displayName?: string })?.displayName ??
        (currCtx.context as unknown as { _context?: { displayName?: string } })?._context?.displayName ??
        "Context";
      const diffTree = buildDiffTree(prevCtx.memoizedValue, currCtx.memoizedValue, 0);
      contextDiffs.push({
        name: contextName,
        prevValue: serializePropValue(prevCtx.memoizedValue),
        nextValue: serializePropValue(currCtx.memoizedValue),
        ...(diffTree.length > 0 ? { diffTree } : {}),
      });
    }
  });
  if (contextDiffs.length > 0) {
    reasons.push(`Context changed: ${contextDiffs.map((c) => c.name).join(", ")}`);
    changedContexts = contextDiffs;
  }

  if (reasons.length === 0) {
    reasons.push("Parent re-rendered");
  }

  return { reasons, changedHookIndices, changedProps, changedContexts };
}

// --- Hook change detection ---

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
 * Hooks that can CAUSE a re-render.
 * Only useState and useReducer — their memoizedState is the raw state value,
 * so reference comparison works reliably.
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
 * Composite hooks that create EXTRA memoizedState nodes internally.
 * - useSyncExternalStore: 1 extra (internal mountEffect for subscription)
 * - useTransition: 1 extra (startTransition function)
 */
const EXTRA_HOOK_NODES: Record<string, number> = {
  useSyncExternalStore: 1,
  useTransition: 1,
};

/**
 * Detect changed hooks by walking raw memoizedState linked lists.
 * Returns hook tree IDs (1-based) so sidebar highlighting works correctly.
 */
function detectHookChanges(
  prevState: unknown,
  nextState: unknown,
  debugHookTypes?: string[] | null,
): number[] {
  const ids: number[] = [];

  if (!debugHookTypes) return ids;

  let prev = prevState;
  let next = nextState;
  let treeId = 1;

  for (let i = 0; i < debugHookTypes.length; i++) {
    const hookType = debugHookTypes[i];

    if (NO_MEMOIZED_STATE_HOOKS.has(hookType)) continue;
    if (!isHookNode(prev) || !isHookNode(next)) break;

    if (STATEFUL_HOOK_TYPES.has(hookType)) {
      if (prev.memoizedState !== next.memoizedState) {
        ids.push(treeId);
      }
    }

    treeId++;
    prev = (prev as HookNode).next;
    next = (next as HookNode).next;

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
