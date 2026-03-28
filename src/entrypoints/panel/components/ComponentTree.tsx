import { useCallback, useEffect, useRef } from "react";
import type { ComponentNode } from "@/types";
import { TreeNode } from "./TreeNode";
import { TreeFilter } from "./TreeFilter";
import { PropsPanel } from "./PropsPanel";
import { ResizablePanel } from "./ResizablePanel";
import { useTreeNavigation } from "../hooks/useTreeNavigation";

interface ComponentTreeProps {
  tree: ComponentNode[];
  onHighlight: (nodeId: number, nodeName: string) => void;
  onHideHighlight: () => void;
  inspecting: boolean;
  inspectedNodeId: number | null;
  onStartInspect: () => void;
  onStopInspect: () => void;
  onConsumeInspectedNodeId: () => number | null;
}

export function ComponentTree({
  tree,
  onHighlight,
  onHideHighlight,
  inspecting,
  inspectedNodeId,
  onStartInspect,
  onStopInspect,
  onConsumeInspectedNodeId,
}: ComponentTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    filter,
    setFilter,
    filteredTree,
    expandedIds,
    selectedId,
    selectedNode,
    select,
    selectById,
    toggleExpand,
    collapseWithChildren,
    handleKeyDown,
  } = useTreeNavigation(tree);

  // When an element is inspected on the page, select it in the tree
  useEffect(() => {
    if (inspectedNodeId !== null) {
      selectById(inspectedNodeId);
      onConsumeInspectedNodeId();
    }
  }, [inspectedNodeId, selectById, onConsumeInspectedNodeId]);

  const handleSelect = useCallback(
    (node: ComponentNode) => {
      select(node);
      onHighlight(node.id, node.name);
      containerRef.current?.focus();
    },
    [select, onHighlight],
  );

  const handleToggleInspect = useCallback(() => {
    if (inspecting) {
      onStopInspect();
    } else {
      onStartInspect();
    }
  }, [inspecting, onStartInspect, onStopInspect]);

  const treePanel = (
    <>
      <TreeFilter
        value={filter}
        onChange={setFilter}
        inspecting={inspecting}
        onToggleInspect={handleToggleInspect}
      />
      <div
        ref={containerRef}
        className="flex-1 overflow-auto focus:outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {filteredTree.length === 0 && filter && (
          <div className="p-4 text-gray-500 text-sm">No matching components.</div>
        )}
        {filteredTree.map((node) => (
          <TreeNode
            key={node.id}
            node={node}
            depth={0}
            filter={filter}
            expandedIds={expandedIds}
            selectedId={selectedId}
            onSelect={handleSelect}
            onToggle={toggleExpand}
            onCollapse={(id) => collapseWithChildren(id, filteredTree)}
            onHover={onHighlight}
            onHoverEnd={onHideHighlight}
          />
        ))}
      </div>
    </>
  );

  return (
    <ResizablePanel
      left={treePanel}
      right={<PropsPanel node={selectedNode} />}
    />
  );
}
