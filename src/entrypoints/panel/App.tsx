import { useState } from "react";
import { TabBar } from "./components/TabBar";
import { ComponentsTab } from "./components/ComponentsTab";

const TABS = ["Components"] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("Components");

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-gray-100">
      <header className="flex items-center border-b border-gray-700 shrink-0">
        <TabBar tabs={TABS} activeTab={activeTab} onTabChange={(t) => setActiveTab(t as Tab)} />
      </header>

      <main className="flex flex-col flex-1 min-h-0">
        {activeTab === "Components" && <ComponentsTab />}
      </main>
    </div>
  )
}
