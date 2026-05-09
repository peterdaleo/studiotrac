/**
 * BudgetBar — shows budget consumed vs remaining as a colored progress bar.
 *
 * Admins see the full breakdown with dollar amounts.
 * Non-admins see only the bar, a health label, and the consumed percentage —
 * no dollar figures are ever exposed to staff.
 */
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function getHealthColor(pct: number): {
  bar: string;
  label: string;
  text: string;
  badge: string;
} {
  if (pct > 100) {
    return {
      bar: "bg-red-500",
      label: "Over budget",
      text: "text-red-600",
      badge: "bg-red-50 text-red-700 border-red-200",
    };
  }
  if (pct >= 90) {
    return {
      bar: "bg-orange-500",
      label: "Near limit",
      text: "text-orange-600",
      badge: "bg-orange-50 text-orange-700 border-orange-200",
    };
  }
  if (pct >= 75) {
    return {
      bar: "bg-amber-400",
      label: "Watch budget",
      text: "text-amber-600",
      badge: "bg-amber-50 text-amber-700 border-amber-200",
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
}: BudgetBarProps) {
  // If no budget has been set, render a neutral placeholder
  if (contractedFee <= 0) {
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

  const pct = Math.round((totalCost / contractedFee) * 100);
  const barWidth = Math.min(pct, 100); // cap visual bar at 100%
  const remaining = contractedFee - totalCost;
  const health = getHealthColor(pct);

  if (compact) {
    // ── Compact (project card / list row) ──────────────────────────
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
              {pct}%
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[200px]">
          {isAdmin ? (
            <div className="space-y-0.5">
              <p className="font-semibold">{health.label}</p>
              <p>Budget: {formatCurrency(contractedFee)}</p>
              <p>Consumed: {formatCurrency(totalCost)} ({pct}%)</p>
              <p className={remaining < 0 ? "text-red-400" : ""}>
                {remaining >= 0 ? `Remaining: ${formatCurrency(remaining)}` : `Over by: ${formatCurrency(-remaining)}`}
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              <p className="font-semibold">{health.label}</p>
              <p>{pct}% of budget consumed</p>
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  // ── Full (project detail sidebar) ──────────────────────────────
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground font-medium">Budget</span>
        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${health.badge}`}>
          {health.label}
        </span>
      </div>

      {/* Bar */}
      <div className="relative h-2.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${health.bar}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      {/* Labels row */}
      <div className="flex items-center justify-between text-xs">
        <span className={`font-semibold ${health.text}`}>{pct}% consumed</span>
        {isAdmin && (
          <span className="text-muted-foreground">
            {formatCurrency(totalCost)} / {formatCurrency(contractedFee)}
          </span>
        )}
      </div>

      {/* Admin-only detail line */}
      {isAdmin && (
        <p className={`text-xs ${remaining >= 0 ? "text-muted-foreground" : "text-red-600 font-medium"}`}>
          {remaining >= 0
            ? `${formatCurrency(remaining)} remaining`
            : `${formatCurrency(-remaining)} over budget`}
        </p>
      )}
    </div>
  );
}
