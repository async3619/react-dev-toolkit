import type { ComponentNode } from "@/types";

export function filterTree(nodes: ComponentNode[], query: string): ComponentNode[] {
  const lower = query.toLowerCase();
  const filter = (list: ComponentNode[]): ComponentNode[] => {
    const result: ComponentNode[] = [];
    for (const node of list) {
      const filteredChildren = filter(node.children);
      const nameMatches = node.name.toLowerCase().includes(lower);
      if (nameMatches || filteredChildren.length > 0) {
        result.push({ ...node, children: filteredChildren });
      }
    }
    return result;
  };
  return filter(nodes);
}

export function collectAllIds(nodes: ComponentNode[]): Set<number> {
  const ids = new Set<number>();
  const walk = (list: ComponentNode[]) => {
    for (const node of list) {
      ids.add(node.id);
      walk(node.children);
    }
  };
  walk(nodes);
  return ids;
}

export function buildFlatList(
  nodes: ComponentNode[],
  expandedIds: Set<number>,
): { flat: ComponentNode[]; parentMap: Map<number, ComponentNode | null> } {
  const flat: ComponentNode[] = [];
  const parentMap = new Map<number, ComponentNode | null>();
  const walk = (list: ComponentNode[], parent: ComponentNode | null) => {
    for (const node of list) {
      flat.push(node);
      parentMap.set(node.id, parent);
      if (expandedIds.has(node.id) && node.children.length > 0) {
        walk(node.children, node);
      }
    }
  };
  walk(nodes, null);
  return { flat, parentMap };
}
