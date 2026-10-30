import { describe, expect, it } from "vitest";
import type { CoordinationItem } from "../drizzle/schema";
import { selectCollaboratorVisibleItems } from "./coordinationSharing";

function item(id: number, parentId: number | null, isCollaboratorVisible: boolean, content: string): CoordinationItem {
  return {
    id,
    sheetId: 7,
    parentId,
    authorName: "Synthetic author",
    authorType: "other",
    content,
    isUrgent: false,
    isAddressed: false,
    isNotified: false,
    visibility: "internal",
    isCollaboratorVisible,
    pinnedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    editedAt: null,
  };
}

describe("collaborator coordination view projection", () => {
  it("returns only explicitly collaborator-visible items and severs hidden parent links", () => {
    const visibleReplyToHiddenParent = item(2, 1, true, "visible reply");
    const visibleParent = item(3, null, true, "visible parent");
    const visibleReply = item(4, 3, true, "visible reply thread");
    const projected = selectCollaboratorVisibleItems([
      item(1, null, false, "private internal content"),
      visibleReplyToHiddenParent,
      visibleParent,
      visibleReply,
    ]);

    expect(projected.map(row => row.id)).toEqual([2, 3, 4]);
    expect(projected[0]?.parentId).toBeNull();
    expect(projected[2]?.parentId).toBe(3);
    expect(JSON.stringify(projected)).not.toContain("private internal content");
    expect(projected[0]).not.toHaveProperty("visibility");
    expect(projected[0]).not.toHaveProperty("isCollaboratorVisible");
  });
});
