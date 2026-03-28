import { useComponentTree } from "../hooks/useComponentTree";
import { ComponentTree } from "./ComponentTree";

export function ComponentsTab() {
  const {
    state,
    highlightNode,
    hideHighlight,
    inspecting,
    inspectedNodeId,
    startInspect,
    stopInspect,
    consumeInspectedNodeId,
    hooks,
    inspectHooks,
  } = useComponentTree();

  if (state.status === "idle") {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        Detecting React components...
      </div>
    );
  }

  if (state.status === "not-found") {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        No React application detected on this page.
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400 text-sm">
        Error: {state.error}
      </div>
    );
  }

  if (state.tree.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        React detected, but no components found.
      </div>
    );
  }

  return (
    <ComponentTree
      tree={state.tree}
      onHighlight={highlightNode}
      onHideHighlight={hideHighlight}
      inspecting={inspecting}
      inspectedNodeId={inspectedNodeId}
      onStartInspect={startInspect}
      onStopInspect={stopInspect}
      onConsumeInspectedNodeId={consumeInspectedNodeId}
      hooks={hooks}
      onInspectHooks={inspectHooks}
    />
  );
}
