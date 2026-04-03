import { instrument, getRDTHook, type FiberRoot, type Fiber } from "bippy";
import type { ComponentNode } from "./types";
import { resetNodeMaps } from "./state";
import { loadSourceMaps, fnSourceCache } from "./source-map";
import { walkFiber } from "./fiber";
import { hideHighlight, OVERLAY_ATTR } from "./highlight";
import { onCommitForProfiling } from "./profiler";

let bufferedMessage: Record<string, unknown> | null = null;

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let watching = false;
let instrumented = false;

/** Fiber roots collected from instrument() callbacks */
const fiberRoots = new Set<FiberRoot>();

function collectExistingRoots() {
  try {
    const hook = getRDTHook();
    if (!hook?.renderers) return;
    for (const [id] of hook.renderers) {
      const roots = (hook as unknown as { getFiberRoots?: (id: number) => Set<FiberRoot> }).getFiberRoots?.(id);
      if (roots) {
        for (const root of roots) {
          fiberRoots.add(root);
        }
      }
    }
  } catch {
    // hook not available yet
  }
}

export function scanTree(forcePost = false) {
  resetNodeMaps();

  // Ensure we have any existing roots on first scan
  if (fiberRoots.size === 0) {
    collectExistingRoots();
  }

  if (fiberRoots.size === 0) {
    const msg = { type: "REACT_NOT_FOUND" };
    bufferedMessage = msg;
    if (watching || forcePost) {
      window.postMessage(msg, "*");
    }
    return;
  }

  const tree: ComponentNode[] = [];
  for (const root of fiberRoots) {
    if (root.current) {
      walkFiber(root.current, tree);
    }
  }

  const msg = { type: "REACT_TREE_RESULT", tree };
  bufferedMessage = msg;
  if (watching || forcePost) {
    window.postMessage(msg, "*");
  }
}

function debouncedScan() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => scanTree(), 250);
}

export function hookIntoReact() {
  if (instrumented) return;
  instrumented = true;

  instrument({
    onCommitFiberRoot(_rendererID, root) {
      fiberRoots.add(root);
      debouncedScan();
      onCommitForProfiling(root);
    },
  });
}

export function startWatching() {
  if (watching) {
    scanTree();
    return;
  }
  watching = true;

  if (bufferedMessage) {
    window.postMessage(bufferedMessage, "*");
  }

  scanTree();
  hookIntoReact();

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

export function stopWatching() {
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
