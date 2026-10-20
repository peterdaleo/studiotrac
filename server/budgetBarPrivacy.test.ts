import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BudgetBar } from "../client/src/components/BudgetBar";
import { evaluateBudgetHealth } from "../shared/billing";

describe("project budget-bar role privacy", () => {
  for (const compact of [false, true]) {
    it(`keeps fixed-fee staff bars categorical (compact=${compact})`, () => {
      const health = evaluateBudgetHealth({ billingType: "fixed_fee", contractedFee: 1_000_000, laborCost: 820_000, consultantCost: 0 });
      const html = renderToStaticMarkup(React.createElement(BudgetBar, { contractedFee: 1_000_000, totalCost: 820_000, budgetHealth: health, isAdmin: false, compact }));
      expect(html).toContain("Watch budget");
      expect(html).toContain("width:75%");
      expect(html).not.toMatch(/\$|82%|consumed|remaining|tooltip|aria-valuenow/);
      expect(html).not.toMatch(/>[^<]*\d+(?:\.\d+)?%/);
    });
    it(`keeps hourly staff bars categorical (compact=${compact})`, () => {
      const health = evaluateBudgetHealth({ billingType: "hourly", contractedFee: 0, notToExceedCents: 1_000_000, laborCost: 820_000, billableLaborCost: 700_000, consultantCost: 0, totalMinutes: 500, billableMinutes: 400 });
      const html = renderToStaticMarkup(React.createElement(BudgetBar, { contractedFee: 0, totalCost: 820_000, budgetHealth: health, isAdmin: false, compact }));
      expect(html).toContain("Hourly billing — watch NTE");
      expect(html).toContain("width:75%");
      expect(html).not.toMatch(/\$|82%|billable|Margin|logged|tooltip|aria-valuenow/);
    });
  }
  it("retains PM/admin exact financial details", () => {
    const health = evaluateBudgetHealth({ billingType: "fixed_fee", contractedFee: 1_000_000, laborCost: 820_000, consultantCost: 0 });
    const html = renderToStaticMarkup(React.createElement(BudgetBar, { contractedFee: 1_000_000, totalCost: 820_000, budgetHealth: health, isAdmin: true }));
    expect(html).toContain("82% consumed");
    expect(html).toContain("$8,200");
    expect(html).toContain("$10,000");
    expect(html).toContain("width:82%");
  });
  it("separates uncapped extra costs from the fixed-budget numerator", () => {
    const health = evaluateBudgetHealth({ billingType: "fixed_fee", contractedFee: 1_000_000, laborCost: 920_000, consultantCost: 0, budgetCostCents: 700_000 });
    const html = renderToStaticMarkup(React.createElement(BudgetBar, { contractedFee: 1_000_000, totalCost: 920_000, budgetHealth: health, isAdmin: true }));
    expect(health.costCents).toBe(920_000);
    expect(html).toContain("70% consumed");
    expect(html).toContain("$7,000");
    expect(html).toContain("$3,000 remaining");
    expect(html).toContain("Outside capped budget: $2,200 cost, tracked separately.");
    expect(html).not.toContain("92% consumed");
  });
});
