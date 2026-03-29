import ErrorStackParser from "error-stack-parser";

import type { DispatcherRef, FiberNode, HookInfo, HookLogEntry, HookSource } from "./types";
import { nodeToFiberMap } from "./state";
import { resolveSourceMapLocation } from "./source-map";
import { serializeValue } from "./serialize";

// --- Dispatcher ref resolution ---

function getDispatcherRef(): DispatcherRef | null {
  const devHook = (window as unknown as Record<string, unknown>)
    .__REACT_DEVTOOLS_GLOBAL_HOOK__ as
    | { renderers?: Map<number, Record<string, unknown>> }
    | undefined;

  if (devHook?.renderers) {
    for (const [, renderer] of devHook.renderers) {
      const ref = renderer.currentDispatcherRef as Record<string, unknown> | undefined;
      if (ref) {
        if ("H" in ref) {
          return {
            get: () => ref.H,
            set: (v) => { ref.H = v; },
          };
        }
        if ("current" in ref) {
          return {
            get: () => ref.current,
            set: (v) => { ref.current = v; },
          };
        }
      }
    }
  }

  // Fallback: React 19+ client internals
  const ci = (window as unknown as Record<string, unknown>)
    .__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as
    | Record<string, unknown>
    | undefined;
  if (ci) {
    if ("H" in ci) {
      return {
        get: () => ci.H,
        set: (v) => { ci.H = v; },
      };
    }
  }

  // Fallback: React 18 secret internals
  const si = (window as unknown as Record<string, unknown>)
    .__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED as
    | { ReactCurrentDispatcher?: { current: unknown } }
    | undefined;
  if (si?.ReactCurrentDispatcher) {
    return {
      get: () => si.ReactCurrentDispatcher!.current,
      set: (v) => { si.ReactCurrentDispatcher!.current = v; },
    };
  }

  return null;
}

// --- Mock dispatcher state ---

let _hookNodes: unknown = null;
let _hookIndex = 0;
let _hookLog: HookLogEntry[] = [];

function _nextHook(): unknown {
  const current = _hookNodes as { memoizedState: unknown; next: unknown } | null;
  if (current) {
    _hookNodes = current.next;
    _hookIndex++;
    return current;
  }
  return null;
}

function _logHook(
  primitive: string,
  dispatcherHookName: string,
  value: unknown,
  displayName?: string | null,
): void {
  _hookLog.push({
    primitive,
    dispatcherHookName,
    stackError: new Error(),
    value,
    displayName: displayName ?? null,
    subHooks: [],
  });
}

function toUsePrefix(name: string): string {
  if (name === "Use") return "use";
  if (name.length === 0) return "use";
  return `use${name}`;
}

// --- Mock dispatcher ---

const _mockDispatcher: Record<string, (...args: unknown[]) => unknown> = {
  useContext(context: unknown) {
    const ctx = context as Record<string, unknown>;
    const value = ctx._currentValue;
    _logHook("Context", "Context", value);
    return value;
  },
  useState() {
    const hook = _nextHook() as { memoizedState: { memoizedState: unknown } } | null;
    const state = hook?.memoizedState;
    // React 18 stores [state, dispatch] in queue; React 19 stores state directly
    const value = typeof state === "object" && state !== null && "memoizedState" in state
      ? state.memoizedState
      : state;
    _logHook("State", "State", value);
    return [value, () => {}];
  },
  useReducer() {
    const hook = _nextHook() as { memoizedState: unknown } | null;
    const state = hook?.memoizedState;
    _logHook("Reducer", "Reducer", state);
    return [state, () => {}];
  },
  useRef() {
    const hook = _nextHook() as { memoizedState: { current: unknown } } | null;
    const ref = hook?.memoizedState ?? { current: undefined };
    _logHook("Ref", "Ref", ref.current);
    return ref;
  },
  useMemo() {
    const hook = _nextHook() as { memoizedState: [unknown, unknown] } | null;
    const value = hook?.memoizedState?.[0];
    _logHook("Memo", "Memo", value);
    return value;
  },
  useCallback() {
    const hook = _nextHook() as { memoizedState: [unknown, unknown] } | null;
    const value = hook?.memoizedState?.[0];
    _logHook("Callback", "Callback", value);
    return value;
  },
  useEffect() {
    _nextHook();
    _logHook("Effect", "Effect", undefined);
  },
  useLayoutEffect() {
    _nextHook();
    _logHook("LayoutEffect", "LayoutEffect", undefined);
  },
  useInsertionEffect() {
    _nextHook();
    _logHook("InsertionEffect", "InsertionEffect", undefined);
  },
  useImperativeHandle() {
    _nextHook();
    _logHook("ImperativeHandle", "ImperativeHandle", undefined);
  },
  useDebugValue(...args: unknown[]) {
    const value = args[0];
    const formatter = args[1] as ((v: unknown) => unknown) | undefined;
    const displayValue = formatter ? formatter(value) : value;
    _logHook("DebugValue", "DebugValue", displayValue);
  },
  useTransition() {
    // useTransition uses two hooks internally
    const hook = _nextHook() as { memoizedState: unknown } | null;
    _nextHook();
    const isPending = hook?.memoizedState ?? false;
    _logHook("Transition", "Transition", isPending);
    return [isPending, () => {}];
  },
  useDeferredValue(value: unknown) {
    const hook = _nextHook() as { memoizedState: unknown } | null;
    const deferred = hook?.memoizedState ?? value;
    _logHook("DeferredValue", "DeferredValue", deferred);
    return deferred;
  },
  useId() {
    const hook = _nextHook() as { memoizedState: unknown } | null;
    const id = hook?.memoizedState ?? "";
    _logHook("Id", "Id", id);
    return id;
  },
  useSyncExternalStore() {
    // useSyncExternalStore uses two hooks internally (store + effect)
    const hook = _nextHook() as { memoizedState: unknown } | null;
    _nextHook();
    const snapshot = hook?.memoizedState;
    _logHook("SyncExternalStore", "SyncExternalStore", snapshot);
    return snapshot;
  },
  useActionState() {
    // useActionState uses three hooks internally
    const hook = _nextHook() as { memoizedState: unknown } | null;
    _nextHook();
    _nextHook();
    const state = hook?.memoizedState;
    _logHook("ActionState", "ActionState", state);
    return [state, () => {}, false];
  },
  useFormStatus() {
    const value = { pending: false, data: null, method: null, action: null };
    _logHook("FormStatus", "FormStatus", value);
    return value;
  },
  useOptimistic(passthrough: unknown) {
    const hook = _nextHook() as { memoizedState: unknown } | null;
    const state = hook?.memoizedState ?? passthrough;
    _logHook("Optimistic", "Optimistic", state);
    return [state, () => {}];
  },
  use(usable: unknown) {
    // use() can handle promises and contexts
    if (usable !== null && typeof usable === "object" && "_currentValue" in (usable as Record<string, unknown>)) {
      const value = (usable as Record<string, unknown>)._currentValue;
      _logHook("Context", "Use", value);
      return value;
    }
    _logHook("Use", "Use", undefined);
    return undefined;
  },
  useMemoCache(...args: unknown[]) {
    // useMemoCache is transparent — does NOT log
    _nextHook();
    const size = typeof args[0] === "number" ? args[0] : 0;
    const sentinel = Symbol.for("react.memo_cache_sentinel");
    return Array(size).fill(sentinel);
  },
  useCacheRefresh() {
    _nextHook();
    _logHook("CacheRefresh", "CacheRefresh", undefined);
    return () => {};
  },
};

const _safeDispatcher = new Proxy(_mockDispatcher, {
  get(target, prop) {
    if (prop in target) return target[prop as string];
    return () => undefined;
  },
});

// --- Primitive stack cache ---

let _primitiveStackCache: Map<string, ErrorStackParser.StackFrame[]> | null = null;

function getPrimitiveStackCache(): Map<string, ErrorStackParser.StackFrame[]> {
  if (_primitiveStackCache !== null) return _primitiveStackCache;

  const cache = new Map<string, ErrorStackParser.StackFrame[]>();

  // Save and reset module state
  const savedNodes = _hookNodes;
  const savedIndex = _hookIndex;
  const savedLog = _hookLog;
  _hookNodes = null;
  _hookIndex = 0;
  _hookLog = [];

  try {
    // MUST call through _safeDispatcher (Proxy) so V8 records "Proxy.useXxx" stacks
    // matching what happens during actual hook calls
    for (const hookName of Object.keys(_mockDispatcher)) {
      if (hookName === "useMemoCache") continue;
      try {
        (_safeDispatcher as Record<string, (...args: unknown[]) => unknown>)[hookName]({});
      } catch {
        // Expected — some hooks throw without proper fiber state
      }
    }

    for (const entry of _hookLog) {
      try {
        const frames = ErrorStackParser.parse(entry.stackError);
        cache.set(entry.primitive, frames);
      } catch {
        // Stack parse failure
      }
    }
  } finally {
    // Restore module state
    _hookNodes = savedNodes;
    _hookIndex = savedIndex;
    _hookLog = savedLog;
  }

  _primitiveStackCache = cache;
  return cache;
}

// --- Stack comparison utilities (ported from React DevTools' react-debug-tools) ---

function parseHookName(functionName: string | undefined): string {
  if (!functionName) return "";
  let name = functionName;

  // Handle "[as hookName]" pattern
  const asMatch = name.match(/\[as\s+(\w+)\]/);
  if (asMatch) name = asMatch[1];

  // Strip object prefix (e.g. "Object.useRef", "Proxy.useRef")
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx >= 0) name = name.substring(dotIdx + 1);

  // Strip "unstable_" and "experimental_" prefixes
  name = name.replace(/^(?:unstable_|experimental_)/, "");

  // Strip "use" prefix to get stripped name
  if (name.startsWith("use") && name.length > 3 && name[3] === name[3].toUpperCase()) {
    return name.substring(3);
  }
  if (name === "use") return "Use";

  return name;
}

let _mostLikelyAncestorIndex = 0;

function findSharedIndex(
  hookStack: ErrorStackParser.StackFrame[],
  rootStack: ErrorStackParser.StackFrame[],
  rootIndex: number,
): number {
  const source = rootStack[rootIndex]?.source;
  if (!source) return -1;
  hookSearch: for (let i = 0; i < hookStack.length; i++) {
    if (hookStack[i].source === source) {
      for (
        let a = rootIndex + 1, b = i + 1;
        a < rootStack.length && b < hookStack.length;
        a++, b++
      ) {
        if (hookStack[b].source !== rootStack[a].source) continue hookSearch;
      }
      return i;
    }
  }
  return -1;
}

function findCommonAncestorIndex(
  rootStack: ErrorStackParser.StackFrame[],
  hookStack: ErrorStackParser.StackFrame[],
): number {
  let rootIndex = findSharedIndex(hookStack, rootStack, _mostLikelyAncestorIndex);
  if (rootIndex !== -1) return rootIndex;
  for (let i = 0; i < rootStack.length && i < 5; i++) {
    rootIndex = findSharedIndex(hookStack, rootStack, i);
    if (rootIndex !== -1) {
      _mostLikelyAncestorIndex = i;
      return rootIndex;
    }
  }
  return -1;
}

function isReactWrapper(
  functionName: string | undefined,
  hookDispatcherName: string,
): boolean {
  const name = parseHookName(functionName);
  if (hookDispatcherName === "HostTransitionStatus") {
    return name === hookDispatcherName || name === "FormStatus";
  }
  return name === hookDispatcherName;
}

function findPrimitiveIndex(
  hookStack: ErrorStackParser.StackFrame[],
  hook: HookLogEntry,
): number {
  const cache = getPrimitiveStackCache();
  const cachedStack = cache.get(hook.primitive);
  if (!cachedStack) return -1;

  for (let i = 0; i < cachedStack.length && i < hookStack.length; i++) {
    if (cachedStack[i].source !== hookStack[i].source) {
      // Skip up to 2 React wrapper frames (e.g., exports.useState)
      if (
        i < hookStack.length - 1 &&
        isReactWrapper(hookStack[i].functionName, hook.dispatcherHookName)
      ) {
        i++;
      }
      if (
        i < hookStack.length - 1 &&
        isReactWrapper(hookStack[i].functionName, hook.dispatcherHookName)
      ) {
        i++;
      }
      return i;
    }
  }
  return -1;
}

function parseTrimmedStack(
  hookStack: ErrorStackParser.StackFrame[],
  hook: HookLogEntry,
  rootStack: ErrorStackParser.StackFrame[],
): [ErrorStackParser.StackFrame | null, ErrorStackParser.StackFrame[] | null] {
  const rootIndex = findCommonAncestorIndex(rootStack, hookStack);
  const primitiveIndex = findPrimitiveIndex(hookStack, hook);

  if (rootIndex === -1 || primitiveIndex === -1 || rootIndex - primitiveIndex < 2) {
    if (primitiveIndex === -1) return [null, null];
    return [hookStack[primitiveIndex - 1] ?? null, null];
  }
  return [
    hookStack[primitiveIndex - 1] ?? null,
    hookStack.slice(primitiveIndex, rootIndex - 1),
  ];
}

// --- Context setup ---

function setupContexts(fiber: FiberNode): Map<Record<string, unknown>, unknown> {
  const contextMap = new Map<Record<string, unknown>, unknown>();
  let current: FiberNode | null = fiber;

  while (current) {
    if (current.tag === 10) {
      // ContextProvider
      let context = current.type as Record<string, unknown>;
      if (context._context !== undefined) context = context._context as Record<string, unknown>; // React <19
      if (!contextMap.has(context)) {
        contextMap.set(context, context._currentValue);
        context._currentValue = current.memoizedProps?.value;
      }
    }
    current = current.return;
  }

  return contextMap;
}

function restoreContexts(contextMap: Map<Record<string, unknown>, unknown>): void {
  for (const [ctx, prev] of contextMap) {
    ctx._currentValue = prev;
  }
}

// --- Debug values ---

function processDebugValues(
  hooksTree: HookInfo[],
  parentNode: HookInfo | null,
): void {
  const debugValueNodes: HookInfo[] = [];
  for (let i = 0; i < hooksTree.length; i++) {
    const node = hooksTree[i];
    if (node.name === "useDebugValue" && node.subHooks.length === 0) {
      hooksTree.splice(i, 1);
      i--;
      debugValueNodes.push(node);
    } else {
      processDebugValues(node.subHooks, node);
    }
  }
  if (parentNode !== null) {
    if (debugValueNodes.length === 1) {
      parentNode.value = debugValueNodes[0].value;
    } else if (debugValueNodes.length > 1) {
      parentNode.value = debugValueNodes.map(({ value }) => value);
    }
  }
}

function frameToSource(
  frame: ErrorStackParser.StackFrame | null | undefined,
): HookSource | null {
  if (!frame?.fileName) return null;
  const raw = {
    fileName: frame.fileName,
    lineNumber: frame.lineNumber ?? 0,
    columnNumber: frame.columnNumber,
  };
  // Try to resolve through source maps for accurate original location
  return resolveSourceMapLocation(raw.fileName, raw.lineNumber, raw.columnNumber) ?? raw;
}

// --- Hook tree building ---

function buildHookTree(
  readHookLog: HookLogEntry[],
  rootStack: ErrorStackParser.StackFrame[],
): HookInfo[] {
  const rootChildren: HookInfo[] = [];
  let prevStack: ErrorStackParser.StackFrame[] | null = null;
  let levelChildren = rootChildren;
  const stackOfChildren: HookInfo[][] = [];
  let nativeHookID = 1;

  for (let i = 0; i < readHookLog.length; i++) {
    const hook = readHookLog[i];

    // Skip useMemoCache from output (React Compiler internal)
    if (hook.primitive === "MemoCache") continue;

    let hookFrames: ErrorStackParser.StackFrame[];
    try {
      hookFrames = ErrorStackParser.parse(hook.stackError);
    } catch {
      hookFrames = [];
    }

    const [primitiveFrame, stack] = parseTrimmedStack(hookFrames, hook, rootStack);

    let displayName = hook.displayName;
    if (displayName === null && primitiveFrame !== null) {
      displayName =
        parseHookName(primitiveFrame.functionName) ||
        parseHookName(hook.dispatcherHookName);
    }

    if (stack !== null) {
      let commonSteps = 0;
      if (prevStack !== null) {
        while (commonSteps < stack.length && commonSteps < prevStack.length) {
          const stackSource = stack[stack.length - commonSteps - 1].source;
          const prevSource = prevStack[prevStack.length - commonSteps - 1].source;
          if (stackSource !== prevSource) break;
          commonSteps++;
        }
        for (let j = prevStack.length - 1; j > commonSteps; j--) {
          levelChildren = stackOfChildren.pop()!;
        }
      }

      for (let j = stack.length - commonSteps - 1; j >= 1; j--) {
        const children: HookInfo[] = [];
        const customHookName = parseHookName(stack[j - 1].functionName);
        const srcFrame = stack[j - 1];
        const levelChild: HookInfo = {
          id: null,
          name: toUsePrefix(customHookName || "Unknown"),
          value: undefined,
          subHooks: children,
          source: frameToSource(srcFrame),
        };
        levelChildren.push(levelChild);
        stackOfChildren.push(levelChildren);
        levelChildren = children;
      }
      prevStack = stack;
    }

    const name = displayName
      ? toUsePrefix(displayName)
      : toUsePrefix(hook.primitive);

    // Context and DebugValue hooks don't get an ID (not stateful)
    const noId = hook.primitive === "Context" || hook.primitive === "Context (use)" || hook.primitive === "DebugValue";
    const leafSource = stack && stack.length >= 1 ? stack[0] : null;
    const leafChild: HookInfo = {
      id: noId ? null : nativeHookID++,
      name,
      value: serializeValue(hook.value, 0),
      subHooks: [],
      source: frameToSource(leafSource),
    };
    levelChildren.push(leafChild);
  }

  processDebugValues(rootChildren, null);
  return rootChildren;
}

// --- Fallback hook list ---

function guessHookType(memoizedState: unknown): string {
  if (memoizedState === null || memoizedState === undefined) return "useState";

  if (typeof memoizedState === "object") {
    const obj = memoizedState as Record<string, unknown>;

    // useRef: { current: ... }
    if ("current" in obj && Object.keys(obj).length === 1) return "useRef";

    // useEffect/useLayoutEffect: has .destroy and .create
    if ("destroy" in obj && "create" in obj) return "useEffect";

    // useMemo/useCallback: array of [value, deps]
    if (Array.isArray(memoizedState) && memoizedState.length === 2 && Array.isArray(memoizedState[1])) {
      return "useMemo";
    }
  }

  return "useState";
}

function buildFallbackHookList(fiber: FiberNode): HookInfo[] {
  const hooks: HookInfo[] = [];
  let current = fiber.memoizedState as { memoizedState: unknown; next: unknown } | null;
  let hookId = 1;

  while (current) {
    const hookType = guessHookType(current.memoizedState);
    let value: unknown = current.memoizedState;

    if (hookType === "useRef" && typeof value === "object" && value !== null && "current" in (value as Record<string, unknown>)) {
      value = (value as { current: unknown }).current;
    }

    hooks.push({
      id: hookId++,
      name: hookType,
      value: serializeValue(value, 0),
      subHooks: [],
    });

    current = current.next as typeof current;
  }

  return hooks;
}

// --- Main hooks inspection ---

function _inspectHooksOfFiberImpl(nodeId: number): HookInfo[] | null {
  const fiber = nodeToFiberMap.get(nodeId);
  if (!fiber) { console.log('[RDT] no fiber for', nodeId); return null; }

  const type = fiber.type;
  let componentFn: ((...args: unknown[]) => unknown) | null = null;

  if (typeof type === "function") {
    componentFn = type as (...args: unknown[]) => unknown;
  } else if (typeof type === "object" && type !== null) {
    const obj = type as { render?: unknown; type?: unknown };
    if (typeof obj.render === "function") {
      componentFn = obj.render as (...args: unknown[]) => unknown;
    } else if (typeof obj.type === "function") {
      componentFn = obj.type as (...args: unknown[]) => unknown;
    }
  }

  // Class components don't use hooks
  if (componentFn && componentFn.prototype?.isReactComponent) return null;
  if (!componentFn) return null;

  const dispatcherRef = getDispatcherRef();
  if (!dispatcherRef) {
    return buildFallbackHookList(fiber);
  }

  // Warm up primitive stack cache
  getPrimitiveStackCache();

  // Set up module-level state
  _hookNodes = fiber.memoizedState;
  _hookIndex = 0;
  _hookLog = [];

  const contextMap = setupContexts(fiber);
  const prevDispatcher = dispatcherRef.get();

  let rootFrames: ErrorStackParser.StackFrame[] = [];

  try {
    dispatcherRef.set(_safeDispatcher);

    const ancestorStackError = new Error();
    try {
      rootFrames = ErrorStackParser.parse(ancestorStackError);
    } catch {
      rootFrames = [];
    }

    // Invoke the component to collect hook calls
    try {
      componentFn(fiber.memoizedProps ?? {});
    } catch {
      // Component may throw — that's fine, we still captured hooks up to that point
    }
  } finally {
    dispatcherRef.set(prevDispatcher);
    restoreContexts(contextMap);
  }

  if (_hookLog.length === 0) {
    return buildFallbackHookList(fiber);
  }

  return buildHookTree(_hookLog, rootFrames);
}

export function inspectHooksOfFiber(nodeId: number): HookInfo[] | null {
  try { return _inspectHooksOfFiberImpl(nodeId); }
  catch (e) { console.error('[RDT] inspectHooksOfFiber error:', e); return null; }
}

/**
 * Inspect hooks of a fiber directly.
 * When fixToCurrent is true (default), navigates to the current fiber via alternate.
 * When false, uses the fiber as-is (needed for inspecting the previous fiber during profiling).
 */
export function inspectHooksOfFiberDirect(fiber: FiberNode, fixToCurrent = true): HookInfo[] | null {
  try {
    let target = fiber;
    if (fixToCurrent && target.alternate && target.alternate.alternate === target) {
      target = target.alternate;
    }

    const type = target.type;
    let componentFn: ((...args: unknown[]) => unknown) | null = null;

    if (typeof type === "function") {
      componentFn = type as (...args: unknown[]) => unknown;
    } else if (typeof type === "object" && type !== null) {
      const obj = type as { render?: unknown; type?: unknown };
      if (typeof obj.render === "function") {
        componentFn = obj.render as (...args: unknown[]) => unknown;
      } else if (typeof obj.type === "function") {
        componentFn = obj.type as (...args: unknown[]) => unknown;
      }
    }

    if (componentFn && componentFn.prototype?.isReactComponent) return null;
    if (!componentFn) return null;

    const dispatcherRef = getDispatcherRef();
    if (!dispatcherRef) {
      return buildFallbackHookList(target);
    }

    getPrimitiveStackCache();

    _hookNodes = target.memoizedState;
    _hookIndex = 0;
    _hookLog = [];

    const contextMap = setupContexts(target);
    const prevDispatcher = dispatcherRef.get();

    let rootFrames: ErrorStackParser.StackFrame[] = [];

    try {
      dispatcherRef.set(_safeDispatcher);

      const ancestorStackError = new Error();
      try {
        rootFrames = ErrorStackParser.parse(ancestorStackError);
      } catch {
        rootFrames = [];
      }

      try {
        componentFn(target.memoizedProps ?? {});
      } catch {
        // Component may throw
      }
    } finally {
      dispatcherRef.set(prevDispatcher);
      restoreContexts(contextMap);
    }

    if (_hookLog.length === 0) {
      return buildFallbackHookList(target);
    }

    return buildHookTree(_hookLog, rootFrames);
  } catch (e) {
    console.error('[RDT] inspectHooksOfFiberDirect error:', e);
    return null;
  }
}
