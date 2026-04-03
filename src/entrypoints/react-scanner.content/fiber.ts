import {
  type Fiber,
  getDisplayName,
  getType,
  isCompositeFiber,
  getNearestHostFiber,
} from "bippy";
import type { ComponentNode, FiberNameResult, HocBadge } from "./types";
import {
  nodeToElementMap,
  elementToNodeMap,
  nodeToFunctionMap,
  nodeToFiberMap,
  nextNodeId,
  getTypeId,
} from "./state";
import { getComponentSource } from "./component-source";
import { serializeProps } from "./serialize";

const REACT_MEMO_TYPE = Symbol.for("react.memo");
const REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref");
const REACT_LAZY_TYPE = Symbol.for("react.lazy");

function detectHocs(fiber: Fiber): HocBadge[] {
  const type = fiber.type;
  if (typeof type !== "object" || type === null) return [];

  const hocs: HocBadge[] = [];
  const $$typeof = (type as { $$typeof?: symbol }).$$typeof;

  if ($$typeof === REACT_MEMO_TYPE) {
    hocs.push("memo");
    // Check if memo wraps a forwardRef
    const inner = (type as { type?: { $$typeof?: symbol } }).type;
    if (inner?.$$typeof === REACT_FORWARD_REF_TYPE) {
      hocs.push("forwardRef");
    }
  } else if ($$typeof === REACT_FORWARD_REF_TYPE) {
    hocs.push("forwardRef");
  } else if ($$typeof === REACT_LAZY_TYPE) {
    hocs.push("lazy");
  }

  return hocs;
}

export function getFiberName(fiber: Fiber): FiberNameResult | null {
  const name = getDisplayName(fiber.type);
  if (!name) return null;
  return { name, hocs: detectHocs(fiber) };
}

export function findNearestDomElement(fiber: Fiber): Element | null {
  const hostFiber = getNearestHostFiber(fiber);
  if (!hostFiber) return null;
  return hostFiber.stateNode instanceof Element ? hostFiber.stateNode : null;
}

export function walkFiber(fiber: Fiber, out: ComponentNode[]): void {
  if (isCompositeFiber(fiber)) {
    const result = getFiberName(fiber);
    if (result) {
      const id = nextNodeId();
      const children: ComponentNode[] = [];
      let child = fiber.child;
      while (child) {
        walkFiber(child, children);
        child = child.sibling;
      }

      const domEl = findNearestDomElement(fiber);
      if (domEl) {
        nodeToElementMap.set(id, domEl);
        elementToNodeMap.set(domEl, { id, name: result.name });
      }

      // Store the underlying function reference for Chrome's inspect()
      const fn = getType(fiber.type);
      if (typeof fn === "function") {
        nodeToFunctionMap.set(id, fn);
      }

      nodeToFiberMap.set(id, fiber);

      const { classification, location } = getComponentSource(fiber);

      out.push({
        id,
        name: result.name,
        typeId: getTypeId(fiber.type),
        hocs: result.hocs.length > 0 ? result.hocs : undefined,
        props: serializeProps(fiber.memoizedProps || {}),
        children,
        source: classification,
        sourceLocation: location,
      });
      return;
    }
  }

  // Not a recognized component — pass through to children
  let child = fiber.child;
  while (child) {
    walkFiber(child, out);
    child = child.sibling;
  }
}
