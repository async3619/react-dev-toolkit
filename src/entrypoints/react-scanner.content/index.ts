// This script runs in the page's main world to access React internals

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
  memoizedProps: Record<string, unknown>;
  stateNode: unknown;
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

function getFiberName(fiber: FiberNode): string | null {
  const type = fiber.type;
  if (!type) return null;
  if (typeof type === "string") return type;
  if (typeof type === "function") {
    return (type as { displayName?: string }).displayName || type.name || "Anonymous";
  }
  if (typeof type === "object") {
    if ((type as { displayName?: string }).displayName) {
      return (type as { displayName: string }).displayName;
    }
    if ((type as { render?: { displayName?: string; name?: string } }).render) {
      const render = (type as { render: { displayName?: string; name?: string } }).render;
      return render.displayName || render.name || "ForwardRef";
    }
    if ((type as { type?: { displayName?: string; name?: string } }).type) {
      const inner = (type as { type: { displayName?: string; name?: string } }).type;
      return `Memo(${inner.displayName || inner.name || "Anonymous"})`;
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

function serializeValue(val: unknown, depth: number): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === "symbol") return val.toString();
  if (typeof val === "function") return `ƒ ${val.name || "anonymous"}()`;
  if (typeof val !== "object") return val;
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
  const name = getFiberName(fiber);

  // Fiber tags: 0 = FunctionComponent, 1 = ClassComponent, 11 = ForwardRef, 14 = MemoComponent, 15 = SimpleMemoComponent
  const isComponent = componentTags.has(fiber.tag);

  if (isComponent && name) {
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
      elementToNodeMap.set(domEl, { id, name });
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

    const { classification, location } = getComponentSource(fiber);

    out.push({
      id,
      name,
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

function scanTree() {
  nodeIdCounter = 0;
  nodeToElementMap.clear();
  elementToNodeMap.clear();
  nodeToFunctionMap.clear();
  const fiberRoots = findReactRoots();

  if (fiberRoots.length === 0) {
    window.postMessage({ type: "REACT_NOT_FOUND" }, "*");
    return;
  }

  const tree: ComponentNode[] = [];
  for (const root of fiberRoots) {
    walkFiber(root, tree);
  }

  window.postMessage({ type: "REACT_TREE_RESULT", tree }, "*");
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

  // Scan immediately without waiting for source maps
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

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  world: "MAIN",
  main() {
    // Script is loaded — ready to receive watch/scan/highlight requests
  },
});
