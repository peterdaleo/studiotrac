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

  listNotifications: vi.fn().mockResolvedValue([
    { id: 1, type: "task_overdue", title: "Overdue task", message: "Test", isRead: false, createdAt: new Date() },
  ]),
  getUnreadNotificationCount: vi.fn().mockResolvedValue(3),
  markNotificationRead: vi.fn().mockResolvedValue(undefined),
  markAllNotificationsRead: vi.fn().mockResolvedValue(undefined),

  getDashboardStats: vi.fn().mockResolvedValue({
    totalProjects: 8, onTrack: 5, delayed: 1, onHold: 1, completed: 1,
    totalTasks: 19, overdueTasks: 2, completedTasks: 7,
  }),
  seedDemoData: vi.fn().mockResolvedValue({ seeded: true, message: "Demo data seeded successfully" }),
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
    // Should not throw
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
    // Should not throw
  });

  it("marks all notifications as read", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await caller.notifications.markAllRead();
    // Should not throw
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
