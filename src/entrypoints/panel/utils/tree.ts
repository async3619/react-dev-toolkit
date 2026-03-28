import type { ComponentNode } from '@/types'

export interface FlatNode {
  node: ComponentNode
  depth: number
  parent: ComponentNode | null
}

export function filterTree(
  nodes: ComponentNode[],
  query: string,
): ComponentNode[] {
  const lower = query.toLowerCase()
  const filter = (list: ComponentNode[]): ComponentNode[] => {
    const result: ComponentNode[] = []
    for (const node of list) {
      const filteredChildren = filter(node.children)
      const nameMatches = node.name.toLowerCase().includes(lower)
      if (nameMatches || filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren })
      }
    }
    return result
  }
  return filter(nodes)
}

export function filterFirstPartyTree(nodes: ComponentNode[]): ComponentNode[] {
  const filter = (list: ComponentNode[]): ComponentNode[] => {
    const result: ComponentNode[] = []
    for (const node of list) {
      const filteredChildren = filter(node.children)
      if (node.source === 'first-party') {
        result.push({ ...node, children: filteredChildren })
      } else {
        result.push(...filteredChildren)
      }
    }
    return result
  }
  return filter(nodes)
}

export function collectAllIds(nodes: ComponentNode[]): Set<number> {
  const ids = new Set<number>()
  const walk = (list: ComponentNode[]) => {
    for (const node of list) {
      ids.add(node.id)
      walk(node.children)
    }
  }
  walk(nodes)
  return ids
}

export function collectIdsToDepth(
  nodes: ComponentNode[],
  maxDepth: number,
): Set<number> {
  const ids = new Set<number>()
  const walk = (list: ComponentNode[], depth: number) => {
    if (depth >= maxDepth) return
    for (const node of list) {
      ids.add(node.id)
      walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return ids
}

const CHAR_WIDTH = 8
const INDENT_PER_DEPTH = 16
const BASE_PADDING = 8
const CHEVRON_WIDTH = 20
const RIGHT_PADDING = 8

export function estimateRowWidth(node: ComponentNode, depth: number): number {
  const indent = depth * INDENT_PER_DEPTH + BASE_PADDING
  const propKeys = Object.keys(node.props).slice(0, 3)
  // "<" + name + props + ">" or " />"
  const textLen =
    1 + node.name.length + (propKeys.length > 0 ? 1 + propKeys.join(' ').length : 0) + (node.children.length > 0 ? 1 : 3)
  return indent + CHEVRON_WIDTH + textLen * CHAR_WIDTH + RIGHT_PADDING
}

export function estimateMaxWidth(flat: FlatNode[]): number {
  let max = 0
  for (const { node, depth } of flat) {
    const w = estimateRowWidth(node, depth)
    if (w > max) max = w
  }
  return max
}

export function buildFlatList(
  nodes: ComponentNode[],
  expandedIds: Set<number>,
): FlatNode[] {
  const flat: FlatNode[] = []
  const walk = (
    list: ComponentNode[],
    depth: number,
    parent: ComponentNode | null,
  ) => {
    for (const node of list) {
      flat.push({ node, depth, parent })
      if (expandedIds.has(node.id) && node.children.length > 0) {
        walk(node.children, depth + 1, node)
      }
    }
  }
  walk(nodes, 0, null)
  return flat
}
