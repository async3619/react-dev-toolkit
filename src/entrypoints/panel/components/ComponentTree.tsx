import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { ComponentNode } from '@/types'
import { useOverlayScrollbar } from '../hooks/useOverlayScrollbar'
import { usePersistedState } from '../hooks/usePersistedState'
import { useTreeNavigation } from '../hooks/useTreeNavigation'
import { useVirtualScroll } from '../hooks/useVirtualScroll'
import { estimateMaxWidth } from '../utils/tree'
import { PropsPanel } from './PropsPanel'
import { ResizablePanel } from './ResizablePanel'
import { TreeFilter } from './TreeFilter'
import { TreeNode } from './TreeNode'

interface ComponentTreeProps {
  tree: ComponentNode[]
  onHighlight: (nodeId: number, nodeName: string) => void
  onHideHighlight: () => void
  inspecting: boolean
  inspectedNodeId: number | null
  onStartInspect: () => void
  onStopInspect: () => void
  onConsumeInspectedNodeId: () => number | null
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
  const hostRef = useRef<HTMLDivElement>(null)
  const viewportRef = useOverlayScrollbar(hostRef)
  const sidebarScrollRef = useRef<HTMLDivElement>(null)
  const [firstPartyOnly, setFirstPartyOnly] = usePersistedState('rdt:firstPartyOnly', false)
  const [showProps, setShowProps] = usePersistedState('rdt:showProps', true)
  const [showBadges, setShowBadges] = usePersistedState('rdt:showBadges', true)

  const {
    filter,
    setFilter,
    filteredTree,
    flat,
    expandedIds,
    selectedId,
    selectedIndex,
    selectedNode,
    select,
    selectById,
    toggleExpand,
    collapseWithChildren,
    handleKeyDown,
  } = useTreeNavigation(tree, firstPartyOnly)

  const {
    startIndex,
    endIndex,
    totalHeight,
    offsetY,
    scrollToIndex,
  } = useVirtualScroll(viewportRef, flat.length)

  // Scroll selected node into view
  useEffect(() => {
    if (selectedIndex >= 0) {
      const itemLeft = flat[selectedIndex].depth * 16 + 8
      scrollToIndex(selectedIndex, itemLeft)
    }
  }, [selectedIndex, flat, scrollToIndex])

  // When an element is inspected on the page, select it in the tree
  useEffect(() => {
    if (inspectedNodeId !== null) {
      selectById(inspectedNodeId)
      onConsumeInspectedNodeId()
    }
  }, [inspectedNodeId, selectById, onConsumeInspectedNodeId])

  const handleSelect = useCallback(
    (node: ComponentNode) => {
      select(node)
      onHighlight(node.id, node.name)
      hostRef.current?.focus()
    },
    [select, onHighlight],
  )

  const handleToggleInspect = useCallback(() => {
    if (inspecting) {
      onStopInspect()
    } else {
      onStartInspect()
    }
  }, [inspecting, onStartInspect, onStopInspect])

  const contentWidth = useMemo(() => estimateMaxWidth(flat), [flat])
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
              {visibleItems.map((item) => (
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
                  onHover={onHighlight}
                  onHoverEnd={onHideHighlight}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <ResizablePanel
      left={treePanel}
      right={<PropsPanel node={selectedNode} tree={tree} onSelectNode={handleSelect} scrollRef={sidebarScrollRef} />}
      rightScrollRef={sidebarScrollRef}
    />
  )
}
