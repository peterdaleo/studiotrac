import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  computeProspectInsights,
  initialProspectClosedAt,
  matchesProspectOutcomeList,
  prospectClosedAtAfterStageChange,
} from "../shared/prospects";

const stamp = (day: string) => new Date(`${day}T12:00:00.000Z`);

describe("prospect insight metrics", () => {
  it("counts current open stages without applying outcome date bounds", () => {
    const result = computeProspectInsights([
      { stage: "New", createdAt: "2026-01-01", closedAt: null, ownerId: 1 },
      { stage: "New", createdAt: "2026-01-01", closedAt: null, ownerId: 2 },
      { stage: "Proposal", createdAt: "2026-01-01", closedAt: null, ownerId: 1 },
      { stage: "Won", createdAt: "2026-01-01", closedAt: "2025-01-01", ownerId: 1 },
    ], { ownerId: 1, from: "2026-01-01", to: "2026-01-31" });
    expect(result.openByStage).toEqual({ New: 1, Contacted: 0, Proposal: 1, Negotiation: 0 });
    expect(result.totalOpen).toBe(2);
    expect(result.wonCount).toBe(0);
  });

  it("keeps referral strings case-sensitive and groups missing values in a separate bucket", () => {
    const result = computeProspectInsights([
      { stage: "Won", createdAt: "2026-01-01", closedAt: "2026-01-02", referralSource: "Website" },
      { stage: "Lost", createdAt: "2026-01-01", closedAt: "2026-01-02", referralSource: "Website" },
      { stage: "Won", createdAt: "2026-01-01", closedAt: "2026-01-02", referralSource: "website" },
      { stage: "Lost", createdAt: "2026-01-01", closedAt: "2026-01-02", referralSource: null },
      { stage: "Won", createdAt: "2026-01-01", closedAt: "2026-01-02", referralSource: "" },
    ]);
    const bySource = new Map(result.byReferralSource.map((source) => [source.source, source]));
    expect(bySource.get("Website")).toMatchObject({ wonCount: 1, closedOutcomeCount: 2, winRate: 0.5 });
    expect(bySource.get("website")).toMatchObject({ wonCount: 1, closedOutcomeCount: 1, winRate: 1 });
    expect(bySource.get(null)).toMatchObject({ label: "No referral source (missing)", wonCount: 1, closedOutcomeCount: 2, winRate: 0.5 });
    expect(result.closedOutcomeCount).toBe(5);
  });

  it("uses current owner and inclusive closed-date range boundaries", () => {
    const result = computeProspectInsights([
      { stage: "Won", createdAt: "2026-01-01", closedAt: "2026-01-01", ownerId: 7 },
      { stage: "Lost", createdAt: "2026-01-01", closedAt: "2026-01-31", ownerId: 7 },
      { stage: "Won", createdAt: "2026-01-01", closedAt: "2025-12-31", ownerId: 7 },
      { stage: "Won", createdAt: "2026-01-01", closedAt: "2026-01-15", ownerId: 8 },
      { stage: "Negotiation", createdAt: "2026-01-01", ownerId: 7 },
    ], { ownerId: 7, from: "2026-01-01", to: "2026-01-31" });
    expect(result.openByStage.Negotiation).toBe(1);
    expect(result.wonCount).toBe(1);
    expect(result.lostCount).toBe(1);
    expect(result.closedOutcomeCount).toBe(2);
  });

  it("computes odd and even medians from valid nonnegative elapsed-day durations", () => {
    const odd = computeProspectInsights([
      { stage: "Won", createdAt: stamp("2026-01-01"), closedAt: stamp("2026-01-02") },
      { stage: "Lost", createdAt: stamp("2026-01-01"), closedAt: stamp("2026-01-04") },
      { stage: "Won", createdAt: stamp("2026-01-01"), closedAt: stamp("2026-01-08") },
    ]);
    expect(odd.medianElapsedDays).toBe(3);
    const even = computeProspectInsights([
      { stage: "Won", createdAt: stamp("2026-01-01"), closedAt: stamp("2026-01-02") },
      { stage: "Lost", createdAt: stamp("2026-01-01"), closedAt: stamp("2026-01-04") },
    ]);
    expect(even.medianElapsedDays).toBe(2);
  });

  it("reports missing or invalid decision dates as undated and excludes them from dated outcomes", () => {
    const result = computeProspectInsights([
      { stage: "Won", createdAt: "2026-01-01", closedAt: null, referralSource: "legacy" },
      { stage: "Lost", createdAt: "2026-01-01", closedAt: "not-a-date", referralSource: "legacy" },
      { stage: "Won", createdAt: "bad-created-date", closedAt: "2026-01-02", referralSource: "known" },
      { stage: "Lost", createdAt: "2026-01-10", closedAt: "2026-01-09", referralSource: "negative-duration" },
    ]);
    expect(result.undatedOutcomeCount).toBe(2);
    expect(result.closedOutcomeCount).toBe(2);
    expect(result.wonCount).toBe(1);
    expect(result.lostCount).toBe(1);
    expect(result.medianElapsedDays).toBeNull();
    expect(result.byReferralSource.map(({ source }) => source).sort()).toEqual(["known", "negative-duration"]);
  });
});

describe("prospect decision timestamps", () => {
  const now = stamp("2026-04-10");
  const old = stamp("2026-03-02");

  it("sets actual server time for new terminal records only", () => {
    expect(initialProspectClosedAt("Won", now)).toBe(now);
    expect(initialProspectClosedAt("Lost", now)).toBe(now);
    expect(initialProspectClosedAt("New", now)).toBeNull();
  });

  it("sets time on open-to-terminal and Won/Lost decision changes", () => {
    expect(prospectClosedAtAfterStageChange("Proposal", null, "Won", now)).toBe(now);
    expect(prospectClosedAtAfterStageChange("Won", old, "Lost", now)).toBe(now);
  });

  it("preserves timestamps on unchanged terminal stage and unrelated edits, including legacy null", () => {
    expect(prospectClosedAtAfterStageChange("Won", old, "Won", now)).toBe(old);
    expect(prospectClosedAtAfterStageChange("Lost", null, "Lost", now)).toBeNull();
    // Conversion leaves the terminal stage unchanged; it does not create a decision date.
    expect(prospectClosedAtAfterStageChange("Won", null, "Won", now)).toBeNull();
  });

  it("clears the decision timestamp when reopening a terminal prospect", () => {
    expect(prospectClosedAtAfterStageChange("Won", old, "Negotiation", now)).toBeNull();
    expect(prospectClosedAtAfterStageChange("Lost", null, "New", now)).toBeNull();
  });
});

describe("prospect outcome list scope", () => {
  const records = [
    { id: "open", stage: "New", createdAt: "2026-01-01", closedAt: null },
    { id: "won-in-range", stage: "Won", createdAt: "2026-01-01", closedAt: "2026-01-15" },
    { id: "lost-on-boundary", stage: "Lost", createdAt: "2026-01-01", closedAt: "2026-01-31" },
    { id: "won-outside", stage: "Won", createdAt: "2026-01-01", closedAt: "2025-12-31" },
    { id: "legacy-undated", stage: "Lost", createdAt: "2026-01-01", closedAt: null },
  ] as const;
  const ids = (options: Parameters<typeof matchesProspectOutcomeList>[1] = {}) =>
    records.filter((record) => matchesProspectOutcomeList(record, options)).map((record) => record.id);

  it("shows open snapshot and every terminal record by default without outcome bounds", () => {
    expect(ids()).toEqual(["open", "won-in-range", "lost-on-boundary", "won-outside", "legacy-undated"]);
  });

  it("keeps open snapshot rows while applying inclusive decision-date bounds to dated outcomes", () => {
    expect(ids({ from: "2026-01-01", to: "2026-01-31" })).toEqual(["open", "won-in-range", "lost-on-boundary"]);
  });

  it("restricts KPI dated mode to dated terminal outcomes in the same inclusive date scope", () => {
    expect(ids({ mode: "dated", from: "2026-01-15", to: "2026-01-31" })).toEqual(["won-in-range", "lost-on-boundary"]);
    expect(ids({ mode: "dated" })).toEqual(["won-in-range", "lost-on-boundary", "won-outside"]);
  });

  it("shows only undated terminal records regardless of date bounds", () => {
    expect(ids({ mode: "undated", from: "2026-01-01", to: "2026-01-31" })).toEqual(["legacy-undated"]);
    expect(ids({ mode: "undated" })).toEqual(["legacy-undated"]);
  });
});

describe("Prospects insight KPI click contract", () => {
  const page = readFileSync(new URL("../client/src/pages/Prospects.tsx", import.meta.url), "utf8");

  it("routes Won/Lost, aggregate, source, open-stage, and undated controls to their distinct list modes", () => {
    expect(page).toContain('onClick={() => selectOutcomeStage("Won")}');
    expect(page).toContain('onClick={() => selectOutcomeStage("Lost")}');
    expect(page.match(/onClick=\{selectDatedOutcomes\}/g)).toHaveLength(2);
    expect(page).toContain('sourceFilter.source === source.source');
    expect(page).toContain('setOutcomeMode(selected ? "all" : "dated")');
    expect(page).toContain('setOutcomeMode("all")');
    expect(page).toContain('onClick={selectUndatedOutcomes}');
    expect(page).toContain('setOutcomeMode(alreadySelected ? "all" : "undated")');
  });
});
