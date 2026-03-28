// This script runs in the page's main world to access React internals

interface FiberNode {
  tag: number;
  type: unknown;
  child: FiberNode | null;
  sibling: FiberNode | null;
  memoizedProps: Record<string, unknown>;
  stateNode: unknown;
  _debugSource?: { fileName: string; lineNumber: number };
}

interface ComponentNode {
  id: number;
  name: string;
  props: Record<string, unknown>;
  children: ComponentNode[];
}

let nodeIdCounter = 0;
const nodeToElementMap = new Map<number, Element>();
const elementToNodeMap = new Map<Element, { id: number; name: string }>();

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

function serializeProps(props: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (key === "children") continue;
    const val = props[key];
    if (val === null || val === undefined) {
      result[key] = val;
    } else if (typeof val === "function") {
      result[key] = `ƒ ${val.name || "anonymous"}()`;
    } else if (typeof val === "object") {
      try {
        result[key] = JSON.parse(JSON.stringify(val));
      } catch {
        result[key] = "[Object]";
      }
    } else {
      result[key] = val;
    }
  }
  return result;
}

function walkFiber(fiber: FiberNode): ComponentNode[] {
  const nodes: ComponentNode[] = [];
  const name = getFiberName(fiber);

  // Fiber tags: 0 = FunctionComponent, 1 = ClassComponent, 11 = ForwardRef, 14 = MemoComponent, 15 = SimpleMemoComponent
  const isComponent = [0, 1, 11, 14, 15].includes(fiber.tag);

  if (isComponent && name) {
    const id = nodeIdCounter++;
    const children: ComponentNode[] = [];
    let child = fiber.child;
    while (child) {
      children.push(...walkFiber(child));
      child = child.sibling;
    }

    // Map this node ID to its nearest DOM element
    const domEl = findNearestDomElement(fiber);
    if (domEl) {
      nodeToElementMap.set(id, domEl);
      elementToNodeMap.set(domEl, { id, name });
    }

    nodes.push({
      id,
      name,
      props: serializeProps(fiber.memoizedProps || {}),
      children,
    });
  } else {
    let child = fiber.child;
    while (child) {
      nodes.push(...walkFiber(child));
      child = child.sibling;
    }
  }

  return nodes;
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
  const fiberRoots = findReactRoots();

  if (fiberRoots.length === 0) {
    window.postMessage({ type: "REACT_NOT_FOUND" }, "*");
    return;
  }

  const tree: ComponentNode[] = [];
  for (const root of fiberRoots) {
    tree.push(...walkFiber(root));
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

function startWatching() {
  scanTree();
  hookIntoReact();

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
