import { memo, useCallback } from 'react'
import type { ComponentNode } from '@/types'
import { ROW_HEIGHT } from '../hooks/useVirtualScroll'

interface ClosingTagNodeProps {
  node: ComponentNode
  depth: number
  isSelected: boolean
  onSelect: (node: ComponentNode) => void
  onHover: (nodeId: number, nodeName: string) => void
  onHoverEnd: () => void
}

export const ClosingTagNode = memo(function ClosingTagNode({
  node,
  depth,
  isSelected,
  onSelect,
  onHover,
  onHoverEnd,
}: ClosingTagNodeProps) {
  const handleClick = useCallback(() => {
    onSelect(node)
  }, [node, onSelect])

  return (
    <button
      type="button"
      className={`flex items-center w-full px-2 text-sm whitespace-nowrap text-left hover:bg-gray-700/50 cursor-pointer focus:outline-none ${isSelected ? 'bg-blue-900/40' : ''}`}
      style={{ paddingLeft: `${depth * 16 + 8}px`, height: `${ROW_HEIGHT}px` }}
      onClick={handleClick}
      onMouseEnter={() => onHover(node.id, node.name)}
      onMouseLeave={onHoverEnd}
    >
      <span className="w-4 h-4 mr-1 shrink-0" />
      <span className="text-blue-400">{'</'}</span>
      <span className="text-yellow-300">{node.name}</span>
      <span className="text-blue-400">{'>'}</span>
    </button>
  )
})
