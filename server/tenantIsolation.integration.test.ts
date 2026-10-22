import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { buildUserBillingRateMap } from "./projectBilling";

vi.mock("./_core/email", () => ({
  sendTeamInviteEmail: vi.fn().mockResolvedValue({ sent: false }),
  sendBillingMilestoneEmail: vi.fn().mockResolvedValue({ sent: false }),
}));
vi.mock("./_core/notification", () => ({ notifyOwner: vi.fn().mockResolvedValue(undefined) }));

const enabled = process.env.TENANT_ISOLATION_INTEGRATION === "1";
const databaseUrl = process.env.DATABASE_URL;

/**
 * This suite is deliberately opt-in and rejects every non-local or unexpected
 * database target before opening a connection. It only ever deletes fixture
 * rows created by this run (identified by its generated organization IDs).
 */
function assertSafeDatabaseTarget(): URL {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the tenant integration suite");
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid mysql:// URL");
  }
  const hostname = url.hostname.toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
    throw new Error(`Refusing tenant integration tests against non-local database host: ${hostname}`);
  }
  // Explicit localhost-only synthetic schemas; the legacy fixture is generated
  // from the runtime ORM, never copied from production.
  if (!["stage1_test", "studiotrac_stage1_test", "stage1_legacy_test"].includes(database)) {
    throw new Error(`Refusing tenant integration tests against database ${database}; expected an approved synthetic schema`);
  }
  return url;
}

if (enabled) assertSafeDatabaseTarget();

type Actor = { id: number; role: "admin" | "pm" | "user"; organizationId: number | null; orgRole: string; isSuperAdmin: boolean; name: string; email: string; openId: string };
type OrgFixture = {
  id: number;
  owner: Actor;
  admin: Actor;
  pm: Actor;
  user: Actor;
  extraUser: Actor;
  project: number;
  task: number;
  teamMember: number;
  invoice: number;
  note: number;
  file: number;
  notification: number;
  share: number;
  consultant: number;
  timeEntry: number;
  projectTeam: number;
  sheet: number;
  item: number;
  token: string;
  shareTokenValue: string;
  clientToken: string;
};

type DbConnection = {
  execute: (sql: string, values?: unknown[]) => Promise<[any, any]>;
  end: () => Promise<void>;
};

const suite = enabled ? describe : describe.skip;
suite("tenant isolation — isolated MariaDB integration", () => {
  let connection: DbConnection;
  let callerFor: (actor?: Actor | null) => any;
  let orgA: OrgFixture;
  let orgB: OrgFixture;
  let marker: string;
  let appRouter: any;
  let applicationDb: any;
  let databaseHelpers: any;
  const createdOrgIds: number[] = [];
  const createdUserIds: number[] = [];
  const createdTeamMemberIds: number[] = [];

  const insert = async (table: string, record: Record<string, unknown>): Promise<number> => {
    const columns = Object.keys(record);
    const placeholders = columns.map(() => "?").join(", ");
    const values = columns.map(key => record[key]);
    const [result] = await connection.execute(
      `INSERT INTO \`${table}\` (${columns.map(column => `\`${column}\``).join(", ")}) VALUES (${placeholders})`,
      values,
    );
    return Number(result.insertId);
  };

  const row = async (table: string, id: number): Promise<any> => {
    const [rows] = await connection.execute(`SELECT * FROM \`${table}\` WHERE id = ? LIMIT 1`, [id]);
    return rows[0];
  };

  const actor = (base: Actor): any => callerFor(base);
  const route = (caller: any, namespace: string, procedure: string, input?: any) => {
    const fn = caller[namespace][procedure];
    if (typeof fn !== "function") throw new Error(`Expected secured route ${namespace}.${procedure} to exist`);
    return input === undefined ? fn() : fn(input);
  };

  const expectInvisible = async (operation: () => Promise<any>, foreignId: number) => {
    let value: any;
    try {
      value = await operation();
    } catch {
      return; // NOT_FOUND/FORBIDDEN is a valid read-denial response.
    }
    const containsForeignId = (candidate: any): boolean => {
      if (candidate == null) return false;
      if (Array.isArray(candidate)) return candidate.some(containsForeignId);
      if (typeof candidate !== "object") return false;
      if (Number(candidate.id) === foreignId) return true;
      return Object.values(candidate).some(containsForeignId);
    };
    expect(containsForeignId(value), `foreign record id ${foreignId} was exposed`).toBe(false);
  };

  const expectUnchanged = async (
    operation: () => Promise<any>,
    table: string,
    id: number,
    expected: Record<string, unknown>,
  ) => {
    await expect(operation()).rejects.toBeTruthy();
    const actual = await row(table, id);
    expect(actual, `${table} ${id} must remain present`).toBeTruthy();
    for (const [column, value] of Object.entries(expected)) {
      expect(actual[column], `${table}.${column} for foreign id ${id}`).toEqual(value);
    }
  };

  const setupOrg = async (suffix: string): Promise<OrgFixture> => {
    const orgId = await insert("organizations", { name: `Tenant isolation ${suffix} ${marker}`, slug: `tenant-test-${suffix}-${marker}` });
    createdOrgIds.push(orgId);
    const makeUser = async (role: Actor["role"], who: string, options: { owner?: boolean; orgRole?: string } = {}): Promise<Actor> => {
      const email = `${who}-${suffix}-${marker}@example.invalid`;
      const id = await insert("users", {
        openId: `${marker}-${suffix}-${who}`,
        name: `${who} ${suffix} ${marker}`,
        email,
        passwordHash: "synthetic-hash",
        loginMethod: "email",
        role,
        organizationId: orgId,
        orgRole: options.orgRole ?? (options.owner ? "owner" : role === "admin" ? "admin" : "member"),
        isSuperAdmin: options.owner ? 1 : 0,
      });
      createdUserIds.push(id);
      return { id, role, organizationId: orgId, orgRole: options.orgRole ?? (options.owner ? "owner" : role === "admin" ? "admin" : "member"), isSuperAdmin: !!options.owner, name: `${who} ${suffix}`, email, openId: `${marker}-${suffix}-${who}` };
    };
    const owner = await makeUser("admin", "owner", { owner: true, orgRole: "owner" });
    const admin = await makeUser("admin", "admin");
    const pm = await makeUser("pm", "pm");
    const user = await makeUser("user", "user");
    const extraUser = await makeUser("user", "extra");
    const teamMember = await insert("team_members", {
      organizationId: orgId, userId: user.id, name: user.name, email: user.email,
      title: "Synthetic Designer", isActive: 1, billingRate: suffix === "a" ? 12500 : 22500,
    });
    createdTeamMemberIds.push(teamMember);
    const project = await insert("projects", {
      organizationId: orgId, name: `Project ${suffix} ${marker}`, clientName: `Client ${suffix}`,
      status: "on_track", phase: "pre_design", completionPercentage: 0,
      billing25: 0, billing50: 0, billing75: 0, billing100: 0, billingOk: 0,
      estimatedHours: 0, contractedFee: 0, invoicedAmount: 0, billingType: "fixed_fee",
      hourlyRateCents: 0, notToExceedCents: 0, revenueTargetCents: 0,
    });
    const task = await insert("tasks", { organizationId: orgId, projectId: project, assigneeId: teamMember, title: `Task ${suffix} ${marker}`, status: "todo", priority: 10, sortOrder: 0 });
    const invoice = await insert("invoices", { organizationId: orgId, projectId: project, amount: 50000, description: `Invoice ${suffix} ${marker}`, invoiceNumber: `INV-${suffix}-${marker}`, status: "draft", invoiceDate: new Date() });
    const note = await insert("project_notes", { organizationId: orgId, projectId: project, authorId: admin.id, content: `Note ${suffix} ${marker}` });
    const file = await insert("project_files", { projectId: project, uploadedById: admin.id, fileName: `file-${suffix}-${marker}.txt`, fileUrl: `/uploads/synthetic/${suffix}/${marker}.txt`, category: "other" });
    const notification = await insert("notifications", { organizationId: orgId, userId: user.id, type: "general", title: `Notification ${suffix} ${marker}`, message: "synthetic" , relatedProjectId: project });
    const token = `${marker}-${suffix}-share-token`;
    const share = await insert("client_share_tokens", { organizationId: orgId, projectId: project, token, label: `Share ${suffix}`, createdById: admin.id });
    const consultant = await insert("consultant_contracts", { organizationId: orgId, projectId: project, name: `Consultant ${suffix} ${marker}`, discipline: "structural", contractAmount: 100000 });
    const timeEntry = await insert("time_entries", { organizationId: orgId, userId: user.id, projectId: project, taskId: task, description: `Time ${suffix} ${marker}`, startTime: new Date("2024-01-01T09:00:00Z"), durationMinutes: 60, billable: 1 });
    const projectTeam = await insert("project_team_members", { projectId: project, teamMemberId: teamMember, role: "designer" });
    const sheetToken = `${marker}-${suffix}-coord-token`;
    const clientToken = `${marker}-${suffix}-coord-client-token`;
    const sheet = await insert("coordination_sheets", { organizationId: orgId, projectId: project, token: sheetToken, clientToken, projectName: `Project ${suffix}`, createdById: admin.id });
    const item = await insert("coordination_items", { sheetId: sheet, authorName: `Author ${suffix}`, authorType: "other", content: `Coordination ${suffix} ${marker}`, visibility: "internal" });
    return { id: orgId, owner, admin, pm, user, extraUser, project, task, teamMember, invoice, note, file, notification, share, consultant, timeEntry, projectTeam, sheet, item, token: sheetToken, shareTokenValue: token, clientToken };
  };

  beforeAll(async () => {
    assertSafeDatabaseTarget();
    marker = randomUUID().replaceAll("-", "");
    const mysql = await import("mysql2/promise");
    connection = await mysql.createConnection(databaseUrl!) as unknown as DbConnection;
    // Use the app's actual router and its real DB pool; only request context is
    // synthetic so no production login/session is involved.
    const [{ appRouter: router }, dbModule] = await Promise.all([
      import("./routers"), import("./db"),
    ]);
    appRouter = router;
    databaseHelpers = dbModule;
    const appDb = await dbModule.getDb();
    if (!appDb) throw new Error("Application DB pool did not connect to the safe local test schema");
    applicationDb = appDb;
    callerFor = (user?: Actor | null) => appRouter.createCaller({
      user: user ?? null,
      organizationId: user?.organizationId ?? null,
      req: {} as any,
      res: {} as any,
    });
    orgA = await setupOrg("a");
    orgB = await setupOrg("b");
  }, 30_000);

  afterAll(async () => {
    if (!connection || createdOrgIds.length === 0) return;
    const orgIds = createdOrgIds;
    const ids = (values: number[]) => values.join(",");
    const [projects] = await connection.execute(`SELECT id FROM projects WHERE organizationId IN (${ids(orgIds)})`);
    const projectIds = (projects as Array<{ id: number }>).map(record => Number(record.id));
    const [sheets] = await connection.execute(`SELECT id FROM coordination_sheets WHERE organizationId IN (${ids(orgIds)})`);
    const sheetIds = (sheets as Array<{ id: number }>).map(record => Number(record.id));
    const projectClause = projectIds.length ? `IN (${ids(projectIds)})` : "IN (-1)";
    const sheetClause = sheetIds.length ? `IN (${ids(sheetIds)})` : "IN (-1)";
    // These new organizations were created with a unique marker and started
    // empty, so org/project/sheet scoping limits cleanup strictly to this run.
    await connection.execute(`DELETE FROM coordination_attachments WHERE itemId IN (SELECT id FROM coordination_items WHERE sheetId ${sheetClause})`);
    await connection.execute(`DELETE FROM coordination_subscribers WHERE sheetId ${sheetClause}`);
    await connection.execute(`DELETE FROM coordination_sheet_views WHERE sheetId ${sheetClause}`);
    await connection.execute(`DELETE FROM coordination_items WHERE sheetId ${sheetClause}`);
    await connection.execute(`DELETE FROM coordination_sheets WHERE organizationId IN (${ids(orgIds)})`);
    await connection.execute(`DELETE FROM project_team_members WHERE projectId ${projectClause}`);
    await connection.execute(`DELETE FROM consultant_payments WHERE organizationId IN (${ids(orgIds)})`);
    await connection.execute(`DELETE FROM consultant_contracts WHERE organizationId IN (${ids(orgIds)})`);
    for (const table of ["time_entries", "notifications", "client_share_tokens", "project_notes", "invoices", "tasks", "team_members"]) {
      await connection.execute(`DELETE FROM \`${table}\` WHERE organizationId IN (${ids(orgIds)})`);
    }
    if (createdTeamMemberIds.length) {
      await connection.execute(`DELETE FROM team_members WHERE id IN (${ids(createdTeamMemberIds)})`);
    }
    await connection.execute(`DELETE FROM project_files WHERE projectId ${projectClause}`);
    if (projectIds.length) await connection.execute(`DELETE FROM projects WHERE id IN (${ids(projectIds)}) AND organizationId IN (${ids(orgIds)})`);
    if (createdUserIds.length) await connection.execute(`DELETE FROM users WHERE id IN (${ids(createdUserIds)})`);
    await connection.execute(`DELETE FROM organizations WHERE id IN (${ids(orgIds)}) AND slug LIKE CONCAT('tenant-test-%-', ?)`, [marker]);
    await connection.end();
  }, 30_000);

  it("scopes read/list/get access for admin, PM, user, org-less user and anonymous caller", async () => {
    const roles: Array<{ label: string; caller: any; shouldSeeOwn: boolean }> = [
      { label: "admin", caller: actor(orgA.admin), shouldSeeOwn: true },
      { label: "PM", caller: actor(orgA.pm), shouldSeeOwn: true },
      { label: "user", caller: actor(orgA.user), shouldSeeOwn: true },
      { label: "organization-less", caller: callerFor({ ...orgA.user, id: orgA.extraUser.id, organizationId: null }), shouldSeeOwn: false },
      { label: "anonymous", caller: callerFor(null), shouldSeeOwn: false },
    ];
    // Exercise each actor through the same secured endpoints. Some lists are
    // intentionally admin/PM-only, while notifications are user-private.
    for (const { label, caller, shouldSeeOwn } of roles) {
      const readCases: Array<{ label: string; own: () => Promise<any>; foreign: () => Promise<any>; ownId: number; foreignId: number; roles?: string[] }> = [
        { label: "projects", own: () => route(caller, "projects", "list"), foreign: () => route(caller, "projects", "get", { id: orgB.project }), ownId: orgA.project, foreignId: orgB.project },
        { label: "tasks", own: () => route(caller, "tasks", "list"), foreign: () => route(caller, "tasks", "get", { id: orgB.task }), ownId: orgA.task, foreignId: orgB.task },
        { label: "team members", own: () => route(caller, "teamMembers", "list"), foreign: () => route(caller, "teamMembers", "get", { id: orgB.teamMember }), ownId: orgA.teamMember, foreignId: orgB.teamMember },
        { label: "invoices", own: () => route(caller, "invoices", "list", { projectId: orgA.project }), foreign: () => route(caller, "invoices", "list", { projectId: orgB.project }), ownId: orgA.invoice, foreignId: orgB.invoice, roles: ["admin", "PM"] },
        { label: "files", own: () => route(caller, "files", "list", { projectId: orgA.project }), foreign: () => route(caller, "files", "list", { projectId: orgB.project }), ownId: orgA.file, foreignId: orgB.file },
        { label: "notes", own: () => route(caller, "notes", "list", { projectId: orgA.project }), foreign: () => route(caller, "notes", "list", { projectId: orgB.project }), ownId: orgA.note, foreignId: orgB.note },
        { label: "consultants", own: () => route(caller, "consultants", "list", { projectId: orgA.project }), foreign: () => route(caller, "consultants", "list", { projectId: orgB.project }), ownId: orgA.consultant, foreignId: orgB.consultant, roles: ["admin", "PM"] },
        { label: "time entries", own: () => route(caller, "timeEntries", "list"), foreign: () => route(caller, "timeEntries", "list", { projectId: orgB.project }), ownId: orgA.timeEntry, foreignId: orgB.timeEntry },
        { label: "notifications", own: () => route(caller, "notifications", "list"), foreign: () => route(caller, "notifications", "list"), ownId: orgA.notification, foreignId: orgB.notification, roles: ["user"] },
        { label: "project team", own: () => route(caller, "projectTeam", "list", { projectId: orgA.project }), foreign: () => route(caller, "projectTeam", "list", { projectId: orgB.project }), ownId: orgA.projectTeam, foreignId: orgB.projectTeam },
        { label: "coordination", own: () => route(caller, "coordination", "getForProject", { projectId: orgA.project }), foreign: () => route(caller, "coordination", "getForProject", { projectId: orgB.project }), ownId: orgA.sheet, foreignId: orgB.sheet },
        { label: "share tokens", own: () => route(caller, "shareTokens", "list", { projectId: orgA.project }), foreign: () => route(caller, "shareTokens", "list", { projectId: orgB.project }), ownId: orgA.share, foreignId: orgB.share },
      ];
      for (const testCase of readCases) {
        let ownResult: any = null;
        try { ownResult = await testCase.own(); } catch { /* role-gated or no-org access is valid */ }
        const canReadSameOrg = shouldSeeOwn && (!testCase.roles || testCase.roles.includes(label));
        if (canReadSameOrg) {
          expect(JSON.stringify(ownResult), `${label} should see own ${testCase.label}`).toContain(String(testCase.ownId));
        } else if (!shouldSeeOwn) {
          expect(JSON.stringify(ownResult), `${label} must not receive scoped ${testCase.label}`).not.toContain(String(testCase.ownId));
        }
        await expectInvisible(testCase.foreign, testCase.foreignId);
      }
    }
    // Public share links are intentionally capability-based. A valid token works
    // without a caller; an unrelated token cannot resolve a record.
    const publicCaller = callerFor(null);
    expect((await route(publicCaller, "portal", "getProject", { token: orgA.shareTokenValue })).error).toBeNull();
    expect((await route(publicCaller, "coordination", "getByToken", { token: orgA.token })).error).toBeNull();
    const clientView = await route(publicCaller, "coordination", "getByClientToken", { clientToken: orgA.clientToken });
    expect(clientView.error).toBeNull();
    expect(clientView.items.some((item: any) => item.id === orgA.item)).toBe(false);
    expect(clientView.sheet).not.toHaveProperty("token");
    expect(clientView.sheet).not.toHaveProperty("clientToken");
    expect(JSON.stringify(clientView)).not.toContain(orgA.token);
    const internalContent = (await row("coordination_items", orgA.item)).content;
    await expect(route(publicCaller, "coordination", "updateItem", {
      token: orgA.clientToken, itemId: orgA.item, content: `client-edit-${marker}`,
    })).rejects.toBeTruthy();
    await expect(route(publicCaller, "coordination", "deleteItem", {
      token: orgA.clientToken, itemId: orgA.item,
    })).rejects.toBeTruthy();
    expect((await row("coordination_items", orgA.item)).content).toBe(internalContent);
    const invalid = await route(publicCaller, "portal", "getProject", { token: `${marker}-not-a-token` });
    expect(invalid.data).toBeNull();
  });

  it("builds billing-rate maps from the real Drizzle client with tenant-local legacy fallbacks", async () => {
    const collisionEmail = `legacy-collision-${marker}@example.invalid`;
    await connection.execute("UPDATE users SET email = ? WHERE id IN (?, ?)", [collisionEmail, orgA.extraUser.id, orgB.extraUser.id]);
    const legacyA = await insert("team_members", {
      organizationId: orgA.id, userId: null, name: `Legacy A ${marker}`, email: collisionEmail,
      billingRate: 11111,
    });
    const legacyB = await insert("team_members", {
      organizationId: orgB.id, userId: null, name: `Legacy B ${marker}`, email: collisionEmail,
      billingRate: 22222,
    });
    createdTeamMemberIds.push(legacyA, legacyB);

    // Exercise the real query path with the application's Drizzle connection,
    // not raw SQL or a mocked DbClient.
    const ratesA = await buildUserBillingRateMap(applicationDb, orgA.id);
    const ratesB = await buildUserBillingRateMap(applicationDb, orgB.id);
    expect(ratesA.get(orgA.user.id)).toBe(12500);
    expect(ratesA.get(orgA.extraUser.id)).toBe(11111);
    expect(ratesA.has(orgB.user.id)).toBe(false);
    expect(ratesA.has(orgB.extraUser.id)).toBe(false);
    expect(ratesB.get(orgB.user.id)).toBe(22500);
    expect(ratesB.get(orgB.extraUser.id)).toBe(22222);
    expect(ratesB.has(orgA.user.id)).toBe(false);
  });

  it("blocks cross-tenant mutations and foreign referenced IDs while preserving the other tenant's rows", async () => {
    const adminA = actor(orgA.admin);
    const pmA = actor(orgA.pm);
    const userA = actor(orgA.user);
    const anonymous = callerFor(null);
    const initialB = {
      project: (await row("projects", orgB.project)).name,
      task: (await row("tasks", orgB.task)).title,
      teamMember: (await row("team_members", orgB.teamMember)).name,
      invoice: (await row("invoices", orgB.invoice)).amount,
      note: (await row("project_notes", orgB.note)).content,
      file: (await row("project_files", orgB.file)).fileName,
      consultant: (await row("consultant_contracts", orgB.consultant)).name,
      timeEntry: (await row("time_entries", orgB.timeEntry)).description,
      notification: (await row("notifications", orgB.notification)).title,
      share: (await row("client_share_tokens", orgB.share)).label,
      item: (await row("coordination_items", orgB.item)).content,
    };
    // Every authenticated role must be denied both cross-tenant writes and
    // deletes; rejection is required, not merely a successful no-op.
    for (const { label, caller } of [
      { label: "admin", caller: adminA },
      { label: "PM", caller: pmA },
      { label: "staff", caller: userA },
    ]) {
      await expect(route(caller, "projects", "update", { id: orgB.project, name: `cross-${label}-${marker}` })).rejects.toBeTruthy();
      await expect(route(caller, "projects", "delete", { id: orgB.project })).rejects.toBeTruthy();
      await expect(route(caller, "tasks", "update", { id: orgB.task, title: `cross-${label}-${marker}` })).rejects.toBeTruthy();
      await expect(route(caller, "tasks", "delete", { id: orgB.task })).rejects.toBeTruthy();
      expect((await row("projects", orgB.project)).name).toBe(`Project b ${marker}`);
      expect((await row("tasks", orgB.task)).title).toBe(`Task b ${marker}`);
    }
    const mutations: Array<{ label: string; table: string; id: number; column: string; before: any; run: () => Promise<any> }> = [
      { label: "project update", table: "projects", id: orgB.project, column: "name", before: initialB.project, run: () => route(adminA, "projects", "update", { id: orgB.project, name: `cross-${marker}` }) },
      { label: "project PM update", table: "projects", id: orgB.project, column: "name", before: initialB.project, run: () => route(pmA, "projects", "update", { id: orgB.project, name: `cross-pm-${marker}` }) },
      { label: "project delete", table: "projects", id: orgB.project, column: "name", before: initialB.project, run: () => route(adminA, "projects", "delete", { id: orgB.project }) },
      { label: "task update", table: "tasks", id: orgB.task, column: "title", before: initialB.task, run: () => route(userA, "tasks", "update", { id: orgB.task, title: `cross-${marker}` }) },
      { label: "task PM update", table: "tasks", id: orgB.task, column: "title", before: initialB.task, run: () => route(pmA, "tasks", "update", { id: orgB.task, title: `cross-pm-${marker}` }) },
      { label: "task delete", table: "tasks", id: orgB.task, column: "title", before: initialB.task, run: () => route(adminA, "tasks", "delete", { id: orgB.task }) },
      { label: "team member update", table: "team_members", id: orgB.teamMember, column: "name", before: initialB.teamMember, run: () => route(adminA, "teamMembers", "update", { id: orgB.teamMember, name: `cross-${marker}` }) },
      { label: "team member delete", table: "team_members", id: orgB.teamMember, column: "isActive", before: 1, run: () => route(adminA, "teamMembers", "delete", { id: orgB.teamMember }) },
      { label: "invoice delete", table: "invoices", id: orgB.invoice, column: "amount", before: initialB.invoice, run: () => route(adminA, "invoices", "delete", { id: orgB.invoice }) },
      { label: "invoice update", table: "invoices", id: orgB.invoice, column: "description", before: (await row("invoices", orgB.invoice)).description, run: () => route(adminA, "invoices", "update", { id: orgB.invoice, description: `cross-${marker}` }) },
      { label: "note update", table: "project_notes", id: orgB.note, column: "content", before: initialB.note, run: () => route(userA, "notes", "update", { id: orgB.note, content: `cross-${marker}` }) },
      { label: "note delete", table: "project_notes", id: orgB.note, column: "content", before: initialB.note, run: () => route(adminA, "notes", "delete", { id: orgB.note }) },
      { label: "file delete", table: "project_files", id: orgB.file, column: "fileName", before: initialB.file, run: () => route(adminA, "files", "delete", { id: orgB.file }) },
      { label: "consultant update", table: "consultant_contracts", id: orgB.consultant, column: "name", before: initialB.consultant, run: () => route(adminA, "consultants", "update", { id: orgB.consultant, name: `cross-${marker}` }) },
      { label: "consultant delete", table: "consultant_contracts", id: orgB.consultant, column: "name", before: initialB.consultant, run: () => route(adminA, "consultants", "delete", { id: orgB.consultant }) },
      { label: "time entry update", table: "time_entries", id: orgB.timeEntry, column: "description", before: initialB.timeEntry, run: () => route(userA, "timeEntries", "update", { id: orgB.timeEntry, description: `cross-${marker}` }) },
      { label: "time entry delete", table: "time_entries", id: orgB.timeEntry, column: "description", before: initialB.timeEntry, run: () => route(pmA, "timeEntries", "delete", { id: orgB.timeEntry }) },
      { label: "notification read", table: "notifications", id: orgB.notification, column: "isRead", before: 0, run: () => route(userA, "notifications", "markRead", { id: orgB.notification }) },
      { label: "project team remove", table: "project_team_members", id: orgB.projectTeam, column: "role", before: "designer", run: () => route(adminA, "projectTeam", "remove", { id: orgB.projectTeam }) },
      { label: "coordination sheet update", table: "coordination_sheets", id: orgB.sheet, column: "sharedFolderUrl", before: null, run: () => route(adminA, "coordination", "update", { id: orgB.sheet, sharedFolderUrl: "https://example.invalid/cross" }) },
      { label: "coordination sheet delete", table: "coordination_sheets", id: orgB.sheet, column: "projectName", before: `Project b`, run: () => route(adminA, "coordination", "delete", { id: orgB.sheet }) },
      { label: "coordination item update by foreign item ID", table: "coordination_items", id: orgB.item, column: "content", before: initialB.item, run: () => route(anonymous, "coordination", "updateItem", { token: orgA.token, itemId: orgB.item, content: `cross-${marker}` }) },
      { label: "share token revoke", table: "client_share_tokens", id: orgB.share, column: "isActive", before: 1, run: () => route(adminA, "shareTokens", "revoke", { id: orgB.share }) },
    ];
    for (const mutation of mutations) {
      await expectUnchanged(mutation.run, mutation.table, mutation.id, { [mutation.column]: mutation.before });
    }
    // Foreign project/member/task references cannot be smuggled into otherwise
    // authorized writes. Verify every attempted insert leaves no marker row.
    const expectNoMarker = async (table: string, column: string) => {
      const [rows] = await connection.execute(`SELECT id FROM \`${table}\` WHERE \`${column}\` = ?`, [`cross-ref-${marker}`]);
      expect(rows).toHaveLength(0);
    };
    const invalidWrites: Array<{ table: string; column: string; run: () => Promise<any> }> = [
      { table: "tasks", column: "title", run: () => route(adminA, "tasks", "create", { projectId: orgB.project, title: `cross-ref-${marker}` }) },
      { table: "project_notes", column: "content", run: () => route(userA, "notes", "create", { projectId: orgB.project, content: `cross-ref-${marker}` }) },
      { table: "invoices", column: "description", run: () => route(adminA, "invoices", "create", { projectId: orgB.project, amount: 1, description: `cross-ref-${marker}` }) },
      { table: "time_entries", column: "description", run: () => route(userA, "timeEntries", "create", { projectId: orgB.project, taskId: orgA.task, startTime: new Date("2024-01-01T09:00:00Z"), durationMinutes: 5, description: `cross-ref-${marker}` }) },
      { table: "project_files", column: "fileName", run: () => route(userA, "files", "upload", { projectId: orgB.project, fileName: `cross-ref-${marker}`, fileData: "dGVzdA==" }) },
      { table: "client_share_tokens", column: "label", run: () => route(userA, "shareTokens", "create", { projectId: orgB.project, label: `cross-ref-${marker}` }) },
      { table: "consultant_contracts", column: "name", run: () => route(adminA, "consultants", "create", { projectId: orgB.project, name: `cross-ref-${marker}`, discipline: "structural", contractAmount: 100 }) },
      { table: "time_entries", column: "description", run: () => route(userA, "timeEntries", "create", { projectId: orgA.project, taskId: orgB.task, startTime: new Date("2024-01-01T09:00:00Z"), durationMinutes: 5, description: `cross-ref-${marker}` }) },
    ];
    for (const write of invalidWrites) {
      await expect(write.run()).rejects.toBeTruthy();
      await expectNoMarker(write.table, write.column);
    }
    const forbiddenReferences: Array<() => Promise<any>> = [
      () => route(adminA, "projectTeam", "add", { projectId: orgA.project, teamMemberId: orgB.teamMember, role: "designer" }),
      () => route(adminA, "projects", "create", { name: `cross-ref-${marker}`, projectManagerId: orgB.teamMember }),
      () => route(userA, "tasks", "update", { id: orgA.task, assigneeId: orgB.teamMember }),
      () => route(adminA, "consultants", "update", { id: orgA.consultant, projectId: orgB.project }),
      () => route(userA, "timeEntries", "update", { id: orgA.timeEntry, projectId: orgB.project }),
      () => route(anonymous, "coordination", "addItem", { token: orgA.token, parentId: orgB.item, authorName: "Synthetic", authorType: "other", content: `cross-ref-${marker}` }),
      () => route(adminA, "coordination", "create", { projectId: orgB.project, projectName: `cross-ref-${marker}` }),
    ];
    for (const attempt of forbiddenReferences) await expect(attempt()).rejects.toBeTruthy();
    const [badTeamLinks] = await connection.execute("SELECT id FROM project_team_members WHERE projectId = ? AND teamMemberId = ?", [orgA.project, orgB.teamMember]);
    expect(badTeamLinks).toHaveLength(0);
    const [badProject] = await connection.execute("SELECT id FROM projects WHERE name = ?", [`cross-ref-${marker}`]);
    expect(badProject).toHaveLength(0);
    expect((await row("tasks", orgA.task)).assigneeId).toBe(orgA.teamMember);
    expect((await row("consultant_contracts", orgA.consultant)).projectId).toBe(orgA.project);
    expect((await row("time_entries", orgA.timeEntry)).projectId).toBe(orgA.project);
    const orgless = callerFor({ ...orgA.user, organizationId: null });
    for (const caller of [orgless, anonymous]) {
      await expect(route(caller, "tasks", "create", { projectId: orgA.project, title: `cross-ref-${marker}` })).rejects.toBeTruthy();
      await expect(route(caller, "projects", "delete", { id: orgA.project })).rejects.toBeTruthy();
      await expect(route(caller, "notes", "create", { projectId: orgA.project, content: `cross-ref-${marker}` })).rejects.toBeTruthy();
      await expect(route(caller, "tasks", "delete", { id: orgA.task })).rejects.toBeTruthy();
    }
    expect((await row("projects", orgA.project)).name).toContain(`Project a ${marker}`);
  });

  it("allows same-organization controls, but blocks admin user-management across organizations", async () => {
    const adminA = actor(orgA.admin);
    const projectName = `Same-org update ${marker}`;
    await route(adminA, "projects", "update", { id: orgA.project, name: projectName });
    expect((await row("projects", orgA.project)).name).toBe(projectName);
    await route(adminA, "notes", "create", { projectId: orgA.project, content: `Same-org note ${marker}` });
    const [ownNotes] = await connection.execute("SELECT id FROM project_notes WHERE projectId = ? AND content = ?", [orgA.project, `Same-org note ${marker}`]);
    expect(ownNotes).toHaveLength(1);
    await route(adminA, "shareTokens", "create", { projectId: orgA.project, label: `Same-org share ${marker}` });
    const [ownShares] = await connection.execute("SELECT id FROM client_share_tokens WHERE projectId = ? AND label = ? AND organizationId = ?", [orgA.project, `Same-org share ${marker}`, orgA.id]);
    expect(ownShares).toHaveLength(1);

    const originalB = await row("users", orgB.user.id);
    const adminOps: Array<{ label: string; run: () => Promise<any> }> = [
      { label: "resetPassword", run: () => route(adminA, "teamMembers", "resetPassword", { userId: orgB.user.id, newPassword: "safe-synthetic-password" }) },
      { label: "updateRole", run: () => route(adminA, "teamMembers", "updateRole", { userId: orgB.user.id, role: "pm" }) },
      { label: "removeUser", run: () => route(adminA, "teamMembers", "removeUser", { userId: orgB.user.id }) },
    ];
    for (const operation of adminOps) {
      await expect(operation.run()).rejects.toBeTruthy();
      const unchanged = await row("users", orgB.user.id);
      expect(unchanged.organizationId, `${operation.label} must not change foreign membership`).toBe(originalB.organizationId);
      expect(unchanged.role, `${operation.label} must not change foreign role`).toBe(originalB.role);
      expect(unchanged.passwordHash, `${operation.label} must not change foreign password`).toBe(originalB.passwordHash);
    }
    const nonAdminActors = [actor(orgA.pm), actor(orgA.user), callerFor({ ...orgA.user, organizationId: null }), callerFor(null)];
    for (const caller of nonAdminActors) {
      await expect(route(caller, "teamMembers", "resetPassword", { userId: orgA.extraUser.id, newPassword: "safe-synthetic-password" })).rejects.toBeTruthy();
      await expect(route(caller, "teamMembers", "updateRole", { userId: orgA.extraUser.id, role: "pm" })).rejects.toBeTruthy();
      await expect(route(caller, "teamMembers", "removeUser", { userId: orgA.extraUser.id })).rejects.toBeTruthy();
    }
    await route(adminA, "teamMembers", "updateRole", { userId: orgA.extraUser.id, role: "pm" });
    expect((await row("users", orgA.extraUser.id)).role).toBe("pm");
    await route(adminA, "teamMembers", "resetPassword", { userId: orgA.extraUser.id, newPassword: "safe-synthetic-password" });
    expect((await row("users", orgA.extraUser.id)).passwordHash).not.toBe("synthetic-hash");
    await route(adminA, "teamMembers", "removeUser", { userId: orgA.extraUser.id });
    expect((await row("users", orgA.extraUser.id)).organizationId).toBeNull();
  });

  it("keeps same-email identities and invitations tenant-local", async () => {
    const collisionEmail = `shared-${marker}@example.invalid`;
    await connection.execute("UPDATE users SET email = ? WHERE id IN (?, ?)", [collisionEmail, orgA.user.id, orgB.user.id]);
    const listA = await route(actor(orgA.admin), "teamMembers", "listUsers");
    const listB = await route(actor(orgB.admin), "teamMembers", "listUsers");
    expect(listA.filter((u: any) => u.email === collisionEmail).map((u: any) => u.id)).toEqual([orgA.user.id]);
    expect(listB.filter((u: any) => u.email === collisionEmail).map((u: any) => u.id)).toEqual([orgB.user.id]);
    await expectInvisible(() => route(actor(orgA.admin), "teamMembers", "listUsers"), orgB.user.id);
    await expectInvisible(() => route(actor(orgB.admin), "teamMembers", "listUsers"), orgA.user.id);

    // The same email may be invited independently in another tenant; the new
    // placeholder must belong to the inviter's org, never attach to the foreign user.
    const invitedName = `Collision invite ${marker}`;
    await route(actor(orgA.admin), "teamMembers", "invite", {
      name: invitedName, email: collisionEmail, origin: "http://localhost:5173", role: "user",
    });
    const [invites] = await connection.execute(
      "SELECT id, organizationId, userId, email FROM team_members WHERE organizationId = ? AND name = ? AND email = ?",
      [orgA.id, invitedName, collisionEmail],
    );
    expect(invites).toHaveLength(1);
    expect(invites[0].organizationId).toBe(orgA.id);
    expect(invites[0].userId).toBeNull();
    expect((await row("users", orgB.user.id)).organizationId).toBe(orgB.id);
  });

  it("atomically consumes only current, active, unclaimed invitations for signup", async () => {
    const createInvite = async (suffix: string, organizationId = orgA.id, userId: number | null = null) => {
      const email = `signup-${suffix}-${marker}@example.invalid`;
      const memberId = await insert("team_members", {
        organizationId, userId, name: `Signup ${suffix} ${marker}`, email, isActive: 1,
      });
      createdTeamMemberIds.push(memberId);
      const member = await databaseHelpers.getTeamMember(memberId);
      return { memberId, email, updatedAt: new Date(member.updatedAt).getTime() };
    };
    const account = (email: string, suffix: string, organizationId = orgA.id) => ({
      openId: `signup-${suffix}-${marker}`,
      name: `Signup ${suffix} ${marker}`,
      email,
      passwordHash: null,
      loginMethod: "email",
      role: "user" as const,
      organizationId,
      orgRole: "member" as const,
      isSuperAdmin: false,
    });
    const expectNoSignup = async (email: string, openId: string, invite: { teamMemberId: number; teamMemberUpdatedAt: number }) => {
      await expect(databaseHelpers.createInvitedUserForSignup(account(email, openId), invite)).rejects.toBeTruthy();
      const [rows] = await connection.execute("SELECT id FROM users WHERE openId = ? OR LOWER(email) = ?", [openId, email.toLowerCase()]);
      expect(rows).toHaveLength(0);
    };

    const stale = await createInvite("stale");
    await connection.execute("UPDATE team_members SET updatedAt = DATE_ADD(updatedAt, INTERVAL 2 SECOND) WHERE id = ?", [stale.memberId]);
    await expectNoSignup(stale.email, `signup-stale-${marker}`, { teamMemberId: stale.memberId, teamMemberUpdatedAt: stale.updatedAt });

    const inactive = await createInvite("inactive");
    await connection.execute("UPDATE team_members SET isActive = 0 WHERE id = ?", [inactive.memberId]);
    await expectNoSignup(inactive.email, `signup-inactive-${marker}`, { teamMemberId: inactive.memberId, teamMemberUpdatedAt: inactive.updatedAt });

    const wrongOrg = await createInvite("wrong-org", orgB.id);
    await expectNoSignup(wrongOrg.email, `signup-wrong-org-${marker}`, { teamMemberId: wrongOrg.memberId, teamMemberUpdatedAt: wrongOrg.updatedAt });

    const claimed = await createInvite("claimed", orgA.id, orgA.user.id);
    await expectNoSignup(claimed.email, `signup-claimed-${marker}`, { teamMemberId: claimed.memberId, teamMemberUpdatedAt: claimed.updatedAt });

    const valid = await createInvite("valid");
    const validOpenId = `signup-valid-${marker}`;
    const validAccount = account(valid.email, "valid");
    const created = await databaseHelpers.createInvitedUserForSignup(validAccount, {
      teamMemberId: valid.memberId, teamMemberUpdatedAt: valid.updatedAt,
    });
    createdUserIds.push(created.id);
    expect(created.organizationId).toBe(orgA.id);
    expect((await row("team_members", valid.memberId)).userId).toBe(created.id);
    await expect(databaseHelpers.createInvitedUserForSignup(validAccount, {
      teamMemberId: valid.memberId, teamMemberUpdatedAt: valid.updatedAt,
    })).rejects.toBeTruthy();
    const [createdRows] = await connection.execute("SELECT id FROM users WHERE openId = ?", [validOpenId]);
    expect(createdRows).toHaveLength(1);

    const raceEmail = `signup-race-${marker}@example.invalid`;
    const originalA = await row("users", orgA.user.id);
    const originalB = await row("users", orgB.user.id);
    const concurrent = await Promise.allSettled([
      databaseHelpers.createUserForSignup(account(raceEmail, "race-a", orgA.id)),
      databaseHelpers.createUserForSignup(account(raceEmail.toUpperCase(), "race-b", orgB.id)),
    ]);
    const successes = concurrent.filter((result: any) => result.status === "fulfilled") as PromiseFulfilledResult<any>[];
    const failures = concurrent.filter((result: any) => result.status === "rejected") as PromiseRejectedResult[];
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    createdUserIds.push(successes[0].value.id);
    const [raceRows] = await connection.execute("SELECT id, openId, organizationId FROM users WHERE LOWER(email) = ?", [raceEmail]);
    expect(raceRows).toHaveLength(1);
    expect(raceRows[0].id).toBe(successes[0].value.id);
    expect((await row("users", orgA.user.id)).organizationId).toBe(originalA.organizationId);
    expect((await row("users", orgA.user.id)).role).toBe(originalA.role);
    expect((await row("users", orgA.user.id)).passwordHash).toBe(originalA.passwordHash);
    expect((await row("users", orgB.user.id)).organizationId).toBe(originalB.organizationId);
    expect((await row("users", orgB.user.id)).role).toBe(originalB.role);
    expect((await row("users", orgB.user.id)).passwordHash).toBe(originalB.passwordHash);
  });
});
