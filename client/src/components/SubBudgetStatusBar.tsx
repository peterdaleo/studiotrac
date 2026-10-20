import React from "react";
import type { SubBudgetHealth } from "@shared/subBudgets";

const appearances: Record<SubBudgetHealth, { label: string; color: string; text: string; width: number }> = {
  proposed: { label: "Proposed — not approved", color: "bg-muted-foreground/30", text: "text-muted-foreground", width: 0 },
  no_budget: { label: "No budget set", color: "bg-muted-foreground/20", text: "text-muted-foreground", width: 0 },
  on_budget: { label: "On budget", color: "bg-emerald-500", text: "text-emerald-600", width: 35 },
  watch_budget: { label: "Watch budget", color: "bg-amber-400", text: "text-amber-600", width: 75 },
  near_limit: { label: "Near limit", color: "bg-orange-500", text: "text-orange-600", width: 90 },
  over_budget: { label: "Over budget", color: "bg-red-500", text: "text-red-600", width: 100 },
};

export function SubBudgetStatusBar({ health, financials }: {
  health: SubBudgetHealth;
  financials?: { budgetCents: number; actualCents: number };
}) {
  const appearance = appearances[health];
  const percent = financials && financials.budgetCents > 0 && health !== "proposed"
    ? Math.round(financials.actualCents / financials.budgetCents * 100)
    : null;
  // Team views use categorical widths, not a hidden exact financial percentage.
  const width = percent === null ? appearance.width : Math.min(Math.max(percent, 0), 100);
  return (
    <div className="space-y-1.5">
      <div className={`flex flex-wrap items-center justify-between gap-2 text-xs ${appearance.text}`}>
        <span className="font-medium">{appearance.label}</span>
        {percent !== null && <span>{percent}% consumed</span>}
      </div>
      <div role="img" aria-label={`Sub-budget status: ${appearance.label}`} className="h-2.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${appearance.color}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
