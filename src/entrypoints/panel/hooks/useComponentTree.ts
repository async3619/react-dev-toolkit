import { useState, useEffect, useCallback, useRef } from "react";
import type { ComponentNode } from "@/types";

type TreeState =
  | { status: "idle" }
  | { status: "success"; tree: ComponentNode[] }
  | { status: "not-found" }
  | { status: "error"; error: string };

export function useComponentTree() {
  const [state, setState] = useState<TreeState>({ status: "idle" });
  const [inspectedNodeId, setInspectedNodeId] = useState<number | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  useEffect(() => {
    const tabId = browser.devtools.inspectedWindow.tabId;
    const port = browser.runtime.connect({ name: `devtools:${tabId}` });
    portRef.current = port;

    port.onMessage.addListener((message: unknown) => {
      const msg = message as { type: string; tree?: ComponentNode[]; error?: string; nodeId?: number };
      if (msg.type === "REACT_TREE_RESULT") {
        setState({ status: "success", tree: msg.tree ?? [] });
      } else if (msg.type === "REACT_NOT_FOUND") {
        setState({ status: "not-found" });
      } else if (msg.type === "INSPECT_SELECT") {
        setInspectedNodeId(msg.nodeId ?? null);
        setInspecting(false);
      }
    });

    // Start watching automatically
    port.postMessage({ type: "START_WATCHING" });

    return () => {
      port.postMessage({ type: "STOP_WATCHING" });
      port.disconnect();
      portRef.current = null;
    };
  }, []);

  const refresh = useCallback(() => {
    portRef.current?.postMessage({ type: "SCAN_REACT_TREE" });
  }, []);

  const highlightNode = useCallback((nodeId: number, nodeName: string) => {
    browser.devtools.inspectedWindow.eval(
      `window.postMessage({ type: "HIGHLIGHT_NODE", nodeId: ${nodeId}, nodeName: ${JSON.stringify(nodeName)} }, "*")`,
    );
  }, []);

  const hideHighlight = useCallback(() => {
    browser.devtools.inspectedWindow.eval(
      `window.postMessage({ type: "HIDE_HIGHLIGHT" }, "*")`,
    );
  }, []);

  const startInspect = useCallback(() => {
    setInspecting(true);
    setInspectedNodeId(null);
    browser.devtools.inspectedWindow.eval(
      `window.postMessage({ type: "START_INSPECT" }, "*")`,
    );
  }, []);

  const stopInspect = useCallback(() => {
    setInspecting(false);
    browser.devtools.inspectedWindow.eval(
      `window.postMessage({ type: "STOP_INSPECT" }, "*")`,
    );
  }, []);

  const consumeInspectedNodeId = useCallback(() => {
    const id = inspectedNodeId;
    setInspectedNodeId(null);
    return id;
  }, [inspectedNodeId]);

  return {
    state,
    refresh,
    highlightNode,
    hideHighlight,
    inspecting,
    inspectedNodeId,
    startInspect,
    stopInspect,
    consumeInspectedNodeId,
  };
}
