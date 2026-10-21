import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { groupProspectsByConversion } from "../shared/prospects";
import { ConvertedProspectsSection } from "../client/src/components/ConvertedProspectsSection";

const records = [
  { id: 1, stage: "Won", convertedProjectId: null },
  { id: 2, stage: "Won", convertedProjectId: 42 },
  { id: 3, stage: "New", convertedProjectId: null },
  { id: 4, stage: "Proposal", convertedProjectId: 87 },
];

describe("converted prospect display grouping", () => {
  it("moves only linked records, retaining unconverted Won prospects in the working list", () => {
    const { working, converted } = groupProspectsByConversion(records);
    expect(working.map(({ id }) => id)).toEqual([1, 3]);
    expect(converted.map(({ id }) => id)).toEqual([2, 4]);
  });

  it("preserves source order, identity, and every record for export and print", () => {
    const before = structuredClone(records);
    const { working, converted } = groupProspectsByConversion(records);
    expect(records).toEqual(before);
    expect(converted[0]).toBe(records[1]);
    expect(new Set([...working, ...converted]).size).toBe(records.length);
    expect(records.map(({ id }) => id)).toEqual([1, 2, 3, 4]);
  });

  it("groups an already filtered list without reintroducing nonmatching records", () => {
    expect(groupProspectsByConversion(records.filter(({ id }) => id === 2)))
      .toEqual({ working: [], converted: [records[1]] });
    expect(groupProspectsByConversion([])).toEqual({ working: [], converted: [] });
  });
});

describe("converted prospect disclosure", () => {
  const render = (count: number, hasActiveFilters: boolean) => renderToStaticMarkup(createElement(
    ConvertedProspectsSection,
    { count, hasActiveFilters, children: createElement("a", { href: "/projects/42" }, "Open project") },
  ));

  it("starts collapsed, has an accessible control and count, and retains the project link", () => {
    const html = render(1, false);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="converted-prospects"');
    expect(html).toContain('id="converted-prospects" hidden=""');
    expect(html).toContain("Converted to projects");
    expect(html).toContain('href="/projects/42"');
    expect(html).toMatch(/>1<\/span>/);
  });

  it("keeps matches visible whenever a search or filter is active", () => {
    const html = render(1, true);
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('hidden=""');
    expect(html).toContain('disabled=""');
    expect(html).toContain("Matching converted prospects stay visible");
  });

  it("handles no converted records without showing a misleading project link", () => {
    expect(render(0, false)).toContain("No converted prospects yet.");
    expect(render(0, false)).not.toContain('href="/projects/42"');
    expect(render(0, true)).toContain("No converted prospects match these filters.");
  });
});
