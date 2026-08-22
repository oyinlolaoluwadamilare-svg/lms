"use client";

import { useState, type ReactNode } from "react";

// docs/06-ui-spec.md's Account 360 section names actual "Tabs" (not sections stacked vertically the
// way the deal detail page's read-only skeleton uses) - this codebase has no tab primitive yet, but
// unlike the "don't build a dropdown menu for two buttons" restraint this codebase applies
// elsewhere, a real spec line asking for tabs justifies building the minimal one needed here, not
// stacking four sections and calling it close enough. Each tab's content is pre-rendered server-side
// and passed in as a plain node - this component only ever toggles which one is visible, it never
// fetches or re-renders anything itself.
export function AccountTabs({ tabs }: { tabs: Array<{ label: string; content: ReactNode }> }) {
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex flex-wrap gap-1.5 border-b border-line">
        {tabs.map((tab, index) => (
          <button
            key={tab.label}
            type="button"
            role="tab"
            aria-selected={index === activeIndex}
            onClick={() => setActiveIndex(index)}
            className={`rounded-t-token border-b-2 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              index === activeIndex ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{tabs[activeIndex]?.content}</div>
    </div>
  );
}
