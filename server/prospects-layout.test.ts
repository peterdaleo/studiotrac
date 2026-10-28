import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { React });

const mocks = vi.hoisted(() => ({
  role: "admin" as string,
  effectiveRole: null as string | null,
  prospectsQuery: vi.fn(),
  teamMembersQuery: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: mocks.role } }),
}));

vi.mock("@/contexts/StaffPreviewContext", () => ({
  useEffectiveRole: (role?: string) => mocks.effectiveRole ?? role,
}));

vi.mock("@/lib/trpc", () => {
  const mutation = () => ({ useMutation: () => ({ mutate: vi.fn(), isPending: false }) });
  const invalidate = { invalidate: vi.fn() };
  return {
    trpc: {
      useUtils: () => ({
        prospects: { list: invalidate },
        projects: { list: invalidate },
        dashboard: { stats: invalidate },
      }),
      prospects: {
        list: { useQuery: mocks.prospectsQuery },
        create: mutation(),
        update: mutation(),
        addInteraction: mutation(),
        convertToProject: mutation(),
      },
      teamMembers: { list: { useQuery: mocks.teamMembersQuery } },
    },
  };
});

vi.mock("wouter", () => ({
  useLocation: () => ["/prospects", vi.fn()],
  Link: () => null,
}));

import Prospects from "../client/src/pages/Prospects";

type Prospect = {
  id: number;
  firm: string;
  opportunityName: string;
  contact: string | null;
  referralSource: string | null;
  stage: "Contacted" | "Won";
  closedAt: string | null;
  ownerId: number | null;
  nextFollowUpDate: string | null;
  convertedProjectId: number | null;
  convertedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastInteractionAt: string | null;
  interactions: [];
};

const workingProspect: Prospect = {
  id: 1,
  firm: "Northwind Studio",
  opportunityName: "Working opportunity marker",
  contact: "Alex Example",
  referralSource: "Referral",
  stage: "Contacted",
  closedAt: null,
  ownerId: null,
  nextFollowUpDate: null,
  convertedProjectId: null,
  convertedAt: null,
  createdAt: "2026-01-01T12:00:00.000Z",
  updatedAt: "2026-01-01T12:00:00.000Z",
  lastInteractionAt: null,
  interactions: [],
};

const convertedProspect: Prospect = {
  ...workingProspect,
  id: 2,
  opportunityName: "Converted opportunity marker",
  stage: "Won",
  closedAt: "2026-02-01T12:00:00.000Z",
  convertedProjectId: 22,
  convertedAt: "2026-02-02T12:00:00.000Z",
};

function renderPage() {
  return renderToStaticMarkup(React.createElement(Prospects));
}

function expectInOrder(html: string, markers: string[]) {
  const positions = markers.map((marker) => html.indexOf(marker));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "admin";
  mocks.effectiveRole = null;
  mocks.prospectsQuery.mockReturnValue({ data: [workingProspect, convertedProspect], isLoading: false });
  mocks.teamMembersQuery.mockReturnValue({ data: [] });
});

describe("Prospects page layout", () => {
  it("renders follow-up cards, controls, working list, converted section, then insights", () => {
    const html = renderPage();

    expectInOrder(html, [
      "Overdue follow-ups",
      "Due Today",
      "Search prospects",
      "Working opportunity marker",
      "Converted to projects",
      "Prospect insights",
    ]);
    expect(html).toContain("Converted opportunity marker");
    expect(mocks.prospectsQuery).toHaveBeenCalledWith(undefined, { enabled: true });
  });

  it("keeps the empty-state list position ahead of converted prospects and insights", () => {
    mocks.prospectsQuery.mockReturnValue({ data: [], isLoading: false });
    const html = renderPage();

    expectInOrder(html, [
      "Overdue follow-ups",
      "Due Today",
      "Search prospects",
      "Start your prospect pipeline",
      "Converted to projects",
      "Prospect insights",
    ]);
  });

  it.each([
    ["loading", { data: undefined, isLoading: true }, "Loading prospects…"],
    ["error", { data: undefined, isLoading: false, error: new Error("request failed") }, "Could not load prospects: request failed"],
  ])("places the %s state after controls and before insights", (_state, queryResult, stateMarker) => {
    mocks.prospectsQuery.mockReturnValue(queryResult);
    const html = renderPage();

    expectInOrder(html, ["Overdue follow-ups", "Due Today", "Search prospects", stateMarker, "Prospect insights"]);
    expect(html).not.toContain("Converted to projects");
  });

  it("continues to restrict access for a non-managing effective role", () => {
    mocks.role = "admin";
    mocks.effectiveRole = "user";
    const html = renderPage();

    expect(html).toContain("Prospects are restricted");
    expect(html).not.toContain("Overdue follow-ups");
    expect(html).not.toContain("Search prospects");
    expect(html).not.toContain("Converted to projects");
    expect(html).not.toContain("Prospect insights");
    expect(mocks.prospectsQuery).toHaveBeenCalledWith(undefined, { enabled: false });
  });
});
