import type { ComponentNode, FiberNode, FiberNameResult, HocBadge } from "./types";
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

export function getFiberName(fiber: FiberNode): FiberNameResult | null {
  const type = fiber.type;
  if (!type) return null;
  if (typeof type === "string") return { name: type, hocs: [] };
  if (typeof type === "function") {
    const name = (type as { displayName?: string }).displayName || type.name || "Anonymous";
    return { name, hocs: [] };
  }
  if (typeof type === "object") {
    const objType = type as {
      displayName?: string;
      render?: { displayName?: string; name?: string };
      type?: { displayName?: string; name?: string; render?: { displayName?: string; name?: string } };
      $$typeof?: symbol;
    };

    // ForwardRef: has .render
    if (objType.render) {
      const name = objType.displayName || objType.render.displayName || objType.render.name || "Anonymous";
      return { name, hocs: ["forwardRef"] };
    }

    // Memo: has .type (inner component)
    if (objType.type) {
      const inner = objType.type;
      const hocs: HocBadge[] = ["memo"];

      // Memo wrapping ForwardRef: inner has .render
      if (inner.render) {
        hocs.push("forwardRef");
        const name = objType.displayName || inner.displayName || inner.render.displayName || inner.render.name || "Anonymous";
        return { name, hocs };
      }

      const name = objType.displayName || inner.displayName || inner.name || "Anonymous";
      return { name, hocs };
    }

    // Lazy components
    if (objType.$$typeof && String(objType.$$typeof) === "Symbol(react.lazy)") {
      const name = objType.displayName || "Lazy";
      return { name, hocs: ["lazy"] };
    }

    if (objType.displayName) {
      return { name: objType.displayName, hocs: [] };
    }
  }
  return null;
}

// Walk down the fiber to find the nearest host DOM element
export function findNearestDomElement(fiber: FiberNode): Element | null {
  // tag 5 = HostComponent (DOM element)
  if (fiber.tag === 5 && fiber.stateNode instanceof Element) {
    return fiber.stateNode;
  }
  let child = fiber.child;
  while (child) {
    const el = findNearestDomElement(child);
    if (el) return el;
    child = child.sibling;
  }
  return null;
}

const componentTags = new Set([0, 1, 11, 14, 15]);

export function walkFiber(fiber: FiberNode, out: ComponentNode[]): void {
  const result = getFiberName(fiber);

  // Fiber tags: 0 = FunctionComponent, 1 = ClassComponent, 11 = ForwardRef, 14 = MemoComponent, 15 = SimpleMemoComponent
  const isComponent = componentTags.has(fiber.tag);

  if (isComponent && result) {
    const id = nextNodeId();
    const children: ComponentNode[] = [];
    let child = fiber.child;
    while (child) {
      walkFiber(child, children);
      child = child.sibling;
    }

    // Map this node ID to its nearest DOM element
    const domEl = findNearestDomElement(fiber);
    if (domEl) {
      nodeToElementMap.set(id, domEl);
      elementToNodeMap.set(domEl, { id, name: result.name });
    }

    // Store function reference for inspect() from DevTools panel
    const fn = typeof fiber.type === "function"
      ? fiber.type
      : typeof fiber.type === "object" && fiber.type !== null
        ? (fiber.type as { render?: unknown; type?: unknown }).render
          || (fiber.type as { render?: unknown; type?: unknown }).type
        : null;
    if (typeof fn === "function") {
      nodeToFunctionMap.set(id, fn as Function);
    }

    // Store fiber reference for hooks inspection
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
  } else {
    let child = fiber.child;
    while (child) {
      walkFiber(child, out);
      child = child.sibling;
    }
  }
}

export function findReactRoots(): FiberNode[] {
  const roots: FiberNode[] = [];

  const hook = (window as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: { getFiberRoots?: (id: number) => Set<{ current: FiberNode }> } }).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (hook?.getFiberRoots) {
    for (let i = 1; i <= 10; i++) {
      try {
        const fiberRoots = hook.getFiberRoots(i);
        if (fiberRoots) {
          for (const root of fiberRoots) {
            if (root.current) {
              roots.push(root.current);
            }
          }
        }
      } catch {
        // renderer not found at this id
      }
    }
  }

  if (roots.length === 0) {
    const allElements = document.querySelectorAll("*");
    for (const el of allElements) {
      const keys = Object.keys(el);
      for (const key of keys) {
        if (key.startsWith("__reactContainer$") || key.startsWith("__reactFiber$")) {
          const fiber = (el as unknown as Record<string, FiberNode>)[key];
          let current: FiberNode = fiber;
          while ((current as unknown as { return: FiberNode | null }).return) {
            current = (current as unknown as { return: FiberNode }).return;
          }
          if (!roots.includes(current)) {
            roots.push(current);
          }
          break;
        }
      }
      if (roots.length > 0) break;
    }
  }

  return roots;
}
