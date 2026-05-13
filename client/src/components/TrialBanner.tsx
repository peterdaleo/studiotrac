import { useLocation } from "wouter";
import { Clock, X } from "lucide-react";
import { useState } from "react";

interface TrialBannerProps {
  daysLeft: number;
}

export default function TrialBanner({ daysLeft }: TrialBannerProps) {
  const [, setLocation] = useLocation();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const isUrgent = daysLeft <= 3;
  const isWarning = daysLeft <= 7;

  const bannerClass = isUrgent
    ? "bg-red-50 border-red-200 text-red-800"
    : isWarning
    ? "bg-amber-50 border-amber-200 text-amber-800"
    : "bg-blue-50 border-blue-200 text-blue-800";

  const iconClass = isUrgent
    ? "text-red-500"
    : isWarning
    ? "text-amber-500"
    : "text-blue-500";

  const daysText =
    daysLeft === 0
      ? "Your trial expires today"
      : daysLeft === 1
      ? "1 day left in your free trial"
      : `${daysLeft} days left in your free trial`;

  return (
    <div
      className={`border-b px-4 py-2 flex items-center justify-between text-sm ${bannerClass}`}
    >
      <div className="flex items-center gap-2">
        <Clock className={`h-3.5 w-3.5 shrink-0 ${iconClass}`} />
        <span className="font-medium">{daysText}.</span>
        <span className="hidden sm:inline opacity-80">
          Subscribe now to keep your data and continue working.
        </span>
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-4">
        <button
          onClick={() => setLocation("/billing")}
          className="font-semibold underline underline-offset-2 hover:opacity-70 transition-opacity text-xs"
        >
          Subscribe →
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="opacity-50 hover:opacity-80 transition-opacity"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
