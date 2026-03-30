import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ComponentNode, HookInfo } from '@/types'
import { useComponentTreeStore } from '../stores/componentTreeStore'
import { usePersistedState } from './usePersistedState'
import {
  type FlatNode,
  buildFlatList,
  collectAllIds,
  collectIdsToDepth,
  filterFirstPartyTree,
  filterTree,
} from '../utils/tree'

export function useComponentsTab() {
  const tree = useComponentTreeStore((s) => s.tree)
  const status = useComponentTreeStore((s) => s.status)
  const inspectedNodeId = useComponentTreeStore((s) => s.inspectedNodeId)
  const consumeInspectedNodeId = useComponentTreeStore((s) => s.consumeInspectedNodeId)
  const storeInspectHooks = useComponentTreeStore((s) => s.inspectHooks)

  // Navigation state (local to Components tab)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() =>
    collectIdsToDepth(tree, 1),
  )
  const [filter, setFilter] = useState('')
  const [hooks, setHooks] = useState<HookInfo[] | null>(null)

  // Display preferences (persisted to localStorage)
  const [firstPartyOnly, setFirstPartyOnly] = usePersistedState('rdt:firstPartyOnly', false)
  const [showProps, setShowProps] = usePersistedState('rdt:showProps', true)
  const [showBadges, setShowBadges] = usePersistedState('rdt:showBadges', true)

  // Derived data
  const baseTree = useMemo(
    () => (firstPartyOnly ? filterFirstPartyTree(tree) : tree),
    [tree, firstPartyOnly],
  )

  const filteredTree = useMemo(
    () => (filter ? filterTree(baseTree, filter) : baseTree),
    [baseTree, filter],
  )

  const flat: FlatNode[] = useMemo(
    () => buildFlatList(filteredTree, expandedIds),
    [filteredTree, expandedIds],
  )

  const selectedNode = useMemo(
    () => flat.find((n) => !n.closingTag && n.node.id === selectedId)?.node ?? null,
    [flat, selectedId],
  )

  const selectedIndex = useMemo(
    () =>
      selectedId !== null
        ? flat.findIndex((n) => !n.closingTag && n.node.id === selectedId)
        : -1,
    [flat, selectedId],
  )

  // When filtering, expand all filtered nodes so results are visible
  useEffect(() => {
    if (filter) {
      setExpandedIds(collectAllIds(filteredTree))
    }
  }, [filter, filteredTree])

  // When tree updates, keep only IDs that still exist
  useEffect(() => {
    const allIds = collectAllIds(tree)
    setExpandedIds((prev) => {
      const next = new Set<number>()
      for (const id of prev) {
        if (allIds.has(id)) next.add(id)
      }
      return next
    })
  }, [tree])

  // When an element is inspected on the page, select it in the tree
  useEffect(() => {
    if (inspectedNodeId !== null) {
      selectById(inspectedNodeId)
      consumeInspectedNodeId()
    }
  }, [inspectedNodeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Inspect hooks when selection changes
  useEffect(() => {
    if (selectedId !== null) {
      setHooks(null)
      storeInspectHooks(selectedId, setHooks)
    }
  }, [selectedId, storeInspectHooks])

  // Actions
  const selectById = useCallback(
    (id: number) => {
      setSelectedId(id)
      const expandAncestors = (
        nodes: ComponentNode[],
        path: number[],
      ): boolean => {
        for (const node of nodes) {
          if (node.id === id) {
            setExpandedIds((prev) => {
              const next = new Set(prev)
              for (const pid of path) next.add(pid)
              return next
            })
            return true
          }
          if (expandAncestors(node.children, [...path, node.id])) return true
        }
        return false
      }
      expandAncestors(tree, [])
    },
    [tree],
  )

  const toggleExpand = useCallback((nodeId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }, [])

  const collapseWithChildren = useCallback(
    (nodeId: number, nodes: ComponentNode[]) => {
      setExpandedIds((prev) => {
        const next = new Set(prev)
        const removeRecursive = (list: ComponentNode[]) => {
          for (const n of list) {
            next.delete(n.id)
            removeRecursive(n.children)
          }
        }
        next.delete(nodeId)
        const findAndCollapse = (list: ComponentNode[]) => {
          for (const n of list) {
            if (n.id === nodeId) {
              removeRecursive(n.children)
              return
            }
            findAndCollapse(n.children)
          }
        }
        findAndCollapse(nodes)
        return next
      })
    },
    [],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (selectedId === null) return

      const idx = flat.findIndex((n) => !n.closingTag && n.node.id === selectedId)
      if (idx === -1) return

      const current = flat[idx].node
      const isExpanded = expandedIds.has(current.id)
      const hasChildren = current.children.length > 0

      const findNext = (from: number): number => {
        for (let i = from + 1; i < flat.length; i++) {
          if (!flat[i].closingTag) return i
        }
        return from
      }
      const findPrev = (from: number): number => {
        for (let i = from - 1; i >= 0; i--) {
          if (!flat[i].closingTag) return i
        }
        return from
      }

      switch (e.key) {
        case 'ArrowRight': {
          e.preventDefault()
          if (hasChildren && !isExpanded) {
            toggleExpand(current.id)
          } else {
            const next = findNext(idx)
            if (next !== idx) setSelectedId(flat[next].node.id)
          }
          break
        }
        case 'ArrowLeft': {
          e.preventDefault()
          if (hasChildren && isExpanded) {
            collapseWithChildren(current.id, filteredTree)
          } else {
            const prev = findPrev(idx)
            if (prev !== idx) setSelectedId(flat[prev].node.id)
          }
          break
        }
        case 'ArrowDown': {
          e.preventDefault()
          const next = findNext(idx)
          if (next !== idx) setSelectedId(flat[next].node.id)
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          const prev = findPrev(idx)
          if (prev !== idx) setSelectedId(flat[prev].node.id)
          break
        }
      }
    },
    [selectedId, flat, expandedIds, filteredTree, toggleExpand, collapseWithChildren],
  )

  return {
    // From global store
    tree,
    status,

    // Local navigation
    filter,
    setFilter,
    filteredTree,
    flat,
    expandedIds,
    selectedId,
    setSelectedId,
    selectedIndex,
    selectedNode,
    selectById,
    toggleExpand,
    collapseWithChildren,
    handleKeyDown,
    hooks,

    // Display preferences
    firstPartyOnly,
    setFirstPartyOnly,
    showProps,
    setShowProps,
    showBadges,
    setShowBadges,
  }
}
