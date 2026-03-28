// This script runs in the page's main world to access React internals

import ErrorStackParser from "error-stack-parser";
import { SourceMapConsumer, type RawSourceMap } from "source-map-js";

// --- Source map resolution ---

interface ScriptEntry {
  content: string;
  consumer: SourceMapConsumer | null;
}

const scriptEntries = new Map<string, ScriptEntry>();
interface SourceCacheEntry {
  classification: "first-party" | "third-party" | undefined;
  location?: SourceLocation;
}

const fnSourceCache = new Map<unknown, SourceCacheEntry>();
let sourceMapsLoaded = false;

async function loadSourceMaps(): Promise<void> {
  if (sourceMapsLoaded) return;
  sourceMapsLoaded = true;

  const scripts = document.querySelectorAll<HTMLScriptElement>("script[src]");

  await Promise.allSettled(
    Array.from(scripts).map(async (script) => {
      const url = script.src;
      if (!url || scriptEntries.has(url)) return;

      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const content = await res.text();

        const match = content.match(
          /\/\/[#@]\s*sourceMappingURL=(.+?)[\s]*$/m,
        );
        let consumer: SourceMapConsumer | null = null;

        if (match) {
          try {
            let rawMap: RawSourceMap;
            if (match[1].startsWith("data:")) {
              const base64 = match[1].split(",")[1];
              rawMap = JSON.parse(atob(base64));
            } else {
              const smUrl = new URL(match[1], url).href;
              const smRes = await fetch(smUrl);
              rawMap = await smRes.json();
            }
            consumer = new SourceMapConsumer(rawMap);
          } catch {
            // source map fetch/parse failed
          }
        }

        scriptEntries.set(url, { content, consumer });
      } catch {
        // script fetch failed (CORS, etc.)
      }
    }),
  );
}

function resolveSourceFromMap(
  fn: unknown,
): SourceCacheEntry {
  const cached = fnSourceCache.get(fn);
  if (cached) return cached;

  const empty: SourceCacheEntry = { classification: undefined };

  if (typeof fn !== "function") {
    fnSourceCache.set(fn, empty);
    return empty;
  }

  const fnStr = fn.toString();
  if (fnStr.length < 10) {
    fnSourceCache.set(fn, empty);
    return empty;
  }

  for (const [, entry] of scriptEntries) {
    if (!entry.consumer) continue;

    const idx = entry.content.indexOf(fnStr);
    if (idx === -1) continue;

    const before = entry.content.substring(0, idx);
    const lines = before.split("\n");
    const line = lines.length;
    const column = lines[lines.length - 1].length;

    const pos = entry.consumer.originalPositionFor({ line, column });
    if (pos.source) {
      const result: SourceCacheEntry = {
        classification: pos.source.includes("node_modules")
          ? "third-party"
          : "first-party",
        location: {
          fileName: pos.source,
          lineNumber: pos.line ?? 1,
          columnNumber: pos.column ?? undefined,
        },
      };
      fnSourceCache.set(fn, result);
      return result;
    }
  }

  fnSourceCache.set(fn, empty);
  return empty;
}

// --- Component source location via stack trace (React DevTools technique) ---

const sourceLocationCache = new WeakMap<object, SourceLocation | null>();

/**
 * Resolve the source location where a component function is defined.
 * Uses the same technique as React DevTools: invoke the function to capture
 * a stack trace, then compare with a control stack to isolate the component's frame.
 */
function resolveComponentSourceByInvocation(fn: unknown): SourceLocation | null {
  if (typeof fn !== "function") return null;

  // Use WeakMap cache keyed by function reference
  if (sourceLocationCache.has(fn as object)) {
    return sourceLocationCache.get(fn as object) ?? null;
  }

  let result: SourceLocation | null = null;

  // Disable React hooks dispatcher to prevent side effects
  const internals = (window as unknown as Record<string, unknown>).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED as
    | { ReactCurrentDispatcher?: { current: unknown } }
    | undefined;
  const prevDispatcher = internals?.ReactCurrentDispatcher?.current;

  // Also check React 19+ internals name
  const internals19 = (window as unknown as Record<string, unknown>).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as
    | { H?: unknown }
    | undefined;
  const prevH = internals19?.H;

  try {
    // Null out dispatchers to prevent hook side effects
    if (internals?.ReactCurrentDispatcher) {
      internals.ReactCurrentDispatcher.current = null;
    }
    if (internals19 && "H" in internals19) {
      internals19.H = null;
    }

    let sampleStack: string | undefined;
    let controlStack: string | undefined;

    // Capture sample stack by invoking the component
    try {
      const isClass = fn.prototype && fn.prototype.isReactComponent;
      if (isClass) {
        Reflect.construct(fn as new (...args: unknown[]) => unknown, [], class Fake {});
      } else {
        (fn as () => unknown)();
      }
    } catch (e: unknown) {
      if (e instanceof Error) sampleStack = e.stack;
    }

    // If the function didn't throw, we need a different approach
    if (!sampleStack) {
      // Try wrapping with a throw
      try {
        const wrapper = () => {
          try {
            const isClass = fn.prototype && fn.prototype.isReactComponent;
            if (isClass) {
              Reflect.construct(fn as new (...args: unknown[]) => unknown, [], class Fake {});
            } else {
              (fn as () => unknown)();
            }
          } finally {
            throw new Error("__source_probe__");
          }
        };
        wrapper();
      } catch (e: unknown) {
        if (e instanceof Error) sampleStack = e.stack;
      }
    }

    // Capture control stack at the same call depth
    try {
      throw new Error("__control__");
    } catch (e: unknown) {
      if (e instanceof Error) controlStack = e.stack;
    }

    if (sampleStack && controlStack) {
      const sampleLines = sampleStack.split("\n");
      const controlLines = controlStack.split("\n");

      // Extract our own script URL from the control stack to filter it out
      // The control stack only contains our scanner frames, so any URL in it is ours
      const ownUrls: string[] = [];
      for (const line of controlLines) {
        const m = line.match(/\((.+):\d+:\d+\)/) || line.match(/at\s+(.+):\d+:\d+\s*$/);
        if (m) {
          const url = m[1];
          if (!ownUrls.includes(url)) ownUrls.push(url);
        }
      }

      // Compare from the bottom up to find where stacks diverge
      let s = sampleLines.length - 1;
      let c = controlLines.length - 1;
      while (s >= 1 && c >= 0 && sampleLines[s] === controlLines[c]) {
        s--;
        c--;
      }

      // Walk up from the divergence point, looking for a user-code frame
      for (let i = s; i >= 0; i--) {
        const line = sampleLines[i];
        // Skip our own scanner frames, React internals, and node_modules
        if (
          ownUrls.some(url => line.includes(url)) ||
          line.includes("node_modules") ||
          line.includes("react-dom") ||
          line.includes("react-jsx-runtime") ||
          line.includes("react.development") ||
          line.includes("__source_probe__") ||
          line.includes("__control__")
        ) continue;

        // Chrome: "at Name (url:line:col)" or "at url:line:col"
        const match = line.match(/\((.+):(\d+):(\d+)\)/) || line.match(/at\s+(.+):(\d+):(\d+)\s*$/);
        if (match) {
          result = {
            fileName: match[1],
            lineNumber: parseInt(match[2], 10),
            columnNumber: parseInt(match[3], 10),
          };
          break;
        }
      }
    }
  } catch {
    // Never crash the scanner
  } finally {
    // Restore dispatchers
    if (internals?.ReactCurrentDispatcher && prevDispatcher !== undefined) {
      internals.ReactCurrentDispatcher.current = prevDispatcher;
    }
    if (internals19 && prevH !== undefined) {
      internals19.H = prevH;
    }
  }

  sourceLocationCache.set(fn as object, result);
  return result;
}

// --- Fiber walking ---

interface FiberNode {
  tag: number;
  type: unknown;
  child: FiberNode | null;
  sibling: FiberNode | null;
  return: FiberNode | null;
  memoizedProps: Record<string, unknown>;
  memoizedState: unknown;
  stateNode: unknown;
  dependencies?: { firstContext: unknown } | null;
  _debugSource?: { fileName: string; lineNumber: number; columnNumber?: number };
}

interface SourceLocation {
  fileName: string;
  lineNumber: number;
  columnNumber?: number;
}

interface ComponentNode {
  id: number;
  name: string;
  hocs?: HocBadge[];
  props: Record<string, unknown>;
  children: ComponentNode[];
  source?: "first-party" | "third-party";
  sourceLocation?: SourceLocation;
}

let nodeIdCounter = 0;
const nodeToElementMap = new Map<number, Element>();
const elementToNodeMap = new Map<Element, { id: number; name: string }>();
// Store component function references for inspect() from DevTools panel
const nodeToFunctionMap = new Map<number, Function>();
(window as unknown as Record<string, unknown>).__REACT_DEV_TOOLKIT_FN_REFS__ = nodeToFunctionMap;

// Store fiber references for hooks inspection
const nodeToFiberMap = new Map<number, FiberNode>();

type HocBadge = "memo" | "forwardRef" | "lazy";

interface FiberNameResult {
  name: string;
  hocs: HocBadge[];
}

function getFiberName(fiber: FiberNode): FiberNameResult | null {
  const type = fiber.type;
  if (!type) return null;
  if (typeof type === "string") return { name: type, hocs: [] };
  if (typeof type === "function") {
    const name = (type as { displayName?: string }).displayName || type.name || "Anonymous";
    return { name, hocs: [] };
  }
  if (typeof type === "object") {
    const objType = type as {
      displayName?: string;
      render?: { displayName?: string; name?: string };
      type?: { displayName?: string; name?: string; render?: { displayName?: string; name?: string } };
      $$typeof?: symbol;
    };

    // ForwardRef: has .render
    if (objType.render) {
      const name = objType.displayName || objType.render.displayName || objType.render.name || "Anonymous";
      return { name, hocs: ["forwardRef"] };
    }

    // Memo: has .type (inner component)
    if (objType.type) {
      const inner = objType.type;
      const hocs: HocBadge[] = ["memo"];

      // Memo wrapping ForwardRef: inner has .render
      if (inner.render) {
        hocs.push("forwardRef");
        const name = objType.displayName || inner.displayName || inner.render.displayName || inner.render.name || "Anonymous";
        return { name, hocs };
      }

      const name = objType.displayName || inner.displayName || inner.name || "Anonymous";
      return { name, hocs };
    }

    // Lazy components
    if (objType.$$typeof && String(objType.$$typeof) === "Symbol(react.lazy)") {
      const name = objType.displayName || "Lazy";
      return { name, hocs: ["lazy"] };
    }

    if (objType.displayName) {
      return { name: objType.displayName, hocs: [] };
    }
  }
  return null;
}

// Walk down the fiber to find the nearest host DOM element
function findNearestDomElement(fiber: FiberNode): Element | null {
  // tag 5 = HostComponent (DOM element)
  if (fiber.tag === 5 && fiber.stateNode instanceof Element) {
    return fiber.stateNode;
  }
  let child = fiber.child;
  while (child) {
    const el = findNearestDomElement(child);
    if (el) return el;
    child = child.sibling;
  }
  return null;
}

const MAX_PROP_DEPTH = 3;
const MAX_PROP_KEYS = 20;

function isReactElement(val: object): val is { $$typeof: unknown; type: unknown; props: unknown } {
  const obj = val as Record<string, unknown>;
  if (!("$$typeof" in obj) || !("type" in obj) || !("props" in obj)) return false;
  const t = obj.$$typeof;
  const str = typeof t === "symbol" ? (t.description ?? t.toString()) : String(t);
  return str.includes("react.element") || str.includes("react.transitional.element");
}

const REACT_TYPE_NAMES: Record<string, string> = {
  "react.fragment": "Fragment",
  "react.profiler": "Profiler",
  "react.strict_mode": "StrictMode",
  "react.suspense": "Suspense",
  "react.suspense_list": "SuspenseList",
};

function getReactElementName(type: unknown): string {
  if (typeof type === "string") return type;
  if (typeof type === "function") {
    return (type as { displayName?: string }).displayName || type.name || "Unknown";
  }
  if (typeof type === "symbol") {
    const desc = type.description ?? type.toString();
    for (const [key, name] of Object.entries(REACT_TYPE_NAMES)) {
      if (desc.includes(key)) return name;
    }
    return desc;
  }
  if (typeof type === "object" && type !== null) {
    const obj = type as Record<string, unknown>;
    if (typeof obj.displayName === "string") return obj.displayName;
    // memo(Component) — unwrap inner type
    if (obj.type != null) return getReactElementName(obj.type);
    // forwardRef(Component) — unwrap render function
    if (typeof obj.render === "function") {
      return (obj.render as { displayName?: string }).displayName || obj.render.name || "Unknown";
    }
  }
  return "Unknown";
}

function serializeValue(val: unknown, depth: number): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === "symbol") return val.toString();
  if (typeof val === "function") return `ƒ ${val.name || "anonymous"}()`;
  if (typeof val !== "object") return val;

  if (isReactElement(val)) {
    const elemProps = val.props as Record<string, unknown> | null;
    const serialized: Record<string, unknown> = {
      __reactElement: true,
      name: getReactElementName(val.type),
    };
    const key = (val as Record<string, unknown>).key;
    if (key != null) serialized.key = key;
    if (elemProps && typeof elemProps === "object") {
      const propEntries = Object.keys(elemProps).filter((k) => k !== "children");
      if (propEntries.length > 0) {
        const sp: Record<string, unknown> = {};
        for (const k of propEntries) {
          sp[k] = serializeValue(elemProps[k], depth + 1);
        }
        serialized.props = sp;
      }
    }
    return serialized;
  }

  if (depth >= MAX_PROP_DEPTH) return "[...]";

  if (Array.isArray(val)) {
    return val.slice(0, MAX_PROP_KEYS).map((v) => serializeValue(v, depth + 1));
  }

  const result: Record<string, unknown> = {};
  const keys = Object.keys(val as Record<string, unknown>);
  for (let i = 0; i < Math.min(keys.length, MAX_PROP_KEYS); i++) {
    result[keys[i]] = serializeValue((val as Record<string, unknown>)[keys[i]], depth + 1);
  }
  if (keys.length > MAX_PROP_KEYS) {
    result["..."] = `${keys.length - MAX_PROP_KEYS} more`;
  }
  return result;
}

function serializeProps(props: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (key === "children") continue;
    result[key] = serializeValue(props[key], 0);
  }
  return result;
}

interface ComponentSourceInfo {
  classification: "first-party" | "third-party" | undefined;
  location?: SourceLocation;
}

function classifyFileName(fileName: string): "first-party" | "third-party" {
  return fileName.includes("node_modules") ? "third-party" : "first-party";
}

function getComponentSource(fiber: FiberNode): ComponentSourceInfo {
  try {
    // Strategy 1: _debugSource (React 17-18 dev builds)
    const debugSource = fiber._debugSource;
    if (debugSource?.fileName) {
      return {
        classification: classifyFileName(debugSource.fileName),
        location: {
          fileName: debugSource.fileName,
          lineNumber: debugSource.lineNumber,
          columnNumber: debugSource.columnNumber,
        },
      };
    }

    // Strategy 2: Invoke component function to capture stack trace (React DevTools technique)
    // Works across all React versions and build modes
    const fn = typeof fiber.type === "function"
      ? fiber.type
      : typeof fiber.type === "object" && fiber.type !== null
        ? (fiber.type as { render?: unknown; type?: unknown }).render
          || (fiber.type as { render?: unknown; type?: unknown }).type
        : null;

    if (typeof fn === "function") {
      const loc = resolveComponentSourceByInvocation(fn);
      if (loc) {
        return {
          classification: classifyFileName(loc.fileName),
          location: loc,
        };
      }
    }

    // Strategy 3: resolve via source maps (production builds)
    if (typeof fiber.type === "function") {
      return resolveSourceFromMap(fiber.type);
    }
    if (typeof fn === "function") {
      return resolveSourceFromMap(fn);
    }
  } catch {
    // Catch-all: never let source resolution crash the tree walk
  }

  return { classification: undefined };
}

const componentTags = new Set([0, 1, 11, 14, 15]);

function walkFiber(fiber: FiberNode, out: ComponentNode[]): void {
  const result = getFiberName(fiber);

  // Fiber tags: 0 = FunctionComponent, 1 = ClassComponent, 11 = ForwardRef, 14 = MemoComponent, 15 = SimpleMemoComponent
  const isComponent = componentTags.has(fiber.tag);

  if (isComponent && result) {
    const id = nodeIdCounter++;
    const children: ComponentNode[] = [];
    let child = fiber.child;
    while (child) {
      walkFiber(child, children);
      child = child.sibling;
    }

    // Map this node ID to its nearest DOM element
    const domEl = findNearestDomElement(fiber);
    if (domEl) {
      nodeToElementMap.set(id, domEl);
      elementToNodeMap.set(domEl, { id, name: result.name });
    }

    // Store function reference for inspect() from DevTools panel
    const fn = typeof fiber.type === "function"
      ? fiber.type
      : typeof fiber.type === "object" && fiber.type !== null
        ? (fiber.type as { render?: unknown; type?: unknown }).render
          || (fiber.type as { render?: unknown; type?: unknown }).type
        : null;
    if (typeof fn === "function") {
      nodeToFunctionMap.set(id, fn as Function);
    }

    // Store fiber reference for hooks inspection
    nodeToFiberMap.set(id, fiber);

    const { classification, location } = getComponentSource(fiber);

    out.push({
      id,
      name: result.name,
      hocs: result.hocs.length > 0 ? result.hocs : undefined,
      props: serializeProps(fiber.memoizedProps || {}),
      children,
      source: classification,
      sourceLocation: location,
    });
  } else {
    let child = fiber.child;
    while (child) {
      walkFiber(child, out);
      child = child.sibling;
    }
  }
}

function findReactRoots(): FiberNode[] {
  const roots: FiberNode[] = [];

  const hook = (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: { getFiberRoots?: (id: number) => Set<{ current: FiberNode }> } }).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (hook?.getFiberRoots) {
    for (let i = 1; i <= 10; i++) {
      try {
        const fiberRoots = hook.getFiberRoots(i);
        if (fiberRoots) {
          for (const root of fiberRoots) {
            if (root.current) {
              roots.push(root.current);
            }
          }
        }
      } catch {
        // renderer not found at this id
      }
    }
  }

  if (roots.length === 0) {
    const allElements = document.querySelectorAll("*");
    for (const el of allElements) {
      const keys = Object.keys(el);
      for (const key of keys) {
        if (key.startsWith("__reactContainer$") || key.startsWith("__reactFiber$")) {
          const fiber = (el as unknown as Record<string, FiberNode>)[key];
          let current: FiberNode = fiber;
          while ((current as unknown as { return: FiberNode | null }).return) {
            current = (current as unknown as { return: FiberNode }).return;
          }
          if (!roots.includes(current)) {
            roots.push(current);
          }
          break;
        }
      }
      if (roots.length > 0) break;
    }
  }

  return roots;
}

// Buffer to store the latest scan result before the panel connects
let bufferedMessage: Record<string, unknown> | null = null;

function scanTree() {
  nodeIdCounter = 0;
  nodeToElementMap.clear();
  elementToNodeMap.clear();
  nodeToFunctionMap.clear();
  nodeToFiberMap.clear();
  const fiberRoots = findReactRoots();

  if (fiberRoots.length === 0) {
    const msg = { type: "REACT_NOT_FOUND" };
    bufferedMessage = msg;
    if (watching) {
      window.postMessage(msg, "*");
    }
    return;
  }

  const tree: ComponentNode[] = [];
  for (const root of fiberRoots) {
    walkFiber(root, tree);
  }

  const msg = { type: "REACT_TREE_RESULT", tree };
  bufferedMessage = msg;
  if (watching) {
    window.postMessage(msg, "*");
  }
}

// --- Highlight overlay ---

let highlightOverlay: HTMLDivElement | null = null;
let highlightLabel: HTMLDivElement | null = null;

const OVERLAY_ATTR = "data-rdt-overlay";

function ensureOverlay() {
  if (highlightOverlay) return;
  highlightOverlay = document.createElement("div");
  highlightOverlay.setAttribute(OVERLAY_ATTR, "");
  highlightOverlay.style.cssText =
    "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #60a5fa;background:rgba(96,165,250,0.12);transition:all 0.15s ease;display:none;";
  highlightLabel = document.createElement("div");
  highlightLabel.setAttribute(OVERLAY_ATTR, "");
  highlightLabel.style.cssText =
    "position:fixed;pointer-events:none;z-index:2147483647;background:#2563eb;color:#fff;font:11px/1.4 monospace;padding:2px 6px;border-radius:3px;white-space:nowrap;display:none;";
  document.documentElement.appendChild(highlightOverlay);
  document.documentElement.appendChild(highlightLabel);
}

function highlightElement(nodeId: number, nodeName: string) {
  ensureOverlay();
  const el = nodeToElementMap.get(nodeId);
  if (!el || !highlightOverlay || !highlightLabel) {
    hideHighlight();
    return;
  }

  const rect = el.getBoundingClientRect();
  highlightOverlay.style.top = `${rect.top}px`;
  highlightOverlay.style.left = `${rect.left}px`;
  highlightOverlay.style.width = `${rect.width}px`;
  highlightOverlay.style.height = `${rect.height}px`;
  highlightOverlay.style.display = "block";

  highlightLabel.textContent = `<${nodeName}> ${Math.round(rect.width)}×${Math.round(rect.height)}`;
  // Position label above the element, or below if too close to top
  const labelTop = rect.top > 24 ? rect.top - 22 : rect.bottom + 4;
  highlightLabel.style.top = `${labelTop}px`;
  highlightLabel.style.left = `${rect.left}px`;
  highlightLabel.style.display = "block";
}

function hideHighlight() {
  if (highlightOverlay) highlightOverlay.style.display = "none";
  if (highlightLabel) highlightLabel.style.display = "none";
}

// --- Inspect mode ---

let inspecting = false;

function findComponentForElement(el: Element): { id: number; name: string } | null {
  let current: Element | null = el;
  while (current) {
    const node = elementToNodeMap.get(current);
    if (node) return node;
    current = current.parentElement;
  }
  return null;
}

function onInspectMove(e: MouseEvent) {
  const target = e.target as Element;
  if (!target || (target instanceof Element && target.hasAttribute(OVERLAY_ATTR))) return;

  const node = findComponentForElement(target);
  if (node) {
    highlightElement(node.id, node.name);
  } else {
    hideHighlight();
  }
}

function onInspectClick(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  const target = e.target as Element;
  if (!target) return;

  const node = findComponentForElement(target);
  stopInspecting();
  if (node) {
    window.postMessage({ type: "INSPECT_SELECT", nodeId: node.id }, "*");
  }
}

function startInspecting() {
  if (inspecting) return;
  inspecting = true;
  document.addEventListener("mousemove", onInspectMove, true);
  document.addEventListener("click", onInspectClick, true);
  document.documentElement.style.cursor = "crosshair";
}

function stopInspecting() {
  if (!inspecting) return;
  inspecting = false;
  document.removeEventListener("mousemove", onInspectMove, true);
  document.removeEventListener("click", onInspectClick, true);
  document.documentElement.style.cursor = "";
  hideHighlight();
}

// --- Watching ---

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let reactHooked = false;

function debouncedScan() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => scanTree(), 250);
}

type HookType = {
  onCommitFiberRoot?: (...args: unknown[]) => void;
  inject?: (renderer: unknown) => number;
  renderers?: Map<number, unknown>;
};

function hookIntoReact() {
  if (reactHooked) return;
  const hook = (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: HookType }).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook) return;
  reactHooked = true;

  // Patch onCommitFiberRoot for already-registered renderers
  const originalCommit = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = (...args: unknown[]) => {
    originalCommit?.apply(hook, args);
    debouncedScan();
  };

  // Patch inject to catch future renderers
  const originalInject = hook.inject;
  hook.inject = (renderer: unknown) => {
    const id = originalInject?.call(hook, renderer) ?? 0;
    // Re-patch in case inject overwrites onCommitFiberRoot
    const currentCommit = hook.onCommitFiberRoot;
    if (currentCommit && !currentCommit.toString().includes("debouncedScan")) {
      hook.onCommitFiberRoot = (...args: unknown[]) => {
        currentCommit.apply(hook, args);
        debouncedScan();
      };
    }
    return id;
  };
}

let watching = false;

function startWatching() {
  if (watching) {
    // Already watching — just re-scan to respond to a retry
    scanTree();
    return;
  }
  watching = true;

  // Send buffered result immediately so the panel doesn't wait for a fresh scan
  if (bufferedMessage) {
    window.postMessage(bufferedMessage, "*");
  }

  // Then do a fresh scan for the most up-to-date tree
  scanTree();
  hookIntoReact();

  // Load source maps in background, clear cache, then re-scan with source classification
  loadSourceMaps().then(() => {
    fnSourceCache.clear();
    scanTree();
  });

  if (observer) return;
  observer = new MutationObserver((mutations) => {
    const isOverlayOnly = mutations.every((m) => {
      for (const node of [...m.addedNodes, ...m.removedNodes]) {
        if (node instanceof Element && !node.hasAttribute(OVERLAY_ATTR)) return false;
      }
      if (m.target instanceof Element && m.target.hasAttribute(OVERLAY_ATTR)) return true;
      return m.addedNodes.length === 0 && m.removedNodes.length === 0 && m.type === "attributes" &&
        m.target instanceof Element && m.target.hasAttribute(OVERLAY_ATTR);
    });
    if (isOverlayOnly) return;

    debouncedScan();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
  });
}

function stopWatching() {
  watching = false;
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  hideHighlight();
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (data?.type === "START_WATCHING") {
    startWatching();
  } else if (data?.type === "STOP_WATCHING") {
    stopWatching();
  } else if (data?.type === "SCAN_REACT_TREE") {
    scanTree();
  } else if (data?.type === "HIGHLIGHT_NODE") {
    highlightElement(data.nodeId, data.nodeName);
  } else if (data?.type === "HIDE_HIGHLIGHT") {
    hideHighlight();
  } else if (data?.type === "INSPECT_SOURCE") {
    const fn = nodeToFunctionMap.get(data.nodeId);
    if (fn) {
      // Chrome's inspect() opens the function's source in the Sources panel
      // For source-mapped files, it navigates to the original source
      (window as unknown as { inspect?: (target: unknown) => void }).inspect?.(fn);
    }
  } else if (data?.type === "START_INSPECT") {
    startInspecting();
  } else if (data?.type === "STOP_INSPECT") {
    stopInspecting();
  }
});

// --- Hooks inspection ---

interface HookInfo {
  id: number | null;
  name: string;
  value: unknown;
  subHooks: HookInfo[];
}

interface HookLogEntry {
  primitive: string;
  dispatcherHookName: string;
  stackError: Error;
  value: unknown;
  displayName: string | null;
  debugValue?: unknown;
  subHooks: HookLogEntry[];
}

interface DispatcherRef {
  get: () => unknown;
  set: (v: unknown) => void;
}

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

// Module-level mock dispatcher state
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

// Primitive stack cache for comparing dispatcher stacks
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

// Stack comparison utilities (ported from React DevTools' react-debug-tools)

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

// Stack comparison ported from React DevTools' react-debug-tools.
// Compares stack frames from top (index 0 = innermost) downward.

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

// Context setup for hooks that read context (Redux, zustand, etc.)

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

// Process debug values: hoist useDebugValue entries to parent custom hooks

// Tree building ported from React DevTools' buildTree algorithm.

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

function buildHookTree(
  readHookLog: HookLogEntry[],
  rootStack: ErrorStackParser.StackFrame[],
): HookInfo[] {
  const rootChildren: HookInfo[] = [];
  let prevStack: ErrorStackParser.StackFrame[] | null = null;
  let levelChildren = rootChildren;
  const stackOfChildren: HookInfo[][] = [];
  let nativeHookID = 0;

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
        const levelChild: HookInfo = {
          id: null,
          name: toUsePrefix(customHookName || "Unknown"),
          value: undefined,
          subHooks: children,
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
    const leafChild: HookInfo = {
      id: noId ? null : nativeHookID++,
      name,
      value: serializeValue(hook.value, 0),
      subHooks: [],
    };
    levelChildren.push(leafChild);
  }

  processDebugValues(rootChildren, null);
  return rootChildren;
}

// Fallback: guess hook types from memoizedState structure when dispatcher override fails

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
  let hookId = 0;

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

// Main hooks inspection function

function inspectHooksOfFiber(nodeId: number): HookInfo[] | null {
  try { return _inspectHooksOfFiberImpl(nodeId); }
  catch (e) { console.error('[RDT] inspectHooksOfFiber error:', e); return null; }
}

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

// Expose the inspection function globally
(window as unknown as Record<string, unknown>).__REACT_DEV_TOOLKIT_INSPECT_HOOKS__ = inspectHooksOfFiber;

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  world: "MAIN",
  main() {
    // Start hooking into React and buffering results immediately,
    // so data is ready when the DevTools panel connects.
    hookIntoReact();
    scanTree();
  },
});
