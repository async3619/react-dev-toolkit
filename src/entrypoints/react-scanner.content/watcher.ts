import type { ComponentNode, HookType } from "./types";
import { resetNodeMaps } from "./state";
import { loadSourceMaps, fnSourceCache } from "./source-map";
import { walkFiber, findReactRoots } from "./fiber";
import { hideHighlight, OVERLAY_ATTR } from "./highlight";

// Buffer to store the latest scan result before the panel connects
let bufferedMessage: Record<string, unknown> | null = null;

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let reactHooked = false;
let watching = false;

export function scanTree() {
  resetNodeMaps();
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

function debouncedScan() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => scanTree(), 250);
}

export function hookIntoReact() {
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

export function startWatching() {
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
