import { useState, useEffect, useCallback, useMemo } from "react";
import type { ComponentNode } from "@/types";
import { collectAllIds, buildFlatList, filterTree } from "../utils/tree";

export function useTreeNavigation(tree: ComponentNode[]) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => collectAllIds(tree));
  const [filter, setFilter] = useState("");

  const filteredTree = useMemo(
    () => (filter ? filterTree(tree, filter) : tree),
    [tree, filter],
  );

  // When filtering, expand all filtered nodes so results are visible
  useEffect(() => {
    if (filter) {
      setExpandedIds(collectAllIds(filteredTree));
    }
  }, [filter, filteredTree]);

  // When tree updates, keep only IDs that still exist
  useEffect(() => {
    const allIds = collectAllIds(tree);
    setExpandedIds((prev) => {
      const next = new Set<number>();
      for (const id of prev) {
        if (allIds.has(id)) next.add(id);
      }
      return next;
    });
  }, [tree]);

  const { flat } = useMemo(
    () => buildFlatList(filteredTree, expandedIds),
    [filteredTree, expandedIds],
  );

  const selectedNode = useMemo(
    () => flat.find((n) => n.id === selectedId) ?? null,
    [flat, selectedId],
  );

  const select = useCallback((node: ComponentNode) => {
    setSelectedId(node.id);
  }, []);

  const selectById = useCallback((id: number) => {
    setSelectedId(id);
    // Expand ancestors so the node is visible
    const expandAncestors = (nodes: ComponentNode[], path: number[]): boolean => {
      for (const node of nodes) {
        if (node.id === id) {
          setExpandedIds((prev) => {
            const next = new Set(prev);
            for (const pid of path) next.add(pid);
            return next;
          });
          return true;
        }
        if (expandAncestors(node.children, [...path, node.id])) return true;
      }
      return false;
    };
    expandAncestors(tree, []);
  }, [tree]);

  const toggleExpand = useCallback((nodeId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const collapseWithChildren = useCallback((nodeId: number, nodes: ComponentNode[]) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      const removeRecursive = (list: ComponentNode[]) => {
        for (const n of list) {
          next.delete(n.id);
          removeRecursive(n.children);
        }
      };
      next.delete(nodeId);
      const findAndCollapse = (list: ComponentNode[]) => {
        for (const n of list) {
          if (n.id === nodeId) {
            removeRecursive(n.children);
            return;
          }
          findAndCollapse(n.children);
        }
      };
      findAndCollapse(nodes);
      return next;
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (selectedId === null) return;

      const idx = flat.findIndex((n) => n.id === selectedId);
      if (idx === -1) return;

      const current = flat[idx];
      const isExpanded = expandedIds.has(current.id);
      const hasChildren = current.children.length > 0;

      switch (e.key) {
        case "ArrowRight": {
          e.preventDefault();
          if (hasChildren && !isExpanded) {
            toggleExpand(current.id);
          } else if (idx + 1 < flat.length) {
            setSelectedId(flat[idx + 1].id);
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (hasChildren && isExpanded) {
            collapseWithChildren(current.id, filteredTree);
          } else if (idx - 1 >= 0) {
            setSelectedId(flat[idx - 1].id);
          }
          break;
        }
        case "ArrowDown": {
          e.preventDefault();
          if (idx + 1 < flat.length) {
            setSelectedId(flat[idx + 1].id);
          }
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          if (idx - 1 >= 0) {
            setSelectedId(flat[idx - 1].id);
          }
          break;
        }
      }
    },
    [selectedId, flat, expandedIds, filteredTree, toggleExpand, collapseWithChildren],
  );

  return {
    filter,
    setFilter,
    filteredTree,
    expandedIds,
    selectedId,
    selectedNode,
    select,
    selectById,
    toggleExpand,
    collapseWithChildren,
    handleKeyDown,
  };
}
