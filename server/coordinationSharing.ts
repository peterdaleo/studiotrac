import type { CoordinationItem } from "../drizzle/schema";

export type CollaboratorViewItem = Pick<
  CoordinationItem,
  "id" | "parentId" | "authorName" | "authorType" | "content" | "isUrgent" | "isAddressed" | "pinnedAt" | "createdAt" | "editedAt"
>;

/** Selects only collaborator-visible items and severs parent references to hidden items. */
export function selectCollaboratorVisibleItems(items: CoordinationItem[]): CollaboratorViewItem[] {
  const visibleItems = items.filter(item => item.isCollaboratorVisible);
  const visibleIds = new Set(visibleItems.map(item => item.id));
  return visibleItems.map(item => ({
    id: item.id,
    parentId: item.parentId != null && visibleIds.has(item.parentId) ? item.parentId : null,
    authorName: item.authorName,
    authorType: item.authorType,
    content: item.content,
    isUrgent: item.isUrgent,
    isAddressed: item.isAddressed,
    pinnedAt: item.pinnedAt,
    createdAt: item.createdAt,
    editedAt: item.editedAt,
  }));
}
