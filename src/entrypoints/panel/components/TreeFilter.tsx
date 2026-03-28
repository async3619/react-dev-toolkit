import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Crosshair, ListFilter } from "lucide-react";

interface TreeFilterProps {
  value: string
  onChange: (value: string) => void
  inspecting: boolean
  onToggleInspect: () => void
  firstPartyOnly: boolean
  onFirstPartyOnlyChange: (value: boolean) => void
}

export function TreeFilter({
  value,
  onChange,
  inspecting,
  onToggleInspect,
  firstPartyOnly,
  onFirstPartyOnlyChange,
}: TreeFilterProps) {
  return (
    <div className="flex items-center border-b border-gray-700 shrink-0">
      <button
        type="button"
        onClick={onToggleInspect}
        title="Click to inspect an element on the page"
        className={`px-2 py-1.5 text-sm shrink-0 cursor-pointer focus:outline-none border-r border-gray-700 ${
          inspecting
            ? 'text-blue-400 bg-blue-500/10'
            : 'text-gray-500 hover:text-gray-300'
        }`}
      >
        <Crosshair size={14} />
      </button>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter components..."
        className="flex-1 px-3 py-1.5 text-xs bg-transparent border-none focus:outline-none placeholder-gray-500"
      />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            title="Filter options"
            className={`px-2 py-1.5 text-sm shrink-0 cursor-pointer focus:outline-none border-l border-gray-700 ${
              firstPartyOnly
                ? "text-blue-400 bg-blue-500/10"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            <ListFilter size={14} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-1 min-w-[180px] z-50"
          >
            <DropdownMenu.CheckboxItem
              checked={firstPartyOnly}
              onCheckedChange={(checked) => onFirstPartyOnlyChange(checked === true)}
              className="flex items-center gap-2 px-2 py-1.5 text-xs text-gray-300 rounded cursor-pointer hover:bg-gray-700 focus:outline-none select-none"
            >
              <DropdownMenu.ItemIndicator>
                <Check size={12} />
              </DropdownMenu.ItemIndicator>
              <span className={firstPartyOnly ? "" : "pl-4"}>First-party only</span>
            </DropdownMenu.CheckboxItem>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}
