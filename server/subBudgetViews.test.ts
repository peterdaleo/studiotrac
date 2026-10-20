import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({}),
  subBudgets: {
    list: { useQuery: mocks.list },
    status: { useQuery: mocks.status },
    create: { useMutation: () => ({ isPending: false }) },
    update: { useMutation: () => ({ isPending: false }) },
    delete: { useMutation: () => ({ isPending: false }) },
  },
} }));
import { ProjectSubBudgets } from "../client/src/components/ProjectSubBudgets";
import { SubBudgetStatusBar } from "../client/src/components/SubBudgetStatusBar";

const item = { id: 1, projectId: 7, name: "Lobby scope", phase: null, description: "Private scope notes", budgetCents: 1234500, actualCents: 987600, remainingCents: 246900, kind: "approved_addition" as const, status: "approved" as const };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockReturnValue({ data: { items: [item], originalBudgetCents: 5000000, approvedAdditionsCents: item.budgetCents, approvedBudgetCents: 6234500 } });
  mocks.status.mockReturnValue({ data: [{ id: 1, name: item.name, status: "approved", health: "watch_budget" }] });
});

describe("sub-budget role views", () => {
  it("mounts only the safe status query for staff, without financial details, edit controls, tooltips, or numeric labels", () => {
    const html = renderToStaticMarkup(React.createElement(ProjectSubBudgets, { projectId: 7, canViewFinancials: false }));
    expect(mocks.status).toHaveBeenCalledWith({ projectId: 7 });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(html).toContain("Lobby scope");
    expect(html).toContain("approved");
    expect(html).toContain("Watch budget");
    expect(html).toContain("bg-amber-400");
    expect(html).not.toMatch(/\$|consumed|Remaining|Budget amount|Add Sub-Budget|Edit Lobby|Delete Lobby|tooltip|Private scope notes|aria-valuenow/);
    expect(html).not.toMatch(/>\s*\d+%/);
    expect(html).toContain("width:75%"); // Categorical watch band, not the actual 80%.
    expect(html).not.toContain("80%");
  });

  it("retains financial figures and editing controls for PM/admin views", () => {
    const html = renderToStaticMarkup(React.createElement(ProjectSubBudgets, { projectId: 7, canViewFinancials: true }));
    expect(mocks.list).toHaveBeenCalledWith({ projectId: 7 });
    expect(mocks.status).not.toHaveBeenCalled();
    expect(html).toContain("$12,345.00");
    expect(html).toContain("$9,876.00");
    expect(html).toContain("80% consumed");
    expect(html).toContain("Add Sub-Budget");
    expect(html).toContain('aria-label="Edit Lobby scope"');
  });

  it("keeps proposed and zero-dollar bars neutral without invalid percentages", () => {
    for (const health of ["proposed", "no_budget"] as const) {
      const html = renderToStaticMarkup(React.createElement(SubBudgetStatusBar, { health, financials: { budgetCents: 0, actualCents: 500 } }));
      expect(html).toContain("width:0%");
      expect(html).not.toMatch(/NaN|Infinity|consumed/);
    }
  });

  it("caps the visual fill but preserves the real over-budget percentage for financial viewers", () => {
    const html = renderToStaticMarkup(React.createElement(SubBudgetStatusBar, { health: "over_budget", financials: { budgetCents: 10000, actualCents: 12500 } }));
    expect(html).toContain("125% consumed");
    expect(html).toContain("width:100%");
    expect(html).toContain("bg-red-500");
  });
});
