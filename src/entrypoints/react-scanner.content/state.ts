import type { Fiber } from "bippy";

export let nodeIdCounter = 0;
export const nodeToElementMap = new Map<number, Element>();
export const elementToNodeMap = new Map<Element, { id: number; name: string }>();
export const nodeToFunctionMap = new Map<number, Function>();
export const nodeToFiberMap = new Map<number, Fiber>();

/** Maps fiber.type references to stable typeIds (persists across tree rebuilds) */
let typeIdCounter = 0;
const typeToIdMap = new Map<unknown, number>();
const idToTypeMap = new Map<number, unknown>();

export function getTypeId(fiberType: unknown): number {
  let id = typeToIdMap.get(fiberType);
  if (id === undefined) {
    id = typeIdCounter++;
    typeToIdMap.set(fiberType, id);
    idToTypeMap.set(id, fiberType);
  }
  return id;
}

export function getTypeByTypeId(typeId: number): unknown | undefined {
  return idToTypeMap.get(typeId);
}

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
