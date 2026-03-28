import { memo } from 'react'
import { ROW_HEIGHT } from '../hooks/useVirtualScroll'

interface ClosingTagNodeProps {
  name: string
  depth: number
}

export const ClosingTagNode = memo(function ClosingTagNode({
  name,
  depth,
}: ClosingTagNodeProps) {
  return (
    <div
      className="flex items-center w-full px-2 text-sm whitespace-nowrap"
      style={{ paddingLeft: `${depth * 16 + 8}px`, height: `${ROW_HEIGHT}px` }}
    >
      <span className="w-4 h-4 mr-1 shrink-0" />
      <span className="text-blue-400">{'</'}</span>
      <span className="text-yellow-300">{name}</span>
      <span className="text-blue-400">{'>'}</span>
    </div>
  )
})
