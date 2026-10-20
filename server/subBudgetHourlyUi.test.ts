import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({}),
    subBudgets: {
      list: { useQuery: mocks.list },
      status: { useQuery: mocks.status },
      create: { useMutation: () => ({ isPending: false }) },
      update: { useMutation: () => ({ isPending: false }) },
      delete: { useMutation: () => ({ isPending: false }) },
    },
  },
}));

import { ProjectSubBudgets } from "../client/src/components/ProjectSubBudgets";

const hourlyItem = {
  id: 2,
  projectId: 7,
  name: "Hourly design review",
  phase: "schematic_design" as const,
  description: "Hourly work, capped addition",
  budgetCents: 0,
  kind: "approved_addition" as const,
  trackingMode: "hourly" as const,
  notToExceedCents: 100_000,
  status: "approved" as const,
  actualCents: 90_000,
  remainingCents: 10_000,
  totalMinutes: 180,
  billableMinutes: 150,
  laborCostCents: 66_000,
  billableValueCents: 95_000,
  consultantCostCents: 2_500,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockReturnValue({
    data: {
      items: [hourlyItem],
      originalBudgetCents: 500_000,
      approvedAdditionsCents: hourlyItem.notToExceedCents,
      approvedBudgetCents: 600_000,
    },
  });
  mocks.status.mockReturnValue({
    data: [
      {
        id: hourlyItem.id,
        name: hourlyItem.name,
        status: hourlyItem.status,
        health: "hourly_approaching_nte",
      },
    ],
  });
});

describe("hourly sub-budget UI", () => {
  it("shows accrued hours, billable value, labor cost, consultant cost, and NTE distinctly to financial viewers", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectSubBudgets, {
        projectId: 7,
        canViewFinancials: true,
        billingType: "hourly",
        notToExceedCents: 500_000,
      })
    );

    expect(mocks.list).toHaveBeenCalledWith({ projectId: 7 });
    expect(html).toContain("Hourly");
    expect(html).toContain("Hours logged");
    expect(html).toContain("3 h");
    expect(html).toContain("Billable hours");
    expect(html).toContain("2.5 h");
    expect(html).toContain("Client billable value");
    expect(html).toContain("$950.00");
    expect(html).toContain("Labor cost");
    expect(html).toContain("$660.00");
    expect(html).toContain("Consultant cost");
    expect(html).toContain("$25.00");
    expect(html).toContain("Not-to-exceed");
    expect(html).toContain("Approaching hourly NTE");
    expect(html).not.toContain("90% consumed");
  });

  it("keeps hourly category bars and labels safe in staff view, with no exact financial data", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectSubBudgets, {
        projectId: 7,
        canViewFinancials: false,
      })
    );

    expect(mocks.status).toHaveBeenCalledWith({ projectId: 7 });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(html).toContain("Hourly design review");
    expect(html).toContain("Approaching hourly NTE");
    expect(html).toContain("width:90%"); // Fixed categorical band, not actual NTE consumption.
    expect(html).not.toMatch(/\$|consumed|95,000|66,000|2\.5 h|aria-valuenow/);
    expect(html).not.toContain("90% consumed");
  });

  it("keeps the editor free of a status selector/action and omits status from update payloads", () => {
    const source = readFileSync(
      new URL(
        "../client/src/components/ProjectSubBudgets.tsx",
        import.meta.url
      ),
      "utf8"
    );
    const payload =
      source.match(/const payload = \{([\s\S]*?)\n    \};/)?.[1] ?? "";

    expect(source).toContain(
      '<SelectItem value="fixed_amount">Fixed amount</SelectItem>'
    );
    expect(source).toContain('<SelectItem value="hourly">Hourly</SelectItem>');
    expect(source).toContain("Not-to-exceed cap ($, optional)");
    expect(source).not.toContain("<Label>Status</Label>");
    expect(source).not.toMatch(/<Button[^>]*>Approve/);
    expect(payload).not.toMatch(/\bstatus\s*:/);
    expect(source.replace(/\s+/g, " ")).toContain(
      "Legacy proposed item — excluded from approved totals. Editing will not change its status."
    );
  });
});
