import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

// Mock db module
vi.mock("./db", () => ({
  listTeamMembers: vi.fn().mockResolvedValue([
    { id: 1, name: "Sarah Chen", email: "sarah@studio.com", title: "Principal Architect", avatarColor: "#6366f1", isActive: true },
    { id: 2, name: "Marcus Rivera", email: "marcus@studio.com", title: "Senior Designer", avatarColor: "#ec4899", isActive: true },
  ]),
  getTeamMember: vi.fn().mockResolvedValue({ id: 1, name: "Sarah Chen", email: "sarah@studio.com", title: "Principal Architect" }),
  createTeamMember: vi.fn().mockResolvedValue({ id: 3 }),
  updateTeamMember: vi.fn().mockResolvedValue(undefined),
  deleteTeamMember: vi.fn().mockResolvedValue(undefined),
  getTeamMemberStats: vi.fn().mockResolvedValue({ assignedTasks: 5, completedTasks: 3, overdueTasks: 1, activeProjects: 2 }),

  listProjects: vi.fn().mockResolvedValue([
    { id: 1, name: "Riverside Cultural Center", clientName: "City of Portland", status: "on_track", phase: "construction_documents", completionPercentage: 68 },
    { id: 2, name: "Meridian Tower", clientName: "Apex Development", status: "delayed", phase: "design_development", completionPercentage: 42 },
  ]),
  getProject: vi.fn().mockResolvedValue({
    id: 1, name: "Riverside Cultural Center", clientName: "City of Portland", status: "on_track",
    phase: "construction_documents", completionPercentage: 68, billing25: true, billing50: true,
    billing75: false, billing100: false, billingOk: true,
  }),
  createProject: vi.fn().mockResolvedValue({ id: 3 }),
  updateProject: vi.fn().mockResolvedValue(undefined),
  deleteProject: vi.fn().mockResolvedValue(undefined),

  listTasks: vi.fn().mockResolvedValue([
    { id: 1, projectId: 1, title: "Finalize structural engineering", status: "in_progress", priority: 3, assigneeId: 1 },
    { id: 2, projectId: 1, title: "Complete MEP review", status: "todo", priority: 5, assigneeId: 2 },
  ]),
  getTask: vi.fn().mockResolvedValue({ id: 1, projectId: 1, title: "Finalize structural engineering", status: "in_progress", priority: 3 }),
  createTask: vi.fn().mockResolvedValue({ id: 3 }),
  updateTask: vi.fn().mockResolvedValue(undefined),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  reorderTasks: vi.fn().mockResolvedValue(undefined),

  listProjectNotes: vi.fn().mockResolvedValue([
    { id: 1, projectId: 1, content: "Test note", isClientVisible: false, createdAt: new Date() },
  ]),
  createProjectNote: vi.fn().mockResolvedValue({ id: 2 }),
  updateProjectNote: vi.fn().mockResolvedValue(undefined),
  deleteProjectNote: vi.fn().mockResolvedValue(undefined),

  // Project Files
  listProjectFiles: vi.fn().mockResolvedValue([
    { id: 1, projectId: 1, fileName: "floor-plan.pdf", fileKey: "projects/1/files/abc.pdf", url: "https://cdn.example.com/abc.pdf", mimeType: "application/pdf", fileSize: 2048000, category: "drawing", createdAt: new Date() },
    { id: 2, projectId: 1, fileName: "site-photo.jpg", fileKey: "projects/1/files/def.jpg", url: "https://cdn.example.com/def.jpg", mimeType: "image/jpeg", fileSize: 512000, category: "photo", createdAt: new Date() },
  ]),
  createProjectFile: vi.fn().mockResolvedValue({ id: 3 }),
  deleteProjectFile: vi.fn().mockResolvedValue({ id: 1, fileName: "floor-plan.pdf" }),
  getProjectFileCount: vi.fn().mockResolvedValue(2),

  // Email Preferences
  getEmailPreferences: vi.fn().mockResolvedValue({
    id: 1, userId: 1, emailAddress: "test@studio.com",
    deadlineAlerts: true, overdueAlerts: true, statusChangeAlerts: false, alertDaysBefore: 3,
  }),
  upsertEmailPreferences: vi.fn().mockResolvedValue({ id: 1 }),

  // Email Log
  logEmail: vi.fn().mockResolvedValue({ id: 1 }),
  listEmailLog: vi.fn().mockResolvedValue([
    { id: 1, recipientEmail: "team@studio.com", subject: "Deadline approaching", body: "Task due tomorrow", sentAt: new Date() },
  ]),

  // Deadline checks
  getUpcomingDeadlineTasks: vi.fn().mockResolvedValue([
    { id: 1, title: "Review drawings", status: "in_progress", deadline: new Date(Date.now() + 86400000) },
  ]),
  getOverdueTasks: vi.fn().mockResolvedValue([
    { id: 5, title: "Submit permits", status: "overdue", deadline: new Date(Date.now() - 86400000) },
  ]),
  getUpcomingDeadlineProjects: vi.fn().mockResolvedValue([
    { id: 1, name: "Riverside Cultural Center", deadline: new Date(Date.now() + 2 * 86400000) },
  ]),

  // Gantt
  getGanttData: vi.fn().mockResolvedValue({
    projects: [
      { id: 1, name: "Riverside Cultural Center", status: "on_track", phase: "construction_documents", startDate: new Date("2025-01-15"), deadline: new Date("2025-12-31"), completionPercentage: 68 },
      { id: 2, name: "Meridian Tower", status: "delayed", phase: "design_development", startDate: new Date("2025-03-01"), deadline: new Date("2026-06-30"), completionPercentage: 42 },
    ],
    tasks: [
      { id: 1, projectId: 1, title: "Structural review", status: "in_progress", assigneeId: 1, deadline: new Date("2025-08-15") },
      { id: 2, projectId: 2, title: "MEP coordination", status: "todo", assigneeId: 1, deadline: new Date("2025-09-01") },
    ],
    members: [
      { id: 1, name: "Sarah Chen", title: "Principal Architect", avatarColor: "#6366f1", isActive: true },
    ],
  }),

  listNotifications: vi.fn().mockResolvedValue([
    { id: 1, type: "task_overdue", title: "Overdue task", message: "Test", isRead: false, createdAt: new Date() },
  ]),
  getUnreadNotificationCount: vi.fn().mockResolvedValue(3),
  markNotificationRead: vi.fn().mockResolvedValue(undefined),
  markAllNotificationsRead: vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue({ id: 10 }),

  getDashboardStats: vi.fn().mockResolvedValue({
    totalProjects: 8, onTrack: 5, delayed: 1, onHold: 1, completed: 1,
    totalTasks: 19, overdueTasks: 2, completedTasks: 7,
  }),
  seedDemoData: vi.fn().mockResolvedValue({ seeded: true, message: "Demo data seeded successfully" }),
}));

// Mock storage module
vi.mock("./storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ key: "projects/1/files/abc.pdf", url: "https://cdn.example.com/abc.pdf" }),
}));

// Mock notification module
vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext; clearedCookies: { name: string; options: Record<string, unknown> }[] } {
  const clearedCookies: { name: string; options: Record<string, unknown> }[] = [];
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-123",
    email: "test@studio.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };
  return { ctx, clearedCookies };
}

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();
    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
  });
});

describe("teamMembers", () => {
  it("lists team members", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const members = await caller.teamMembers.list();
    expect(members).toHaveLength(2);
    expect(members[0]?.name).toBe("Sarah Chen");
  });

  it("gets a single team member", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const member = await caller.teamMembers.get({ id: 1 });
    expect(member?.name).toBe("Sarah Chen");
  });

  it("creates a team member", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.teamMembers.create({ name: "New Member", email: "new@studio.com", title: "Architect" });
    expect(result).toEqual({ id: 3 });
  });

  it("gets team member stats", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const stats = await caller.teamMembers.stats({ id: 1 });
    expect(stats.assignedTasks).toBe(5);
    expect(stats.completedTasks).toBe(3);
  });
});

describe("projects", () => {
  it("lists projects", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const projectsList = await caller.projects.list({});
    expect(projectsList).toHaveLength(2);
    expect(projectsList[0]?.name).toBe("Riverside Cultural Center");
  });

  it("gets a single project with billing milestones", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const project = await caller.projects.get({ id: 1 });
    expect(project?.name).toBe("Riverside Cultural Center");
    expect(project?.billing25).toBe(true);
    expect(project?.billing50).toBe(true);
    expect(project?.billing75).toBe(false);
    expect(project?.billingOk).toBe(true);
  });

  it("creates a project", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.projects.create({
      name: "New Project",
      clientName: "Test Client",
      phase: "schematic_design",
    });
    expect(result).toEqual({ id: 3 });
  });

  it("validates project status enum", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.projects.create({ name: "Test", status: "invalid_status" as any })
    ).rejects.toThrow();
  });

  it("validates project phase enum", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.projects.create({ name: "Test", phase: "invalid_phase" as any })
    ).rejects.toThrow();
  });
});

describe("tasks", () => {
  it("lists tasks", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const tasksList = await caller.tasks.list({});
    expect(tasksList).toHaveLength(2);
  });

  it("creates a task with priority", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.tasks.create({
      projectId: 1,
      title: "Review drawings",
      priority: 5,
    });
    expect(result).toEqual({ id: 3 });
  });

  it("validates priority range (1-20)", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.tasks.create({ projectId: 1, title: "Test", priority: 0 })
    ).rejects.toThrow();
    await expect(
      caller.tasks.create({ projectId: 1, title: "Test", priority: 21 })
    ).rejects.toThrow();
  });

  it("reorders tasks", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await caller.tasks.reorder({
      taskOrders: [
        { id: 1, sortOrder: 1 },
        { id: 2, sortOrder: 0 },
      ],
    });
  });
});

describe("notes", () => {
  it("lists project notes", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const notesList = await caller.notes.list({ projectId: 1 });
    expect(notesList).toHaveLength(1);
    expect(notesList[0]?.content).toBe("Test note");
  });

  it("creates a note with client visibility", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.notes.create({
      projectId: 1,
      content: "New note",
      isClientVisible: true,
    });
    expect(result).toEqual({ id: 2 });
  });
});

describe("notifications", () => {
  it("lists notifications", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const notifs = await caller.notifications.list();
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.type).toBe("task_overdue");
  });

  it("gets unread count", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const count = await caller.notifications.unreadCount();
    expect(count).toBe(3);
  });

  it("marks notification as read", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await caller.notifications.markRead({ id: 1 });
  });

  it("marks all notifications as read", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await caller.notifications.markAllRead();
  });
});

// ── Phase 2 Tests ──────────────────────────────────────────────

describe("files (project attachments)", () => {
  it("lists project files", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const files = await caller.files.list({ projectId: 1 });
    expect(files).toHaveLength(2);
    expect(files[0]?.fileName).toBe("floor-plan.pdf");
    expect(files[1]?.category).toBe("photo");
  });

  it("uploads a file with base64 data", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.files.upload({
      projectId: 1,
      fileName: "test-drawing.pdf",
      fileData: "dGVzdCBjb250ZW50", // base64 "test content"
      mimeType: "application/pdf",
      fileSize: 12,
      category: "drawing",
    });
    expect(result).toEqual({ id: 3 });
  });

  it("validates file category enum", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.files.upload({
        projectId: 1,
        fileName: "test.pdf",
        fileData: "dGVzdA==",
        category: "invalid_category" as any,
      })
    ).rejects.toThrow();
  });

  it("deletes a file", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.files.delete({ id: 1 });
    expect(result).toBeDefined();
  });

  it("gets file count for a project", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const count = await caller.files.count({ projectId: 1 });
    expect(count).toBe(2);
  });
});

describe("emailPreferences", () => {
  it("gets email preferences", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const prefs = await caller.emailPreferences.get();
    expect(prefs?.emailAddress).toBe("test@studio.com");
    expect(prefs?.deadlineAlerts).toBe(true);
    expect(prefs?.overdueAlerts).toBe(true);
    expect(prefs?.statusChangeAlerts).toBe(false);
    expect(prefs?.alertDaysBefore).toBe(3);
  });

  it("upserts email preferences", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.emailPreferences.upsert({
      emailAddress: "new@studio.com",
      deadlineAlerts: true,
      overdueAlerts: false,
      alertDaysBefore: 5,
    });
    expect(result).toEqual({ id: 1 });
  });

  it("validates email address format", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.emailPreferences.upsert({ emailAddress: "not-an-email" })
    ).rejects.toThrow();
  });

  it("validates alertDaysBefore range (1-14)", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.emailPreferences.upsert({ emailAddress: "test@studio.com", alertDaysBefore: 0 })
    ).rejects.toThrow();
    await expect(
      caller.emailPreferences.upsert({ emailAddress: "test@studio.com", alertDaysBefore: 15 })
    ).rejects.toThrow();
  });
});

describe("emailNotifications", () => {
  it("returns email log", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const log = await caller.emailNotifications.log();
    expect(log).toHaveLength(1);
    expect(log[0]?.subject).toBe("Deadline approaching");
  });

  it("checks deadlines and generates alerts", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.emailNotifications.checkDeadlines();
    expect(result.alertsGenerated).toBeGreaterThan(0);
    expect(result.alerts).toBeInstanceOf(Array);
    // Should have at least: 1 upcoming task + 1 overdue task + 1 project deadline
    expect(result.alerts.length).toBeGreaterThanOrEqual(3);
    
    // Verify alert types
    const types = result.alerts.map(a => a.type);
    expect(types).toContain("task_overdue");
    expect(types).toContain("project_deadline");
  });
});

describe("gantt", () => {
  it("returns gantt data with projects, tasks, and members", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const data = await caller.gantt.data();
    expect(data.projects).toHaveLength(2);
    expect(data.tasks).toHaveLength(2);
    expect(data.members).toHaveLength(1);
    expect(data.projects[0]?.name).toBe("Riverside Cultural Center");
    expect(data.members[0]?.name).toBe("Sarah Chen");
  });
});

describe("dashboard", () => {
  it("returns dashboard stats", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const stats = await caller.dashboard.stats();
    expect(stats.totalProjects).toBe(8);
    expect(stats.onTrack).toBe(5);
    expect(stats.delayed).toBe(1);
    expect(stats.totalTasks).toBe(19);
    expect(stats.overdueTasks).toBe(2);
  });

  it("seeds demo data", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.dashboard.seed();
    expect(result.seeded).toBe(true);
  });
});
