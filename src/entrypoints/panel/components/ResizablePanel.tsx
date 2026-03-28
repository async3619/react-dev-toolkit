import { useState, useRef, useCallback, type ReactNode, type MouseEvent as ReactMouseEvent } from "react";

interface ResizablePanelProps {
  left: ReactNode;
  right: ReactNode;
  defaultWidth?: number;
  minWidth?: number;
}

export function ResizablePanel({ left, right, defaultWidth = 288, minWidth = 150 }: ResizablePanelProps) {
  const [width, setWidth] = useState(defaultWidth);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const handleDragStart = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const onMove = (ev: globalThis.MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newWidth = Math.max(minWidth, Math.min(rect.width - 200, rect.right - ev.clientX));
      setWidth(newWidth);
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [minWidth]);

  return (
    <div ref={containerRef} className="flex flex-1 min-h-0">
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {left}
      </div>
      <div
        className="w-1 shrink-0 cursor-col-resize bg-gray-700 hover:bg-blue-500 active:bg-blue-500 transition-colors"
        onMouseDown={handleDragStart}
      />
      <div className="overflow-auto shrink-0" style={{ width: `${width}px` }}>
        {right}
      </div>
    </div>
  );
}
