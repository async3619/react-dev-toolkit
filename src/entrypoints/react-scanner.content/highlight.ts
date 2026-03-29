import { nodeToElementMap } from "./state";

export const OVERLAY_ATTR = "data-rdt-overlay";

let highlightOverlay: HTMLDivElement | null = null;
let highlightLabel: HTMLDivElement | null = null;

function ensureOverlay() {
  if (highlightOverlay) return;
  highlightOverlay = document.createElement("div");
  highlightOverlay.setAttribute(OVERLAY_ATTR, "");
  highlightOverlay.style.cssText =
    "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #60a5fa;background:rgba(96,165,250,0.12);transition:all 0.15s ease;display:none;";
  highlightLabel = document.createElement("div");
  highlightLabel.setAttribute(OVERLAY_ATTR, "");
  highlightLabel.style.cssText =
    "position:fixed;pointer-events:none;z-index:2147483647;background:#2563eb;color:#fff;font:11px/1.4 monospace;padding:2px 6px;border-radius:3px;white-space:nowrap;display:none;";
  document.documentElement.appendChild(highlightOverlay);
  document.documentElement.appendChild(highlightLabel);
}

export function highlightElement(nodeId: number, nodeName: string) {
  ensureOverlay();
  const el = nodeToElementMap.get(nodeId);
  if (!el || !highlightOverlay || !highlightLabel) {
    hideHighlight();
    return;
  }

  const rect = el.getBoundingClientRect();
  highlightOverlay.style.top = `${rect.top}px`;
  highlightOverlay.style.left = `${rect.left}px`;
  highlightOverlay.style.width = `${rect.width}px`;
  highlightOverlay.style.height = `${rect.height}px`;
  highlightOverlay.style.display = "block";

  highlightLabel.textContent = `<${nodeName}> ${Math.round(rect.width)}×${Math.round(rect.height)}`;
  // Position label above the element, or below if too close to top
  const labelTop = rect.top > 24 ? rect.top - 22 : rect.bottom + 4;
  highlightLabel.style.top = `${labelTop}px`;
  highlightLabel.style.left = `${rect.left}px`;
  highlightLabel.style.display = "block";
}

export function hideHighlight() {
  if (highlightOverlay) highlightOverlay.style.display = "none";
  if (highlightLabel) highlightLabel.style.display = "none";
}
