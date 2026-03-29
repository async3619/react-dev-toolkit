import type { FiberNode } from "./types";

export let nodeIdCounter = 0;
export const nodeToElementMap = new Map<number, Element>();
export const elementToNodeMap = new Map<Element, { id: number; name: string }>();
export const nodeToFunctionMap = new Map<number, Function>();
export const nodeToFiberMap = new Map<number, FiberNode>();

(window as unknown as Record<string, unknown>).__REACT_DEV_TOOLKIT_FN_REFS__ = nodeToFunctionMap;

export function resetNodeMaps(): void {
  nodeIdCounter = 0;
  nodeToElementMap.clear();
  elementToNodeMap.clear();
  nodeToFunctionMap.clear();
  nodeToFiberMap.clear();
}

export function nextNodeId(): number {
  return nodeIdCounter++;
}
