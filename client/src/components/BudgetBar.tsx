/**
 * BudgetBar — shows budget consumed vs remaining as a colored progress bar.
 *
 * Admins see the full breakdown with dollar amounts.
 * Staff see only a categorical bar and health label: no dollars, exact
 * percentages, financial tooltips, or exact financial fill widths.
 *
 * Hourly / time-and-materials projects never render as "Over budget" just
 * because costs exist. They use a neutral hourly status unless an optional
 * not-to-exceed cap has been enabled as a planning alert.
 */
import React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BudgetHealth, BudgetStatusKind } from "@shared/billing";

interface BudgetBarProps {
  /** Total contracted fee in cents. 0 means "not set". */
  contractedFee: number;
  /** Total cost consumed so far (labor + consultants) in cents. */
  totalCost: number;
  /** Whether the current user is an admin (or PM). */
  isAdmin: boolean;
  /** Optional extra className for the outer wrapper. */
  className?: string;
  /** Compact mode — used in list/card views where vertical space is tight. */
  compact?: boolean;
  /** Precomputed health from the server. Preferred over local fee/cost math. */
  budgetHealth?: BudgetHealth | null;
  /** Current billing type, used only when budgetHealth is unavailable. */
  billingType?: string | null;
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatHours(hours: number): string {
  return `${hours.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}h`;
}

function getHealthColor(kind: BudgetStatusKind): {
  bar: string;
  label: string;
  text: string;
  badge: string;
} {
  if (kind === "over_budget") {
    return {
      bar: "bg-red-500",
      label: "Over budget",
      text: "text-red-600",
      badge: "bg-red-50 text-red-700 border-red-200",
    };
  }
  if (kind === "hourly_above_nte") {
    return {
      bar: "bg-amber-500",
      label: "Hourly billing — above NTE",
      text: "text-amber-700",
      badge: "bg-amber-50 text-amber-700 border-amber-200",
    };
  }
  if (kind === "near_limit" || kind === "hourly_approaching_nte") {
    return {
      bar: "bg-orange-500",
      label: kind === "hourly_approaching_nte" ? "Hourly billing — approaching NTE" : "Near limit",
      text: "text-orange-600",
      badge: "bg-orange-50 text-orange-700 border-orange-200",
    };
  }
  if (kind === "watch_budget" || kind === "hourly_watch_nte") {
    return {
      bar: "bg-amber-400",
      label: kind === "hourly_watch_nte" ? "Hourly billing — watch NTE" : "Watch budget",
      text: "text-amber-600",
      badge: "bg-amber-50 text-amber-700 border-amber-200",
    };
  }
  if (kind === "hourly_no_budget") {
    return {
      bar: "bg-sky-500",
      label: "Hourly billing — no fixed budget",
      text: "text-sky-700",
      badge: "bg-sky-50 text-sky-700 border-sky-200",
    };
  }
  if (kind === "hourly_within_nte") {
    return {
      bar: "bg-sky-500",
      label: "Hourly billing — within NTE",
      text: "text-sky-700",
      badge: "bg-sky-50 text-sky-700 border-sky-200",
    };
  }
  if (kind === "no_budget") {
    return {
      bar: "bg-muted-foreground/20",
      label: "No budget set",
      text: "text-muted-foreground",
      badge: "bg-muted text-muted-foreground border-border",
    };
  }
  return {
    bar: "bg-emerald-500",
    label: "On budget",
    text: "text-emerald-600",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
}

export function BudgetBar({
  contractedFee,
  totalCost,
  isAdmin,
  className = "",
  compact = false,
  budgetHealth,
  billingType,
}: BudgetBarProps) {
  const currentType = budgetHealth?.currentBillingType
    ?? (billingType === "hourly" || billingType === "fixed_fee" ? billingType : undefined);
  const fallbackKind: BudgetStatusKind = currentType === "hourly"
    ? "hourly_no_budget"
    : contractedFee <= 0
      ? "no_budget"
      : totalCost > contractedFee
        ? "over_budget"
        : "on_budget";
  const kind: BudgetStatusKind = budgetHealth?.statusKind ?? fallbackKind;
  const health = getHealthColor(kind);
  const label = budgetHealth?.statusLabel ?? health.label;
  const isHourly = currentType === "hourly" || kind.startsWith("hourly_");
  const usesFixedBudget = budgetHealth ? budgetHealth.usesFixedBudget : (currentType !== "hourly" && contractedFee > 0);
  const pct = budgetHealth?.consumedPercent ?? (usesFixedBudget && contractedFee > 0 ? Math.round((totalCost / contractedFee) * 100) : null);
  const remaining = budgetHealth?.remainingCents ?? (usesFixedBudget && contractedFee > 0 ? contractedFee - totalCost : null);
  const cost = budgetHealth?.costCents ?? totalCost;
  const budgetCost = budgetHealth?.budgetCostCents ?? cost;
  const displayPct = pct ?? 0;
  const barWidth = usesFixedBudget || (isHourly && pct !== null)
    ? Math.min(Math.max(displayPct, 0), 100)
    : isHourly && cost > 0
      ? 28
      : 0;

  if (!isAdmin) {
    const categoricalWidth = kind === "over_budget" || kind === "hourly_above_nte" ? 100
      : kind === "near_limit" || kind === "hourly_approaching_nte" ? 90
      : kind === "watch_budget" || kind === "hourly_watch_nte" ? 75
      : kind === "no_budget" ? 0
      : kind === "hourly_no_budget" ? 28 : 35;
    return (
      <div className={`space-y-1.5 ${className}`}>
        <span className={`${compact ? "text-[10px]" : "text-xs"} font-medium ${health.text}`}>{label}</span>
        <div role="img" aria-label={`Project budget status: ${label}`} className={`${compact ? "h-1.5" : "h-2.5"} rounded-full bg-muted overflow-hidden`}>
          <div className={`h-full rounded-full ${health.bar}`} style={{ width: `${categoricalWidth}%` }} />
        </div>
        {budgetHealth?.fixedFeeHealth && <p className="text-xs text-muted-foreground">Closed fixed-fee phase: {budgetHealth.fixedFeeHealth.statusLabel}</p>}
      </div>
    );
  }

  if (!usesFixedBudget && !isHourly && contractedFee <= 0) {
    if (compact) {
      return (
        <div className={`flex items-center gap-2 ${className}`}>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full w-0 bg-muted-foreground/20 rounded-full" />
          </div>
          <span className="text-[10px] text-muted-foreground/50 whitespace-nowrap">
            {isAdmin ? "No budget set" : "—"}
          </span>
        </div>
      );
    }
    return (
      <div className={`space-y-1.5 ${className}`}>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Budget</span>
          <span className="text-muted-foreground/60 text-[11px]">
            {isAdmin ? "No budget set" : "—"}
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div className="h-full w-0" />
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`flex items-center gap-2 cursor-default ${className}`}>
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${health.bar}`}
                style={{ width: `${barWidth}%` }}
              />
            </div>
            <span className={`text-[10px] font-mono whitespace-nowrap ${health.text}`}>
              {isHourly && pct === null
                ? (isAdmin ? formatHours(budgetHealth?.totalHours ?? 0) : "T&M")
                : `${displayPct}%`}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[240px]">
          <div className="space-y-0.5">
            <p className="font-semibold">{label}</p>
            {isHourly ? (
              <>
                <p>{formatHours(budgetHealth?.totalHours ?? 0)} logged · {formatHours(budgetHealth?.billableHours ?? 0)} billable</p>
                {isAdmin && (
                  <>
                    <p>Cost: {formatCurrency(cost)}</p>
                    <p>Billable value: {formatCurrency(budgetHealth?.billableValueCents ?? 0)}</p>
                    <p>Margin: {formatCurrency(budgetHealth?.marginCents ?? 0)}</p>
                  </>
                )}
                {budgetHealth?.fixedFeeHealth && (
                  <p>Closed fixed-fee phase: {budgetHealth.fixedFeeHealth.statusLabel}</p>
                )}
              </>
            ) : isAdmin ? (
              <>
                <p>Budget: {formatCurrency(contractedFee)}</p>
                <p>Consumed: {formatCurrency(budgetCost)} ({displayPct}%)</p>
                <p className={(remaining ?? 0) < 0 ? "text-red-400" : ""}>
                  {(remaining ?? 0) >= 0
                    ? `Remaining: ${formatCurrency(remaining ?? 0)}`
                    : `Over by: ${formatCurrency(-(remaining ?? 0))}`}
                </p>
              </>
            ) : (
              <p>{displayPct}% of budget consumed</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground font-medium">{isHourly ? "Hourly billing" : "Budget"}</span>
        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${health.badge}`}>
          {label}
        </span>
      </div>

      <div className="relative h-2.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${health.bar}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      {isHourly ? (
        <>
          <div className="flex items-center justify-between text-xs">
            <span className={`font-semibold ${health.text}`}>
              {formatHours(budgetHealth?.totalHours ?? 0)} logged
            </span>
            {isAdmin && (
              <span className="text-muted-foreground">
                {formatCurrency(cost)} cost
              </span>
            )}
          </div>
          {isAdmin && (
            <div className="space-y-0.5 text-xs text-muted-foreground">
              <p>{formatHours(budgetHealth?.billableHours ?? 0)} billable · {formatCurrency(budgetHealth?.billableValueCents ?? 0)} value</p>
              <p className={(budgetHealth?.marginCents ?? 0) < 0 ? "text-red-600 font-medium" : ""}>
                Margin {formatCurrency(budgetHealth?.marginCents ?? 0)}
              </p>
              {pct !== null && remaining !== null && (
                <p className={health.text}>
                  {displayPct}% of optional NTE · {(remaining ?? 0) >= 0
                    ? `${formatCurrency(remaining ?? 0)} remaining`
                    : `${formatCurrency(-(remaining ?? 0))} above NTE`}
                </p>
              )}
            </div>
          )}
          {budgetHealth?.fixedFeeHealth && (
            <p className="text-xs text-muted-foreground">
              Closed fixed-fee phase: {budgetHealth.fixedFeeHealth.statusLabel}
              {isAdmin ? ` · ${formatCurrency(budgetHealth.fixedFeeHealth.totalCost)} of ${formatCurrency(budgetHealth.fixedFeeHealth.contractedFee)}` : ""}
            </p>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs">
            <span className={`font-semibold ${health.text}`}>{displayPct}% consumed</span>
            {isAdmin && (
              <span className="text-muted-foreground">
                {formatCurrency(budgetCost)} / {formatCurrency(contractedFee)}
              </span>
            )}
          </div>
          {isAdmin && remaining !== null && (
            <p className={`text-xs ${remaining >= 0 ? "text-muted-foreground" : "text-red-600 font-medium"}`}>
              {remaining >= 0
                ? `${formatCurrency(remaining)} remaining`
                : `${formatCurrency(-remaining)} over budget`}
            </p>
          )}
          {isAdmin && cost !== budgetCost && <p className="text-xs text-muted-foreground">Outside capped budget: {formatCurrency(cost - budgetCost)} cost, tracked separately.</p>}
        </>
      )}
    </div>
  );
}
