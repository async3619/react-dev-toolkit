import { useState, type ReactNode } from "react";

interface SidebarSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function SidebarSection({ title, defaultOpen = true, children }: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-gray-700">
      <button
        type="button"
        className="flex items-center gap-1 w-full px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide hover:bg-gray-800 cursor-pointer focus:outline-none"
        onClick={() => setOpen(!open)}
      >
        <span className="text-gray-500">{open ? "▾" : "▸"}</span>
        {title}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}
