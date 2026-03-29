import { elementToNodeMap } from "./state";
import { highlightElement, hideHighlight, OVERLAY_ATTR } from "./highlight";

let inspecting = false;

function findComponentForElement(el: Element): { id: number; name: string } | null {
  let current: Element | null = el;
  while (current) {
    const node = elementToNodeMap.get(current);
    if (node) return node;
    current = current.parentElement;
  }
  return null;
}

function onInspectMove(e: MouseEvent) {
  const target = e.target as Element;
  if (!target || (target instanceof Element && target.hasAttribute(OVERLAY_ATTR))) return;

  const node = findComponentForElement(target);
  if (node) {
    highlightElement(node.id, node.name);
  } else {
    hideHighlight();
  }
}

function onInspectClick(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  const target = e.target as Element;
  if (!target) return;

  const node = findComponentForElement(target);
  stopInspecting();
  if (node) {
    window.postMessage({ type: "INSPECT_SELECT", nodeId: node.id }, "*");
  }
}

export function startInspecting() {
  if (inspecting) return;
  inspecting = true;
  document.addEventListener("mousemove", onInspectMove, true);
  document.addEventListener("click", onInspectClick, true);
  document.documentElement.style.cursor = "crosshair";
}

export function stopInspecting() {
  if (!inspecting) return;
  inspecting = false;
  document.removeEventListener("mousemove", onInspectMove, true);
  document.removeEventListener("click", onInspectClick, true);
  document.documentElement.style.cursor = "";
  hideHighlight();
}
