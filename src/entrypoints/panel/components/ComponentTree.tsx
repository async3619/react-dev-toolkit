import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ComponentNode } from '@/types'
import { useOverlayScrollbar } from '../hooks/useOverlayScrollbar'
import { useVirtualScroll } from '../hooks/useVirtualScroll'
import { useComponentTreeStore } from '../stores/componentTreeStore'
import { useComponentsTab } from '../hooks/useComponentsTab'
import { estimateMaxWidth } from '../utils/tree'
import { PropsPanel } from './PropsPanel'
import { ResizablePanel } from './ResizablePanel'
import { TreeFilter } from './TreeFilter'
import { ClosingTagNode } from './ClosingTagNode'
import { TreeNode } from './TreeNode'

export function ComponentTree() {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewportRef = useOverlayScrollbar(hostRef)
  const sidebarScrollRef = useRef<HTMLDivElement>(null)

  // Global store: page interaction
  const highlightNode = useComponentTreeStore((s) => s.highlightNode)
  const hideHighlight = useComponentTreeStore((s) => s.hideHighlight)
  const inspecting = useComponentTreeStore((s) => s.inspecting)
  const startInspect = useComponentTreeStore((s) => s.startInspect)
  const stopInspect = useComponentTreeStore((s) => s.stopInspect)

  // Local tab state
  const {
    tree,
    filter,
    setFilter,
    filteredTree,
    flat,
    expandedIds,
    selectedId,
    setSelectedId,
    selectedIndex,
    selectedNode,
    toggleExpand,
    collapseWithChildren,
    handleKeyDown,
    hooks,
    firstPartyOnly,
    setFirstPartyOnly,
    showProps,
    setShowProps,
    showBadges,
    setShowBadges,
  } = useComponentsTab()

  const {
    startIndex,
    endIndex,
    totalHeight,
    offsetY,
    scrollToIndex,
  } = useVirtualScroll(viewportRef, flat.length)

  // Scroll selected node into view only when selection changes
  const prevSelectedIndexRef = useRef(-1)
  useEffect(() => {
    if (selectedIndex >= 0 && selectedIndex !== prevSelectedIndexRef.current) {
      const itemLeft = flat[selectedIndex].depth * 16 + 8
      scrollToIndex(selectedIndex, itemLeft)
    }
    prevSelectedIndexRef.current = selectedIndex
  }, [selectedIndex, flat, scrollToIndex])

  const handleSelect = useCallback(
    (node: ComponentNode) => {
      setSelectedId(node.id)
      highlightNode(node.id, node.name)
      hostRef.current?.focus()
    },
    [setSelectedId, highlightNode],
  )

  const handleToggleInspect = useCallback(() => {
    if (inspecting) {
      stopInspect()
    } else {
      startInspect()
    }
  }, [inspecting, startInspect, stopInspect])

  const contentWidth = useMemo(() => estimateMaxWidth(flat, expandedIds), [flat, expandedIds])
  const visibleItems = flat.slice(startIndex, endIndex)

  const treePanel = (
    <div className="relative flex flex-col h-full">
      <TreeFilter
        value={filter}
        onChange={setFilter}
        inspecting={inspecting}
        onToggleInspect={handleToggleInspect}
        firstPartyOnly={firstPartyOnly}
        onFirstPartyOnlyChange={setFirstPartyOnly}
        showProps={showProps}
        onShowPropsChange={setShowProps}
        showBadges={showBadges}
        onShowBadgesChange={setShowBadges}
      />
      <div
        ref={hostRef}
        className="flex-1 overflow-hidden focus:outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {filteredTree.length === 0 && filter && (
          <div className="p-4 text-gray-500 text-sm">
            No matching components.
          </div>
        )}
        {filteredTree.length > 0 && (
          <div style={{ height: `${totalHeight}px`, position: 'relative', minWidth: `${contentWidth}px` }}>
            <div
              style={{
                position: 'absolute',
                top: `${offsetY}px`,
                left: 0,
                right: 0,
              }}
            >
              {visibleItems.map((item) =>
                item.closingTag ? (
                  <ClosingTagNode
                    key={`${item.node.id}-close`}
                    node={item.node}
                    depth={item.depth}
                    isSelected={selectedId === item.node.id}
                    onSelect={handleSelect}
                    onHover={highlightNode}
                    onHoverEnd={hideHighlight}
                  />
                ) : (
                  <TreeNode
                    key={item.node.id}
                    node={item.node}
                    depth={item.depth}
                    filter={filter}
                    expanded={expandedIds.has(item.node.id)}
                    isSelected={selectedId === item.node.id}
                    showProps={showProps}
                    showBadges={showBadges}
                    onSelect={handleSelect}
                    onToggle={toggleExpand}
                    onCollapse={(id) => collapseWithChildren(id, filteredTree)}
                    onHover={highlightNode}
                    onHoverEnd={hideHighlight}
                  />
                ),
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <ResizablePanel
      left={treePanel}
      right={<PropsPanel node={selectedNode} tree={tree} onSelectNode={handleSelect} scrollRef={sidebarScrollRef} hooks={hooks} />}
      rightScrollRef={sidebarScrollRef}
    />
  )
}
