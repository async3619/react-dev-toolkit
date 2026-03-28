import { useRef, useEffect } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ComponentNode } from "@/types";
import { highlightName } from "../utils/highlight";

interface TreeNodeProps {
  node: ComponentNode;
  depth: number;
  filter: string;
  expandedIds: Set<number>;
  selectedId: number | null;
  onSelect: (node: ComponentNode) => void;
  onToggle: (nodeId: number) => void;
  onCollapse: (nodeId: number) => void;
  onHover: (nodeId: number, nodeName: string) => void;
  onHoverEnd: () => void;
}

export function TreeNode({ node, depth, filter, expandedIds, selectedId, onSelect, onToggle, onCollapse, onHover, onHoverEnd }: TreeNodeProps) {
  const expanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.id;
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isSelected) {
      btnRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [isSelected]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (expanded) {
      onCollapse(node.id);
    } else {
      onToggle(node.id);
    }
  };

  return (
    <div>
      <button
        ref={btnRef}
        type="button"
        className={`flex items-center w-full text-left px-2 py-0.5 text-sm hover:bg-gray-700/50 cursor-pointer focus:outline-none ${
          isSelected ? "bg-blue-900/40" : ""
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(node)}
        onMouseEnter={() => onHover(node.id, node.name)}
        onMouseLeave={onHoverEnd}
      >
        {hasChildren ? (
          <span
            className="w-4 h-4 flex items-center justify-center text-gray-500 mr-1 shrink-0"
            onClick={handleToggle}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        ) : (
          <span className="w-4 h-4 mr-1 shrink-0" />
        )}
        <span className="text-blue-400">{"<"}</span>
        <span className="text-yellow-300">{highlightName(node.name, filter)}</span>
        {Object.keys(node.props).length > 0 && (
          <span className="text-gray-500 ml-1 truncate">
            {Object.keys(node.props)
              .slice(0, 3)
              .map((k) => k)
              .join(" ")}
          </span>
        )}
        <span className="text-blue-400">
          {hasChildren ? ">" : " />"}
        </span>
      </button>
      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <TreeNode
            key={child.id}
            node={child}
            depth={depth + 1}
            filter={filter}
            expandedIds={expandedIds}
            selectedId={selectedId}
            onSelect={onSelect}
            onToggle={onToggle}
            onCollapse={onCollapse}
            onHover={onHover}
            onHoverEnd={onHoverEnd}
          />
        ))}
    </div>
  );
}
