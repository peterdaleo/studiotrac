import { describe, expect, it } from "vitest";
import { TASK_ASSIGNMENT_NOTIFICATION_TITLE } from "../shared/taskNotifications";
import {
  collectAssignmentToasts,
  notificationDestination,
  parseAssignmentToastState,
  parseFocusedTaskId,
  type PresentedNotification,
} from "../shared/taskNotificationPresentation";

const principal = { userId: 7, organizationId: 3 };
const notice = (patch: Partial<PresentedNotification> = {}): PresentedNotification => ({
  id: 11,
  type: "general",
  title: TASK_ASSIGNMENT_NOTIFICATION_TITLE,
  userId: 7,
  organizationId: 3,
  relatedTaskId: 42,
  relatedProjectId: 9,
  isRead: false,
  ...patch,
});

describe("task-aware notification destinations", () => {
  it("prioritizes a concrete task over its project", () => {
    expect(notificationDestination(notice())).toBe("/tasks?taskId=42");
    expect(notificationDestination({ relatedTaskId: null, relatedProjectId: 9 })).toBe("/projects/9");
    expect(notificationDestination({})).toBeNull();
    expect(notificationDestination({ relatedTaskId: -1, relatedProjectId: 0 })).toBeNull();
  });
  it("accepts only a positive safe integer taskId from the search string", () => {
    expect(parseFocusedTaskId("?taskId=42")).toBe(42);
    expect(parseFocusedTaskId("owner=7&taskId=42")).toBe(42);
    for (const value of ["", "0", "-1", "1.5", "1e3", "01", "NaN", "Infinity", "9007199254740992", "42<script>"]) {
      expect(parseFocusedTaskId(`?taskId=${encodeURIComponent(value)}`)).toBeNull();
    }
    expect(parseFocusedTaskId("?other=42")).toBeNull();
  });
});

describe("in-app assignment toast deduplication", () => {
  it("baselines existing unread notices without generating a toast storm", () => {
    const result = collectAssignmentToasts([notice()], principal, { initialized: false, seenIds: [] });
    expect(result.fresh).toEqual([]);
    expect(result.state).toEqual({ initialized: true, seenIds: [11] });
  });
  it("toasts a new notice once across repeated and duplicate poll results", () => {
    const baseline = collectAssignmentToasts([notice()], principal, { initialized: false, seenIds: [] });
    const next = collectAssignmentToasts([notice({ id: 12 }), notice({ id: 12 }), notice()], principal, baseline.state);
    expect(next.fresh.map((item) => item.id)).toEqual([12]);
    expect(collectAssignmentToasts([notice({ id: 12 })], principal, next.state).fresh).toEqual([]);
  });
  it("never presents another login/workspace, null recipient, non-assignment, or already-read notice", () => {
    const rows = [
      notice({ id: 20, userId: 8 }),
      notice({ id: 21, organizationId: 4 }),
      notice({ id: 22, userId: null }),
      notice({ id: 23, title: "Other general notice" }),
      notice({ id: 24, type: "status_change" }),
      notice({ id: 25, relatedTaskId: null }),
      notice({ id: 26, isRead: true }),
    ];
    const result = collectAssignmentToasts(rows, principal, { initialized: true, seenIds: [] });
    expect(result.fresh).toEqual([]);
    expect(result.state.seenIds).toEqual([26]);
  });
  it("retains dedupe state across layout remounts and rejects corrupt storage", () => {
    const persisted = JSON.stringify({ initialized: true, seenIds: [11, 0, -1, "12", 12] });
    const parsed = parseAssignmentToastState(persisted);
    expect(parsed).toEqual({ initialized: true, seenIds: [11, 12] });
    expect(collectAssignmentToasts([notice({ id: 12 })], principal, parsed).fresh).toEqual([]);
    expect(parseAssignmentToastState("invalid json")).toEqual({ initialized: false, seenIds: [] });
    expect(parseAssignmentToastState(null)).toEqual({ initialized: false, seenIds: [] });
  });
});
