"use client";

import { useState, type ReactNode } from "react";

// ---------------------------------------------------------------------------
// Tabbed wrapper for the deep-analysis sections of /results.
//
// Server components are passed in as props (numbers, comps, stress, etc.) and
// the active tab toggles `display: none` on the others. This keeps the SSR
// payload intact for fast first paint and lets users deep-link without
// breaking the back button.
// ---------------------------------------------------------------------------

type Tab = {
  id: string;
  label: string;
  badge?: string;
  content: ReactNode;
};

export default function ResultsTabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  return (
    <div>
      <div
        role="tablist"
        aria-label="Deal analysis sections"
        className="sticky top-0 z-20 -mx-4 sm:-mx-6 mb-8 flex overflow-x-auto border-b border-zinc-800 bg-zinc-950/95 px-4 sm:px-6 backdrop-blur scrollbar-hide"
      >
        {tabs.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${t.id}`}
              id={`tab-${t.id}`}
              onClick={() => setActive(t.id)}
              className={`relative shrink-0 px-4 py-3 text-sm font-medium transition ${
                isActive
                  ? "text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <span className="flex items-center gap-2">
                {t.label}
                {t.badge && (
                  <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">
                    {t.badge}
                  </span>
                )}
              </span>
              {isActive && (
                <span
                  className="absolute inset-x-2 -bottom-px h-0.5"
                  style={{ backgroundColor: "var(--accent)" }}
                />
              )}
            </button>
          );
        })}
      </div>

      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`tabpanel-${t.id}`}
          aria-labelledby={`tab-${t.id}`}
          hidden={t.id !== active}
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
