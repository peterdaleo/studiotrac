import { trpc } from "@/lib/trpc";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getPhaseLabel, type ProjectPhase } from "@shared/constants";

type TimeSubBudgetSelectProps = {
  projectId: number | null;
  value: number | null;
  onChange: (value: number | null) => void;
  compact?: boolean;
};

/** Assign time to a project sub-budget without exposing any financial data. */
export function TimeSubBudgetSelect({
  projectId,
  value,
  onChange,
  compact = false,
}: TimeSubBudgetSelectProps) {
  const options = trpc.subBudgets.options.useQuery(
    { projectId: projectId ?? 0 },
    { enabled: projectId !== null && projectId > 0, staleTime: 30_000 }
  );

  return (
    <div className="min-w-0">
      <Label className={compact ? "text-xs" : undefined}>Sub-budget / ASR (optional)</Label>
      <Select
        value={value === null ? "unassigned" : String(value)}
        onValueChange={next =>
          onChange(next === "unassigned" ? null : Number(next))
        }
        disabled={!projectId || options.isLoading || !options.data?.length}
      >
        <SelectTrigger className={compact ? "h-8 text-xs" : undefined}>
          <SelectValue
            placeholder={
              !projectId
                ? "Select a project first"
                : options.isLoading
                  ? "Loading sub-budgets…"
                  : "Unassigned"
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {options.data?.map(option => (
            <SelectItem key={option.id} value={String(option.id)}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{option.name}</span>
                {option.phase && (
                  <span className="text-xs text-muted-foreground">
                    {getPhaseLabel(option.phase as ProjectPhase)}
                  </span>
                )}
                {option.status && (
                  <span className="text-xs text-muted-foreground">
                    {option.status}
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-1 text-xs text-muted-foreground">
        Unassigned time still counts toward the overall project budget.
      </p>
      {projectId && options.error && (
        <div className="mt-1 flex items-center gap-2 text-xs text-destructive">
          <span>Could not load sub-budgets: {options.error.message}</span>
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => options.refetch()}
          >
            Retry
          </button>
        </div>
      )}
      {projectId &&
        !options.isLoading &&
        !options.error &&
        options.data?.length === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            No sub-budgets for this project.
          </p>
        )}
    </div>
  );
}
