import { ChevronDown, ChevronRight } from 'lucide-react'
import { memo } from 'react'
import type { ComponentNode } from '@/types'
import { ROW_HEIGHT } from '../hooks/useVirtualScroll'
import { highlightName } from '../utils/highlight'

interface TreeNodeProps {
  node: ComponentNode
  depth: number
  filter: string
  expanded: boolean
  isSelected: boolean
  showProps: boolean
  showBadges: boolean
  onSelect: (node: ComponentNode) => void
  onToggle: (nodeId: number) => void
  onCollapse: (nodeId: number) => void
  onHover: (nodeId: number, nodeName: string) => void
  onHoverEnd: () => void
}

export const TreeNode = memo(function TreeNode({
  node,
  depth,
  filter,
  expanded,
  isSelected,
  showProps,
  showBadges,
  onSelect,
  onToggle,
  onCollapse,
  onHover,
  onHoverEnd,
}: TreeNodeProps) {
  const hasChildren = node.children.length > 0

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (expanded) {
      onCollapse(node.id)
    } else {
      onToggle(node.id)
    }
  }

  return (
    <button
      type="button"
      className={`flex items-center w-full text-left px-2 text-sm hover:bg-gray-700/50 cursor-pointer focus:outline-none whitespace-nowrap ${
        isSelected ? 'bg-blue-900/40' : ''
      }`}
      style={{ paddingLeft: `${depth * 16 + 8}px`, height: `${ROW_HEIGHT}px` }}
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
      <span className="text-blue-400">{'<'}</span>
      <span className="text-yellow-300">
        {highlightName(node.name, filter)}
      </span>
      {showProps && Object.keys(node.props).length > 0 && (
        <span className="text-gray-500 ml-1 truncate">
          {Object.keys(node.props)
            .slice(0, 3)
            .map((k) => k)
            .join(' ')}
        </span>
      )}
      <span className="text-blue-400">{hasChildren ? '>' : ' />'}</span>
      {hasChildren && !expanded && (
        <>
          <span className="text-gray-500">{'…'}</span>
          <span className="text-blue-400">{'</'}</span>
          <span className="text-yellow-300">{node.name}</span>
          <span className="text-blue-400">{'>'}</span>
        </>
      )}
      {showBadges && node.hocs && node.hocs.length > 0 && (
        <span className="ml-1 flex items-center gap-0.5 shrink-0">
          {node.hocs.map((hoc) => (
            <span
              key={hoc}
              className="text-[10px] leading-none px-1 py-0.5 rounded bg-gray-700 text-gray-300"
            >
              {hoc}
            </span>
          ))}
        </span>
      )}
    </button>
  )
})
