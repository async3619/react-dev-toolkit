// This script runs in the page's main world to access React internals

import { nodeToFunctionMap } from "./state";
import { highlightElement, hideHighlight } from "./highlight";
import { startInspecting, stopInspecting } from "./inspect";
import { scanTree, startWatching, stopWatching, hookIntoReact } from "./watcher";
import { inspectHooksOfFiber } from "./hooks";
import { startProfiling, stopProfiling, highlightProfilerNode, inspectProfilerNodeHooks } from "./profiler";

// Expose the inspection function globally
(window as unknown as Record<string, unknown>).__REACT_DEV_TOOLKIT_INSPECT_HOOKS__ = inspectHooksOfFiber;
(window as unknown as Record<string, unknown>).__REACT_DEV_TOOLKIT_INSPECT_PROFILER_HOOKS__ = inspectProfilerNodeHooks;

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (data?.type === "START_WATCHING") {
    startWatching();
  } else if (data?.type === "STOP_WATCHING") {
    stopWatching();
  } else if (data?.type === "SCAN_REACT_TREE") {
    scanTree(true);
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
  } else if (data?.type === "START_PROFILING") {
    startProfiling(data.targetTypeId, data.targetComponent);
  } else if (data?.type === "STOP_PROFILING") {
    stopProfiling();
  } else if (data?.type === "HIGHLIGHT_PROFILER_NODE") {
    highlightProfilerNode(data.nodeId, data.nodeName);
  }
});

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
