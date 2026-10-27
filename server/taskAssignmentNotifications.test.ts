import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createPool } from "mysql2";
import { createConnection } from "mysql2/promise";
import {
  isTaskAssignmentNotification,
  TASK_ASSIGNMENT_NOTIFICATION_TITLE,
  taskNotificationHref,
} from "../shared/taskNotifications";

const enabled = process.env.TASK_ASSIGNMENT_INTEGRATION === "1";
const FIXTURE_DATABASE = "stage2_access_test";
type Connection = Awaited<ReturnType<typeof createConnection>>;

function fixtureUrl(): URL {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required for the integration suite");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid mysql:// URL");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (
    url.protocol !== "mysql:" ||
    url.hostname.toLowerCase() !== "127.0.0.1" ||
    url.port !== "3339" ||
    database !== FIXTURE_DATABASE ||
    url.username !== "stage1" ||
    !url.password
  ) {
    throw new Error(`Refusing task-assignment integration tests outside the dedicated 127.0.0.1:3339 ${FIXTURE_DATABASE} fixture`);
  }
  return url;
}

const suite = enabled ? describe : describe.skip;

describe("task assignment notification contract", () => {
  it("recognizes only exact, user-specific task-assignment notices", () => {
    expect(isTaskAssignmentNotification({ type: "general", title: TASK_ASSIGNMENT_NOTIFICATION_TITLE, relatedTaskId: 4, userId: 8 })).toBe(true);
    expect(isTaskAssignmentNotification({ type: "general", title: TASK_ASSIGNMENT_NOTIFICATION_TITLE, relatedTaskId: 0, userId: 8 })).toBe(false);
    expect(isTaskAssignmentNotification({ type: "general", title: TASK_ASSIGNMENT_NOTIFICATION_TITLE, relatedTaskId: 4, userId: null })).toBe(false);
    expect(isTaskAssignmentNotification({ type: "task_overdue", title: TASK_ASSIGNMENT_NOTIFICATION_TITLE, relatedTaskId: 4, userId: 8 })).toBe(false);
    expect(isTaskAssignmentNotification({ type: "general", title: "Other notice", relatedTaskId: 4, userId: 8 })).toBe(false);
    expect(isTaskAssignmentNotification(null)).toBe(false);
  });

  it("creates the task deep link and rejects invalid IDs", () => {
    expect(taskNotificationHref(24)).toBe("/tasks?taskId=24");
    expect(() => taskNotificationHref(0)).toThrow(TypeError);
    expect(() => taskNotificationHref(1.5)).toThrow(TypeError);
    expect(() => taskNotificationHref(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
  });
});

suite("task assignment notifications — isolated synthetic MySQL", () => {
  let connection: Connection;
  let database: typeof import("./db");
  let originalDatabaseUrl: string | undefined;
  let originalNodeEnv: string | undefined;
  const pools: Array<ReturnType<typeof createPool>> = [];
  const createdOrgIds: number[] = [];
  const marker = randomUUID().replace(/-/g, "");
  let orgId: number;
  let foreignOrgId: number;
  let userOne: number;
  let userTwo: number;
  let foreignUser: number;
  let memberOne: number;
  let memberTwo: number;
  let unlinkedMember: number;
  let inactiveMember: number;
  let missingUserMember: number;
  let foreignLinkedMember: number;
  let projectId: number;
  let assignedTaskId: number;

  const insert = async (table: string, record: Record<string, unknown>): Promise<number> => {
    const columns = Object.keys(record);
    const values = columns.map((key) => record[key]);
    const placeholders = columns.map(() => "?").join(", ");
    const [result] = await connection.execute(
      `INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(", ")}) VALUES (${placeholders})`,
      values,
    );
    return Number((result as { insertId: number }).insertId);
  };

  const countNotices = async (taskId: number) => {
    const [rows] = await connection.execute(
      "SELECT id, organizationId, userId, type, title, relatedTaskId, relatedProjectId FROM notifications WHERE relatedTaskId = ? AND organizationId = ? AND type = 'general' AND title = ?",
      [taskId, orgId, TASK_ASSIGNMENT_NOTIFICATION_TITLE],
    );
    return rows as Array<Record<string, unknown>>;
  };

  const makeProject = async (name: string, status: "on_track" | "completed" = "on_track") => insert("projects", {
    organizationId: orgId,
    name: `${name} ${marker}`,
    status,
    phase: "pre_design",
    completionPercentage: status === "completed" ? 100 : 0,
    billing25: 0,
    billing50: 0,
    billing75: 0,
    billing100: status === "completed" ? 1 : 0,
    billingOk: status === "completed" ? 1 : 0,
    estimatedHours: 0,
    contractedFee: 0,
    invoicedAmount: 0,
    billingType: "fixed_fee",
    hourlyRateCents: 0,
    notToExceedCents: 0,
    revenueTargetCents: 0,
  });

  const makeTask = async (project: number, name: string, status: "todo" | "done" = "todo", assigneeId: number | null = null) => insert("tasks", {
    organizationId: orgId,
    projectId: project,
    assigneeId,
    title: `${name} ${marker}`,
    status,
    priority: 10,
    sortOrder: 0,
  });

  beforeAll(async () => {
    if (!enabled) return;
    const url = fixtureUrl();
    connection = await createConnection(url.toString());
    originalDatabaseUrl = process.env.DATABASE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    vi.resetModules();
    vi.doMock("mysql2", async (importOriginal) => {
      const actual = await importOriginal<typeof import("mysql2")>();
      return {
        ...actual,
        createPool: (...args: Parameters<typeof createPool>) => {
          const pool = actual.createPool(...args);
          pools.push(pool);
          return pool;
        },
      };
    });
    process.env.DATABASE_URL = url.toString();
    process.env.NODE_ENV = "production";
    database = await import("./db");

    orgId = await insert("organizations", { name: `Task notice org ${marker}`, slug: `task-notice-${marker}` });
    createdOrgIds.push(orgId);
    foreignOrgId = await insert("organizations", { name: `Task notice foreign org ${marker}`, slug: `task-notice-foreign-${marker}` });
    createdOrgIds.push(foreignOrgId);
    const makeUser = (name: string, organizationId: number) => insert("users", {
      openId: `task-notice-${marker}-${name}`,
      name,
      email: `${name}-${marker}@example.invalid`,
      role: "user",
      organizationId,
      orgRole: "member",
    });
    userOne = await makeUser("member-one", orgId);
    userTwo = await makeUser("member-two", orgId);
    foreignUser = await makeUser("foreign-member", foreignOrgId);
    memberOne = await insert("team_members", { organizationId: orgId, userId: userOne, name: "Member One", isActive: 1 });
    memberTwo = await insert("team_members", { organizationId: orgId, userId: userTwo, name: "Member Two", isActive: 1 });
    unlinkedMember = await insert("team_members", { organizationId: orgId, userId: null, name: "Unlinked Member", isActive: 1 });
    inactiveMember = await insert("team_members", { organizationId: orgId, userId: userOne, name: "Inactive Member", isActive: 0 });
    missingUserMember = await insert("team_members", { organizationId: orgId, userId: 99999998, name: "Missing Login", isActive: 1 });
    // Deliberately corrupt linkage fixture: member is local to the task but its login belongs to another org.
    foreignLinkedMember = await insert("team_members", { organizationId: orgId, userId: foreignUser, name: "Foreign Login Link", isActive: 1 });
    projectId = await makeProject("Main project");
    assignedTaskId = await makeTask(projectId, "Assignment transitions");
  }, 30000);

  afterAll(async () => {
    if (connection) {
      for (const id of createdOrgIds) {
        await connection.execute("DELETE FROM notifications WHERE organizationId = ?", [id]).catch(() => undefined);
        await connection.execute("DELETE FROM tasks WHERE organizationId = ?", [id]).catch(() => undefined);
        await connection.execute("DELETE FROM projects WHERE organizationId = ?", [id]).catch(() => undefined);
        await connection.execute("DELETE FROM team_members WHERE organizationId = ?", [id]).catch(() => undefined);
        await connection.execute("DELETE FROM users WHERE organizationId = ?", [id]).catch(() => undefined);
        await connection.execute("DELETE FROM organizations WHERE id = ?", [id]).catch(() => undefined);
      }
      await connection.end();
    }
    for (const pool of pools) await new Promise<void>((resolve) => (pool as any).end(() => resolve()));
    vi.doUnmock("mysql2");
    vi.resetModules();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }, 30000);

  it("notifies only on first assignment and reassignment to a linked same-organization login", async () => {
    await database.updateTask(assignedTaskId, { assigneeId: memberOne }, orgId);
    let notices = await countNotices(assignedTaskId);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      organizationId: orgId,
      userId: userOne,
      type: "general",
      title: TASK_ASSIGNMENT_NOTIFICATION_TITLE,
      relatedTaskId: assignedTaskId,
      relatedProjectId: projectId,
    });

    await database.updateTask(assignedTaskId, { title: `Edited unrelated field ${marker}`, assigneeId: memberOne }, orgId);
    expect(await countNotices(assignedTaskId)).toHaveLength(1);

    await database.updateTask(assignedTaskId, { assigneeId: memberTwo }, orgId);
    notices = await countNotices(assignedTaskId);
    expect(notices).toHaveLength(2);
    expect(notices.map((notice) => notice.userId)).toEqual(expect.arrayContaining([userOne, userTwo]));

    await database.updateTask(assignedTaskId, { assigneeId: null }, orgId);
    expect(await countNotices(assignedTaskId)).toHaveLength(2);
  });

  it("does not notify for unlinked team members or links to a foreign-organization login", async () => {
    const unlinkedTask = await makeTask(projectId, "Unlinked assignee");
    await database.updateTask(unlinkedTask, { assigneeId: unlinkedMember }, orgId);
    expect(await countNotices(unlinkedTask)).toHaveLength(0);

    const foreignTask = await makeTask(projectId, "Foreign linked login");
    await database.updateTask(foreignTask, { assigneeId: foreignLinkedMember }, orgId);
    expect(await countNotices(foreignTask)).toHaveLength(0);

    const inactiveTask = await makeTask(projectId, "Inactive assignee");
    await database.updateTask(inactiveTask, { assigneeId: inactiveMember }, orgId);
    expect(await countNotices(inactiveTask)).toHaveLength(0);

    const missingUserTask = await makeTask(projectId, "Missing login");
    await database.updateTask(missingUserTask, { assigneeId: missingUserMember }, orgId);
    expect(await countNotices(missingUserTask)).toHaveLength(0);

    await expect(database.updateTask(assignedTaskId, { assigneeId: 99999999 }, orgId)).rejects.toBeTruthy();
  });

  it("serializes concurrent assignment writes so one matching assignee gets one notice", async () => {
    const concurrentTask = await makeTask(projectId, "Concurrent assignment");
    await Promise.all([
      database.updateTask(concurrentTask, { assigneeId: memberOne }, orgId),
      database.updateTask(concurrentTask, { assigneeId: memberOne }, orgId),
    ]);
    expect(await countNotices(concurrentTask)).toHaveLength(1);
  });

  it("locks the project before the task so project deletion cannot invert update locks", async () => {
    const taskId = await makeTask(projectId, "Project-first lock order");
    const blocker = await createConnection(fixtureUrl().toString());
    const observer = await createConnection(fixtureUrl().toString());
    let pending: Promise<unknown> | undefined;
    try {
      await blocker.beginTransaction();
      await blocker.execute("SELECT id FROM projects WHERE id = ? FOR UPDATE", [projectId]);
      pending = database.updateTask(taskId, { assigneeId: memberOne }, orgId);
      void pending.catch(() => undefined);
      let waitingOnProject = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const [rows] = await connection.execute(
          "SELECT INFO FROM information_schema.PROCESSLIST WHERE USER = 'stage1' AND ID <> CONNECTION_ID() AND INFO LIKE '%from `projects`%' AND INFO LIKE '%for update%' AND INFO LIKE ?",
          [`%${projectId}%`],
        );
        if ((rows as unknown[]).length > 0) { waitingOnProject = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waitingOnProject).toBe(true);
      await observer.execute("SET SESSION innodb_lock_wait_timeout = 1");
      await observer.beginTransaction();
      // This would time out if the waiting updater already held the task row.
      await observer.execute("SELECT id FROM tasks WHERE id = ? FOR UPDATE", [taskId]);
      await observer.rollback();
      await blocker.commit();
      await pending;
      expect(await countNotices(taskId)).toHaveLength(1);
    } finally {
      await observer.rollback().catch(() => undefined);
      await blocker.rollback().catch(() => undefined);
      if (pending) await pending.catch(() => undefined);
      await observer.end();
      await blocker.end();
    }
  }, 10000);

  it("creates a notice for a linked assignee at task creation and removes it on task deletion", async () => {
    const created = await database.createTask({ projectId, assigneeId: memberOne, title: `Created assigned ${marker}` }, orgId);
    expect(await countNotices(created.id)).toHaveLength(1);
    await database.deleteTask(created.id, orgId);
    expect(await countNotices(created.id)).toHaveLength(0);
  });

  it("removes assignment notices atomically with task and project purges, including completed tasks", async () => {
    const doneTask = await makeTask(projectId, "Done task purge", "done", memberOne);
    await insert("notifications", {
      organizationId: orgId,
      userId: userOne,
      type: "general",
      title: TASK_ASSIGNMENT_NOTIFICATION_TITLE,
      message: "synthetic assignment notice",
      relatedTaskId: doneTask,
      relatedProjectId: projectId,
    });
    await database.purgeArchivedTasks(orgId);
    expect(await countNotices(doneTask)).toHaveLength(0);
    const [doneRows] = await connection.execute("SELECT id FROM tasks WHERE id = ?", [doneTask]);
    expect(doneRows).toHaveLength(0);

    const deleteProjectId = await makeProject("Project deletion");
    const deleteProjectTask = await makeTask(deleteProjectId, "Project deletion task", "todo", memberOne);
    await insert("notifications", {
      organizationId: orgId, userId: userOne, type: "general", title: TASK_ASSIGNMENT_NOTIFICATION_TITLE,
      message: "synthetic assignment notice", relatedTaskId: deleteProjectTask, relatedProjectId: deleteProjectId,
    });
    await database.deleteProject(deleteProjectId);
    expect(await countNotices(deleteProjectTask)).toHaveLength(0);

    const completedProject = await makeProject("Project purge", "completed");
    const completedTask = await makeTask(completedProject, "Completed project task", "done", memberOne);
    await insert("notifications", {
      organizationId: orgId, userId: userOne, type: "general", title: TASK_ASSIGNMENT_NOTIFICATION_TITLE,
      message: "synthetic assignment notice", relatedTaskId: completedTask, relatedProjectId: completedProject,
    });
    await database.purgeArchivedProjects(orgId);
    expect(await countNotices(completedTask)).toHaveLength(0);
    const [purgedRows] = await connection.execute("SELECT id FROM tasks WHERE id = ?", [completedTask]);
    expect(purgedRows).toHaveLength(0);
  }, 30000);
});
