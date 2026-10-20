import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ options: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: { subBudgets: { options: { useQuery: mocks.options } } },
}));

import { TimeSubBudgetSelect } from "../client/src/components/TimeSubBudgetSelect";

const helper = "Unassigned time still counts toward the overall project budget.";
const budgetOptions = [
  {
    id: 17,
    projectId: 7,
    name: "Lobby scope",
    phase: "construction",
    status: "approved",
    budgetCents: 1234567,
    actualCents: 765432,
    remainingCents: 469135,
    description: "Confidential internal scope notes",
    privateNotes: "Never display this private note",
  },
];

function renderSelect(props: Partial<React.ComponentProps<typeof TimeSubBudgetSelect>> = {}) {
  return renderToStaticMarkup(
    React.createElement(TimeSubBudgetSelect, {
      projectId: 7,
      value: null,
      onChange: vi.fn(),
      ...props,
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  mocks.options.mockReturnValue({ data: budgetOptions, isLoading: false, error: null });
});

describe("TimeSubBudgetSelect", () => {
  it("shows the label and helper in standard and compact layouts", () => {
    const standard = renderSelect();
    const compact = renderSelect({ compact: true });

    for (const html of [standard, compact]) {
      expect(html).toContain("Sub-budget / ASR (optional)");
      expect(html).toContain(helper);
    }
    expect(standard).not.toMatch(/<label[^>]*class="[^"]*text-xs/);
    expect(compact).toMatch(/<label[^>]*class="[^"]*text-xs/);
    expect(compact).toMatch(/h-8 text-xs/);
  });

  it("disables selection until a project is selected", () => {
    const html = renderSelect({ projectId: null });

    expect(mocks.options).toHaveBeenCalledWith(
      { projectId: 0 },
      { enabled: false, staleTime: 30_000 }
    );
    expect(html).toMatch(/<button[^>]*\sdisabled(?:=|\s|>)/);
    expect(html).toContain(helper);
  });

  it("disables selection and shows the existing empty state when there are no options", () => {
    mocks.options.mockReturnValue({ data: [], isLoading: false, error: null });
    const html = renderSelect();

    expect(html).toMatch(/<button[^>]*\sdisabled(?:=|\s|>)/);
    expect(html).toContain("No sub-budgets for this project.");
    expect(html).toContain(helper);
  });

  it("enables selection when options are available", () => {
    const html = renderSelect();

    expect(mocks.options).toHaveBeenCalledWith(
      { projectId: 7 },
      { enabled: true, staleTime: 30_000 }
    );
    expect(html).not.toMatch(/<button[^>]*\sdisabled(?:=|\s|>)/);
    expect(html).toContain(helper);
  });

  it("never renders financial amounts or private notes from query options", () => {
    const html = renderSelect();

    expect(html).not.toMatch(/1234567|765432|469135|\$12,345\.67|Confidential internal scope notes|Never display this private note/);
  });
});
