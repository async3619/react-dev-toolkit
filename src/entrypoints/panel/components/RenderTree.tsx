import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ComponentNode } from "@/types";
import { findAncestorPath } from "../utils/tree";
import { formatSourceLocation } from "../utils/format";
import { SidebarSection } from "./SidebarSection";

const ROW_HEIGHT_WITHOUT_SOURCE = 26;
const ROW_HEIGHT_WITH_SOURCE = 40;

interface RenderTreeProps {
  tree: ComponentNode[];
  selectedNode: ComponentNode | null;
  onSelect: (node: ComponentNode) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
}

function useScrollMargin(
  listRef: RefObject<HTMLDivElement | null>,
  scrollRef: RefObject<HTMLDivElement | null>,
) {
  const [scrollMargin, setScrollMargin] = useState(0);

  const update = useCallback(() => {
    const list = listRef.current;
    const scroll = scrollRef.current;
    if (!list || !scroll) return;
    const listRect = list.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    setScrollMargin(listRect.top - scrollRect.top + scroll.scrollTop);
  }, [listRef, scrollRef]);

  useEffect(() => {
    update();
    const scroll = scrollRef.current;
    if (!scroll) return;

    // Watch for any layout changes in the scroll container (siblings resizing, collapsing, etc.)
    const ro = new ResizeObserver(update);
    ro.observe(scroll);
    // Also observe all direct children to catch layout shifts from sibling sections
    for (const child of scroll.children) {
      ro.observe(child);
    }

    const mo = new MutationObserver(update);
    mo.observe(scroll, { childList: true, subtree: true, attributes: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [update, scrollRef]);

  return scrollMargin;
}

export function RenderTree({ tree, selectedNode, onSelect, scrollRef }: RenderTreeProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const path = useMemo(() => {
    if (!selectedNode) return null;
    return findAncestorPath(tree, selectedNode.id);
  }, [tree, selectedNode]);

  const scrollMargin = useScrollMargin(listRef, scrollRef);

  const virtualizer = useVirtualizer({
    count: path?.length ?? 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const node = path?.[index];
      return node?.sourceLocation ? ROW_HEIGHT_WITH_SOURCE : ROW_HEIGHT_WITHOUT_SOURCE;
    },
    overscan: 5,
    scrollMargin,
  });

  if (!path || path.length === 0) return null;

  return (
    <SidebarSection title={`Render Tree (${path.length})`} noPadding defaultOpen={false}>
      <div
        ref={listRef}
        style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const node = path[virtualRow.index];
          const isSelected = node.id === selectedNode?.id;
          const loc = node.sourceLocation;
          return (
            <button
              key={node.id}
              type="button"
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              className={`absolute left-0 right-0 flex flex-col justify-center text-left text-xs px-2 cursor-pointer hover:bg-gray-800 focus:outline-none ${
                isSelected ? "font-semibold" : ""
              }`}
              style={{
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
              }}
              onClick={() => onSelect(node)}
            >
              <span className={`truncate ${isSelected ? "text-yellow-300" : "text-blue-400 hover:text-blue-300"}`}>
                {node.name}
              </span>
              {loc && (
                <span className="truncate text-gray-500 text-[10px] leading-tight">
                  {formatSourceLocation(loc.fileName, loc.lineNumber)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </SidebarSection>
  );
}
