import type { RefObject } from "react";
import type { ComponentNode, HookInfo } from "@/types";
import { HooksSection } from "./HooksSection";
import { PropValue } from "./PropValue";
import { RenderTree } from "./RenderTree";
import { SidebarSection } from "./SidebarSection";
import { SourceSection } from "./SourceSection";
import { Tooltip } from "./Tooltip";

interface PropsPanelProps {
  node: ComponentNode | null;
  tree: ComponentNode[];
  onSelectNode: (node: ComponentNode) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  hooks: HookInfo[] | null;
}

export function PropsPanel({ node, tree, onSelectNode, scrollRef, hooks }: PropsPanelProps) {
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
        <Tooltip content={node.name}>
          <h3 className="text-sm font-semibold text-yellow-300 truncate">
            {"<"}{node.name}{" />"}
          </h3>
        </Tooltip>
      </div>
      <SidebarSection title={`Props (${entries.length})`}>
        {entries.length === 0 ? (
          <p className="text-gray-500 text-sm">No props</p>
        ) : (
          <div className="space-y-1">
            {entries.map(([key, value]) => (
              <div key={key} className="text-sm min-w-0">
                <span className="text-purple-400">{key}: </span>
                <PropValue value={value} />
              </div>
            ))}
          </div>
        )}
      </SidebarSection>
      {hooks && hooks.length > 0 && <HooksSection hooks={hooks} />}
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
