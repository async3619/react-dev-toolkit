import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import {
  type FlatBar,
  type FlameZoom,
  type ZoomAnim,
  type CommitTransition,
  ROW_HEIGHT,
  TOOLTIP_OFFSET,
  CANVAS_PAD,
  LERP_SPEED,
  easeOut,
  buildTransition,
  getDisplayRect,
  getBarColor,
  getBarColorHover,
  getBarColorBlended,
} from "../utils/profiler";

// --- Canvas drawing ---

function drawBars(
  ctx: CanvasRenderingContext2D,
  bars: FlatBar[],
  contentWidth: number,
  hovered: FlatBar | null,
  zoom: FlameZoom | null,
) {
  for (const bar of bars) {
    const rect = getDisplayRect(bar, contentWidth, zoom);
    if (!rect) continue;

    const { x, y, w, h, dimmed } = rect;
    const isHovered = bar === hovered;

    // Background
    if (dimmed) {
      ctx.fillStyle = isHovered ? "hsl(220, 10%, 20%)" : "hsl(220, 10%, 15%)";
    } else if (bar.colorBlend !== undefined) {
      ctx.fillStyle = getBarColorBlended(
        bar.intensity,
        bar.colorBlend,
        isHovered,
      );
    } else if (bar.didRender) {
      ctx.fillStyle = isHovered
        ? getBarColorHover(bar.intensity)
        : getBarColor(bar.intensity);
    } else {
      ctx.fillStyle = isHovered ? "hsl(220, 10%, 28%)" : "hsl(220, 10%, 22%)";
    }
    ctx.fillRect(x, y, w, h);

    // Border (right + bottom)
    ctx.fillStyle = "rgba(17, 24, 39, 0.3)";
    ctx.fillRect(x + w - 1, y, 1, h);
    ctx.fillRect(x, y + h - 1, w, 1);

    // Text (clipped to bar rect)
    if (w > 20) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();

      const textBlend = bar.colorBlend ?? (bar.didRender ? 1 : 0);
      const tw = Math.round(107 + (255 - 107) * textBlend);
      const tg = Math.round(114 + (255 - 114) * textBlend);
      const tb = Math.round(128 + (255 - 128) * textBlend);
      ctx.fillStyle = dimmed
        ? "rgb(107,114,128)"
        : `rgb(${tw},${tg},${tb})`;
      const text =
        bar.didRender && w > 80
          ? `${bar.name} ${bar.selfDuration.toFixed(1)}ms`
          : bar.name;
      ctx.fillText(text, x + 4, y + h / 2);

      ctx.restore();
    }
  }
}

// --- Hit testing ---

function hitTest(
  bars: FlatBar[],
  canvasRect: DOMRect,
  clientX: number,
  clientY: number,
  zoom: FlameZoom | null,
): FlatBar | null {
  const mx = clientX - canvasRect.left;
  const my = clientY - canvasRect.top;
  const contentWidth = canvasRect.width - CANVAS_PAD * 2;

  for (let i = bars.length - 1; i >= 0; i--) {
    const bar = bars[i];
    const rect = getDisplayRect(bar, contentWidth, zoom);
    if (!rect) continue;

    const { x, y, w, h } = rect;
    if (mx >= x && mx <= x + w && my >= y && my <= y + h + 1) {
      return bar;
    }
  }
  return null;
}

// --- Tooltip ---

function updateTooltipContent(tip: HTMLDivElement, bar: FlatBar) {
  const hocBadges =
    bar.hocs
      ?.map(
        (h) =>
          `<span class="px-1 rounded text-[10px] bg-gray-700 text-gray-300">${h}</span>`,
      )
      .join("") ?? "";

  const timeInfo = bar.didRender
    ? `self: <span class="text-white">${bar.selfDuration.toFixed(1)}ms</span><span class="mx-1.5 text-gray-600">|</span>total: <span class="text-white">${bar.totalDuration.toFixed(1)}ms</span>`
    : `<span class="text-gray-500">Did not render</span>`;

  const reasons =
    bar.didRender && bar.renderReasons?.length
      ? `<div class="text-gray-500 mt-0.5 border-t border-gray-700 pt-0.5">${bar.renderReasons.map((r) => `<div class="text-[10px]">${r}</div>`).join("")}</div>`
      : "";

  tip.innerHTML =
    `<div class="flex items-center gap-1.5 mb-0.5"><span class="text-yellow-300 font-semibold">${bar.name}</span>${hocBadges}</div>` +
    `<div class="text-gray-400">${timeInfo}</div>` +
    reasons;
}

function positionTooltip(tip: HTMLDivElement, x: number, y: number) {
  const { width, height } = tip.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = x + TOOLTIP_OFFSET;
  let top = y + TOOLTIP_OFFSET;
  if (left + width > vw) left = x - width - TOOLTIP_OFFSET;
  if (top + height > vh) top = y - height - TOOLTIP_OFFSET;

  tip.style.left = `${Math.max(0, left)}px`;
  tip.style.top = `${Math.max(0, top)}px`;
}

// --- Page highlight ---

function highlightOnPage(nodeId: number, nodeName: string) {
  browser.devtools.inspectedWindow.eval(
    `window.postMessage({ type: "HIGHLIGHT_PROFILER_NODE", nodeId: ${nodeId}, nodeName: ${JSON.stringify(nodeName)} }, "*")`,
  );
}

function hideHighlightOnPage() {
  browser.devtools.inspectedWindow.eval(
    `window.postMessage({ type: "HIDE_HIGHLIGHT" }, "*")`,
  );
}

// --- FlameGraph component ---

export interface FlameGraphHandle {
  zoomToBar: (nodeId: number) => void;
}

export const FlameGraph = forwardRef<
  FlameGraphHandle,
  { bars: FlatBar[]; totalHeight: number; onBarSelect?: (bar: FlatBar | null) => void }
>(function FlameGraph({ bars, totalHeight, onBarSelect }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // Tooltip managed entirely outside React to avoid portal/reconciliation issues
  useEffect(() => {
    const tip = document.createElement("div");
    tip.className =
      "fixed z-[2147483647] pointer-events-none px-2.5 py-1.5 rounded bg-gray-800 border border-gray-600 shadow-lg text-xs font-mono";
    tip.style.display = "none";
    document.body.appendChild(tip);
    tooltipRef.current = tip;
    return () => {
      tip.remove();
      tooltipRef.current = null;
    };
  }, []);
  const hoveredRef = useRef<FlatBar | null>(null);
  const zoomAnimRef = useRef<ZoomAnim | null>(null);
  const transitionRef = useRef<CommitTransition | null>(null);
  const prevBarsRef = useRef<FlatBar[]>(bars);
  const onBarSelectRef = useRef(onBarSelect);
  onBarSelectRef.current = onBarSelect;
  const rafId = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0, active: false });

  // Start bar transition + reset zoom when data changes (new commit)
  useEffect(() => {
    if (prevBarsRef.current !== bars && prevBarsRef.current.length > 0) {
      transitionRef.current = buildTransition(prevBarsRef.current, bars);
    }
    prevBarsRef.current = bars;
    zoomAnimRef.current = null;
  }, [bars]);

  // Single rAF loop: animate zoom + transition + draw + hit test + tooltip
  const tick = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = totalHeight + CANVAS_PAD * 2;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    ctx.font =
      '10px ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';
    ctx.textBaseline = "middle";

    const contentWidth = width - CANVAS_PAD * 2;

    // Animate zoom
    let zoom: FlameZoom | null = null;
    const s = zoomAnimRef.current;
    if (s) {
      s.currentLeft += (s.targetLeft - s.currentLeft) * LERP_SPEED;
      s.currentWidth += (s.targetWidth - s.currentWidth) * LERP_SPEED;

      if (
        Math.abs(s.currentLeft - s.targetLeft) < 0.01 &&
        Math.abs(s.currentWidth - s.targetWidth) < 0.01
      ) {
        s.currentLeft = s.targetLeft;
        s.currentWidth = s.targetWidth;
        if (s.depth === -1) {
          zoomAnimRef.current = null;
        }
      }

      if (zoomAnimRef.current) {
        zoom = {
          leftPct: s.currentLeft,
          widthPct: s.currentWidth,
          depth: s.depth,
          anchorLeft: s.anchorLeft,
          anchorWidth: s.anchorWidth,
        };
      }
    }

    // Hit test (always against current bars)
    const { x, y, active } = mouseRef.current;
    const canvasRect = canvas.getBoundingClientRect();
    const hit = active ? hitTest(bars, canvasRect, x, y, zoom) : null;

    // Highlight hovered component on the page
    if (hit !== hoveredRef.current) {
      if (hit) {
        highlightOnPage(hit.nodeId, hit.name);
      } else {
        hideHighlightOnPage();
      }
    }
    hoveredRef.current = hit;

    // Draw with commit transition
    const t = transitionRef.current;
    if (t && t.progress < 1) {
      t.progress = Math.min(1, t.progress + 0.05);
      const p = easeOut(t.progress);

      // Matched bars: interpolate positions + color
      const interpolated: FlatBar[] = t.matched.map((m) => {
        const toBlend = m.bar.didRender ? 1 : 0;
        return {
          ...m.bar,
          leftPct: m.fromLeft + (m.bar.leftPct - m.fromLeft) * p,
          widthPct: m.fromWidth + (m.bar.widthPct - m.fromWidth) * p,
          intensity:
            m.fromIntensity + (m.bar.intensity - m.fromIntensity) * p,
          colorBlend:
            m.fromColorBlend + (toBlend - m.fromColorBlend) * p,
        };
      });
      drawBars(ctx, interpolated, contentWidth, null, null);

      // Exiting bars: fade out at original positions
      if (t.exiting.length > 0) {
        ctx.globalAlpha = 1 - p;
        drawBars(ctx, t.exiting, contentWidth, null, null);
        ctx.globalAlpha = 1;
      }

      // Entering bars: fade in at target positions
      if (t.entering.length > 0) {
        ctx.globalAlpha = p;
        drawBars(ctx, t.entering, contentWidth, null, null);
        ctx.globalAlpha = 1;
      }

      if (t.progress >= 1) {
        transitionRef.current = null;
      }
    } else {
      drawBars(ctx, bars, contentWidth, hit, zoom);
    }

    // Tooltip
    const tip = tooltipRef.current;
    if (tip) {
      if (!hit) {
        tip.style.display = "none";
      } else {
        updateTooltipContent(tip, hit);
        tip.style.display = "";
        positionTooltip(tip, x, y);
      }
    }

    rafId.current = requestAnimationFrame(tick);
  }, [bars, totalHeight]);

  // Start/stop rAF loop
  useEffect(() => {
    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, [tick]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    mouseRef.current = { x: e.clientX, y: e.clientY, active: true };
  }, []);

  const onMouseLeave = useCallback(() => {
    mouseRef.current.active = false;
    if (tooltipRef.current) tooltipRef.current.style.display = "none";
    if (hoveredRef.current) {
      hoveredRef.current = null;
      hideHighlightOnPage();
    }
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const s = zoomAnimRef.current;

      const currentZoom: FlameZoom | null = s
        ? {
            leftPct: s.currentLeft,
            widthPct: s.currentWidth,
            depth: s.depth,
            anchorLeft: s.anchorLeft,
            anchorWidth: s.anchorWidth,
          }
        : null;

      const bar = hitTest(bars, rect, e.clientX, e.clientY, currentZoom);

      if (!bar) {
        // Click empty area → zoom out
        if (s) {
          zoomAnimRef.current = {
            ...s,
            targetLeft: 0,
            targetWidth: 100,
            depth: -1,
          };
        }
        onBarSelectRef.current?.(null);
        return;
      }

      // Click the currently zoomed anchor → zoom out
      if (
        s &&
        s.depth >= 0 &&
        bar.depth === s.depth &&
        Math.abs(bar.leftPct - s.anchorLeft) < 0.001 &&
        Math.abs(bar.widthPct - s.anchorWidth) < 0.001
      ) {
        zoomAnimRef.current = {
          ...s,
          targetLeft: 0,
          targetWidth: 100,
          depth: -1,
        };
        onBarSelectRef.current?.(null);
      } else {
        // Zoom into clicked bar
        const prev = zoomAnimRef.current;
        zoomAnimRef.current = {
          currentLeft: prev?.currentLeft ?? 0,
          currentWidth: prev?.currentWidth ?? 100,
          targetLeft: bar.leftPct,
          targetWidth: bar.widthPct,
          depth: bar.depth,
          anchorLeft: bar.leftPct,
          anchorWidth: bar.widthPct,
        };
        onBarSelectRef.current?.(bar);
      }
    },
    [bars],
  );

  // Expose imperative API for external zoom
  useImperativeHandle(
    ref,
    () => ({
      zoomToBar(nodeId: number) {
        const bar = bars.find((b) => b.nodeId === nodeId);
        if (!bar) return;

        onBarSelectRef.current?.(bar);

        const prev = zoomAnimRef.current;
        zoomAnimRef.current = {
          currentLeft: prev?.currentLeft ?? 0,
          currentWidth: prev?.currentWidth ?? 100,
          targetLeft: bar.leftPct,
          targetWidth: bar.widthPct,
          depth: bar.depth,
          anchorLeft: bar.leftPct,
          anchorWidth: bar.widthPct,
        };

        // Scroll the bar into view
        const el = containerRef.current?.closest(
          "[data-overlayscrollbars-viewport]",
        ) as HTMLElement | null;
        if (el) {
          const targetTop = bar.depth * ROW_HEIGHT;
          const viewH = el.clientHeight;
          if (targetTop < el.scrollTop || targetTop + ROW_HEIGHT > el.scrollTop + viewH) {
            el.scrollTop = Math.max(0, targetTop - viewH / 3);
          }
        }
      },
    }),
    [bars],
  );

  const canvasHeight = totalHeight + CANVAS_PAD * 2;

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      {bars.length > 0 && (
        <canvas
          ref={canvasRef}
          style={{ display: "block", height: `${canvasHeight}px`, width: "100%" }}
        />
      )}
    </div>
  );
});
