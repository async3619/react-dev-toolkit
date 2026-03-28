import type { RefObject } from "react";
import type { ComponentNode } from "@/types";
import { PropValue } from "./PropValue";
import { RenderTree } from "./RenderTree";
import { SidebarSection } from "./SidebarSection";
import { SourceSection } from "./SourceSection";

interface PropsPanelProps {
  node: ComponentNode | null;
  tree: ComponentNode[];
  onSelectNode: (node: ComponentNode) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}

export function PropsPanel({ node, tree, onSelectNode, scrollRef }: PropsPanelProps) {
  if (!node) {
    return (
      <div className="p-4 text-gray-500 text-sm">
        Select a component to view its props.
      </div>
    );
  }

  const entries = Object.entries(node.props);

  return (
    <div>
      <div className="px-3 py-2 border-b border-gray-700">
        <h3 className="text-sm font-semibold text-yellow-300">
          {"<"}{node.name}{" />"}
        </h3>
      </div>
      <SidebarSection title={`Props (${entries.length})`}>
        {entries.length === 0 ? (
          <p className="text-gray-500 text-sm">No props</p>
        ) : (
          <div className="space-y-1">
            {entries.map(([key, value]) => (
              <div key={key} className="flex text-sm gap-2 min-w-0">
                <span className="text-purple-400 shrink-0">{key}:</span>
                <div className="min-w-0 flex-1">
                  <PropValue value={value} />
                </div>
              </div>
            ))}
          </div>
        )}
      </SidebarSection>
      <RenderTree
        tree={tree}
        selectedNode={node}
        onSelect={onSelectNode}
        scrollRef={scrollRef}
      />
      <SourceSection node={node} />
    </div>
  );
}
