import { useState } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { TabBar } from "./components/TabBar";
import { ComponentsTab } from "./components/ComponentsTab";
import { ProfilerTab } from "./components/ProfilerTab";

const TABS = ["Components", "Profiler"] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("Components");

  return (
    <TooltipPrimitive.Provider delayDuration={300}>
      <div className="h-screen flex flex-col bg-gray-900 text-gray-100">
        <header className="flex items-center border-b border-gray-700 shrink-0">
          <TabBar tabs={TABS} activeTab={activeTab} onTabChange={(t) => setActiveTab(t as Tab)} />
        </header>

        <main className="flex flex-col flex-1 min-h-0">
          {activeTab === "Components" && <ComponentsTab />}
          {activeTab === "Profiler" && <ProfilerTab />}
        </main>
      </div>
    </TooltipPrimitive.Provider>
  )
}
