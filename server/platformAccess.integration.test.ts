import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createConnection } from "mysql2/promise";

// This suite is the only ordinary Vitest suite that opts into the real store.
vi.unmock("./platformAccessStore");

const enabled = process.env.PLATFORM_ACCESS_INTEGRATION === "1";
const configuredUrl = process.env.PLATFORM_ACCESS_DATABASE_URL;
const suite = enabled ? describe : describe.skip;

type Connection = {
  execute: (sql: string, values?: unknown[]) => Promise<[any, any]>;
  end: () => Promise<void>;
};

function safeFixtureUrl(): URL {
  if (!configuredUrl) throw new Error("PLATFORM_ACCESS_DATABASE_URL is required when PLATFORM_ACCESS_INTEGRATION=1");
  let url: URL;
  try { url = new URL(configuredUrl); } catch { throw new Error("PLATFORM_ACCESS_DATABASE_URL must be a valid mysql:// URL"); }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!["mysql:", "mariadb:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase()) ||
      url.username !== "stage1" || database !== "stage2_platform_access_test" || !url.password) {
    throw new Error("Refusing platform access integration tests outside the dedicated localhost stage2_platform_access_test fixture and synthetic stage1 account");
  }
  return url;
}

function stableJson(rows: unknown[]): string {
  return JSON.stringify(rows, (_key, value) => value instanceof Date ? value.toISOString() : typeof value === "bigint" ? value.toString() : value);
}

suite("platform access store — isolated synthetic MariaDB integration", () => {
  let connection: Connection;
  let store: typeof import("./platformAccessStore");
  let savedDatabaseUrl: string | undefined;
  let marker: string;
  let actorUserId: number;
  let protectedOrganizationId: number;
  let paidOrganizationId: number;
  let paidProjectId: number;
  let baselineCounts: Record<string, number>;
  let baselinePaidRows: { subscriptions: string; billingPhases: string[]; projects: string[] };

  const insert = async (table: string, record: Record<string, unknown>): Promise<number> => {
    const columns = Object.keys(record);
    const [result] = await connection.execute(
      `INSERT INTO \`${table}\` (${columns.map(column => `\`${column}\``).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      columns.map(column => record[column]),
    );
    return Number(result.insertId);
  };

  const rows = async (sql: string, values: unknown[] = []): Promise<any[]> => {
    const [result] = await connection.execute(sql, values);
    return result as any[];
  };

  const count = async (table: string): Promise<number> => {
    const result = await rows(`SELECT COUNT(*) AS n FROM \`${table}\``);
    return Number(result[0].n);
  };

  const snapshotProtectedBusinessData = async () => ({
    subscriptions: stableJson(await rows("SELECT * FROM subscriptions ORDER BY id")),
    billingPhases: (await rows("SELECT * FROM project_billing_phases ORDER BY id")).map(row => stableJson([row])),
    projects: (await rows("SELECT * FROM projects ORDER BY id")).map(row => stableJson([row])),
  });

  const expectBusinessDataUnchanged = async () => {
    expect(await snapshotProtectedBusinessData()).toEqual(baselinePaidRows);
    for (const [table, expected] of Object.entries(baselineCounts)) expect(await count(table)).toBe(expected);
  };

  beforeAll(async () => {
    const url = safeFixtureUrl();
    savedDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url.toString();
    marker = randomUUID().replaceAll("-", "");
    connection = await createConnection(url.toString()) as unknown as Connection;

    // Modules are loaded only after the explicit synthetic DATABASE_URL is set.
    vi.resetModules();
    vi.unmock("./platformAccessStore");
    store = await import("./platformAccessStore");

    const protectedName = `Peter Synthetic Owner ${marker}`;
    protectedOrganizationId = await insert("organizations", {
      name: protectedName,
      slug: `peter-protected-${marker}`,
      trialStartedAt: null,
    });
    actorUserId = await insert("users", {
      openId: `synthetic-platform-owner-${marker}`,
      name: protectedName,
      email: `peter-owner-${marker}@example.invalid`,
      passwordHash: "synthetic-test-hash-not-a-credential",
      loginMethod: "email",
      role: "admin",
      organizationId: protectedOrganizationId,
      orgRole: "owner",
      isSuperAdmin: 1,
    });

    paidOrganizationId = await insert("organizations", {
      name: `Synthetic paid workspace ${marker}`,
      slug: `paid-workspace-${marker}`,
      trialStartedAt: null,
    });
    const paidUserId = await insert("users", {
      openId: `synthetic-paid-owner-${marker}`,
      name: `Synthetic Paid Owner ${marker}`,
      email: `paid-owner-${marker}@example.invalid`,
      passwordHash: "synthetic-test-hash-not-a-credential",
      loginMethod: "email",
      role: "admin",
      organizationId: paidOrganizationId,
      orgRole: "owner",
      isSuperAdmin: 0,
    });
    paidProjectId = await insert("projects", {
      organizationId: paidOrganizationId,
      name: `Synthetic historical project ${marker}`,
      status: "on_track",
      phase: "pre_design",
      contractedFee: 875000,
      billingType: "fixed_fee",
    });
    await insert("project_billing_phases", {
      organizationId: paidOrganizationId,
      projectId: paidProjectId,
      billingType: "fixed_fee",
      startedAt: new Date("2025-01-01T00:00:00.000Z"),
      contractedFee: 875000,
      hourlyRateCents: 0,
      notToExceedCents: 0,
      revenueTargetCents: 0,
      notes: "Synthetic immutable historical billing fixture",
    });
    await insert("subscriptions", {
      organizationId: paidOrganizationId,
      userId: paidUserId,
      stripeSubscriptionId: `sub_synthetic_${marker}`,
      stripeCustomerId: `cus_synthetic_${marker}`,
      stripePriceId: `price_synthetic_${marker}`,
      plan: "professional",
      status: "active",
      currentPeriodStart: new Date("2025-01-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
    });

    baselineCounts = {};
    for (const table of ["projects", "project_billing_phases", "subscriptions", "invoices", "tasks", "time_entries"]) baselineCounts[table] = await count(table);
    baselinePaidRows = await snapshotProtectedBusinessData();
  }, 30_000);

  afterAll(async () => {
    if (connection) await connection.end();
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
  });

  it("atomically creates a pending no-trial/no-plan tenant and rejects email collision and replay", async () => {
    const invitedEmail = `  invitee-${marker}@Example.Invalid `;
    const issued = await store.issueFirmOwnerInvitation({
      email: invitedEmail,
      firmName: `Synthetic invited firm ${marker}`,
      actorUserId,
      origin: "https://local.example.test",
    });
    const token = new URL(issued.invitationUrl).searchParams.get("firmInvite");
    expect(token).toBeTruthy();
    const preview = await store.previewFirmOwnerInvitation(token!);
    expect(preview).toMatchObject({ email: `invitee-${marker}@example.invalid`, firmName: `Synthetic invited firm ${marker}` });

    const [storedToken] = await rows("SELECT tokenHash FROM firm_owner_invitations WHERE id = ?", [issued.invitationId]);
    expect(storedToken.tokenHash).not.toBe(token);
    expect(storedToken.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedToken.tokenHash).toBe(createHash("sha256").update(token!).digest("hex"));

    const collisionEmail = `existing-${marker}@example.invalid`;
    const collisionInvitation = await store.issueFirmOwnerInvitation({
      email: collisionEmail,
      firmName: `Collision firm ${marker}`,
      actorUserId,
      origin: "https://local.example.test",
    });
    await insert("users", {
      openId: `synthetic-existing-${marker}`,
      name: "Synthetic existing account",
      email: collisionEmail,
      passwordHash: "synthetic-test-hash-not-a-credential",
      loginMethod: "email",
      role: "admin",
      organizationId: paidOrganizationId,
      orgRole: "owner",
      isSuperAdmin: 0,
    });
    const countsBeforeCollision = await Promise.all(["organizations", "users", "organization_access_controls", "platform_access_audit"].map(count));
    const collisionToken = new URL(collisionInvitation.invitationUrl).searchParams.get("firmInvite")!;
    await expect(store.acceptFirmOwnerInvitation({ token: collisionToken, email: collisionEmail, passwordHash: "synthetic-new-hash", name: "Collision Attempt", openId: `collision-${marker}` })).rejects.toBeTruthy();
    expect(await Promise.all(["organizations", "users", "organization_access_controls", "platform_access_audit"].map(count))).toEqual(countsBeforeCollision);
    expect(await store.previewFirmOwnerInvitation(collisionToken)).toBeTruthy();

    const user = await store.acceptFirmOwnerInvitation({
      token: token!,
      email: `INVITEE-${marker}@example.invalid`,
      passwordHash: "synthetic-accepted-hash-not-a-credential",
      name: `Synthetic Invitee ${marker}`,
      openId: `synthetic-invitee-${marker}`,
    });
    expect(user).toMatchObject({ email: `invitee-${marker}@example.invalid`, role: "admin", orgRole: "owner", isSuperAdmin: false });
    const organizationId = Number(user.organizationId);
    expect(organizationId).toBeGreaterThan(0);
    const [organization] = await rows("SELECT trialStartedAt FROM organizations WHERE id = ?", [organizationId]);
    const [control] = await rows("SELECT state, complimentaryPlan FROM organization_access_controls WHERE organizationId = ?", [organizationId]);
    expect(organization.trialStartedAt).toBeNull();
    expect(control).toMatchObject({ state: "pending", complimentaryPlan: null });
    const accessPolicy = await import("./workspaceAccess");
    expect(await accessPolicy.resolveOrganizationWorkspaceAccess(organizationId)).toMatchObject({ managed: true, allowed: false, reason: "awaiting_approval" });
    await store.setComplimentaryPlan({ organizationId, plan: "enterprise", actorUserId });
    expect(await accessPolicy.resolveOrganizationWorkspaceAccess(organizationId)).toMatchObject({ allowed: false, state: "pending" });
    await store.setWorkspaceAccess({ organizationId, state: "active", actorUserId });
    expect(await accessPolicy.resolveOrganizationWorkspaceAccess(organizationId)).toMatchObject({ allowed: true, plan: "enterprise" });
    await expect(store.setWorkspaceAccess({ organizationId, state: "suspended", actorUserId, reason: issued.invitationUrl })).rejects.toThrow("INVALID_AUDIT_REASON");
    await store.setComplimentaryPlan({ organizationId, plan: null, actorUserId });
    expect(await accessPolicy.resolveOrganizationWorkspaceAccess(organizationId)).toMatchObject({ allowed: false, reason: "no_entitlement" });
    expect(await store.hasAcceptedFirmInvitation(organizationId)).toBe(true);
    // Only this test's newly created synthetic policy row is removed to model corruption.
    await connection.execute("DELETE FROM organization_access_controls WHERE organizationId = ?", [organizationId]);
    await expect(accessPolicy.resolveOrganizationWorkspaceAccess(organizationId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await store.setWorkspaceAccess({ organizationId, state: "active", actorUserId });
    expect(await accessPolicy.resolveOrganizationWorkspaceAccess(organizationId)).toMatchObject({ allowed: false, reason: "no_entitlement" });


    expect(await rows("SELECT id FROM subscriptions WHERE organizationId = ?", [organizationId])).toEqual([]);
    expect(await store.previewFirmOwnerInvitation(token!)).toBeNull();
    await expect(store.acceptFirmOwnerInvitation({ token: token!, email: `invitee-${marker}@example.invalid`, passwordHash: "synthetic-replay-hash", name: "Replay", openId: `replay-${marker}` })).rejects.toBeTruthy();

    const listed = await store.listFirmInvitations();
    expect(listed.some((item: any) => item.id === issued.invitationId)).toBe(true);
    expect(listed.every((item: any) => !("tokenHash" in item) && !("token" in item))).toBe(true);
    const audit = await store.listPlatformAccessAudit({ limit: 200 });
    const auditJson = JSON.stringify(audit);
    expect(auditJson).not.toContain(token!);
    expect(auditJson).not.toContain("synthetic-accepted-hash-not-a-credential");
    expect(audit.every((entry: any) => !("tokenHash" in entry) && !("passwordHash" in entry))).toBe(true);
    expect(await rows("SELECT acceptedAt, acceptedOrganizationId FROM firm_owner_invitations WHERE id = ?", [issued.invitationId])).toHaveLength(1);
    await expectBusinessDataUnchanged();
  }, 30_000);

  it("expires and revokes invitations without deleting them or allowing replay", async () => {
    const expired = await store.issueFirmOwnerInvitation({ email: `expired-${marker}@example.invalid`, firmName: "Synthetic expired invitation", actorUserId, origin: "https://local.example.test" });
    const expiredToken = new URL(expired.invitationUrl).searchParams.get("firmInvite")!;
    await connection.execute("UPDATE firm_owner_invitations SET expiresAt = ? WHERE id = ?", [new Date(Date.now() - 60_000), expired.invitationId]);
    expect(await store.previewFirmOwnerInvitation(expiredToken)).toBeNull();
    await expect(store.acceptFirmOwnerInvitation({ token: expiredToken, email: `expired-${marker}@example.invalid`, passwordHash: "synthetic-expired-hash", name: "Expired", openId: `expired-${marker}` })).rejects.toBeTruthy();

    const revoked = await store.issueFirmOwnerInvitation({ email: `revoked-${marker}@example.invalid`, firmName: "Synthetic revoked invitation", actorUserId, origin: "https://local.example.test" });
    const revokedToken = new URL(revoked.invitationUrl).searchParams.get("firmInvite")!;
    await expect(store.revokeFirmOwnerInvitation({ invitationId: revoked.invitationId, actorUserId, reason: "synthetic test revoke" })).resolves.toMatchObject({ success: true });
    expect(await store.previewFirmOwnerInvitation(revokedToken)).toBeNull();
    await expect(store.acceptFirmOwnerInvitation({ token: revokedToken, email: `revoked-${marker}@example.invalid`, passwordHash: "synthetic-revoked-hash", name: "Revoked", openId: `revoked-${marker}` })).rejects.toBeTruthy();
    await expect(store.revokeFirmOwnerInvitation({ invitationId: revoked.invitationId, actorUserId })).rejects.toBeTruthy();
    const [persisted] = await rows("SELECT revokedAt FROM firm_owner_invitations WHERE id = ?", [revoked.invitationId]);
    expect(persisted.revokedAt).toBeTruthy();
    expect((await store.listFirmInvitations()).some((item: any) => item.id === revoked.invitationId)).toBe(true);
    await expectBusinessDataUnchanged();
  }, 30_000);

  it("audits grant/suspend/reactivate changes and protects Peter's workspace without touching paid or historical rows", async () => {
    await expect(store.setWorkspaceAccess({ organizationId: protectedOrganizationId, state: "suspended", actorUserId, reason: "synthetic protection probe" })).rejects.toThrow(/PROTECTED_PLATFORM_OWNER_ORGANIZATION/);
    await expect(store.setWorkspaceAccess({ organizationId: protectedOrganizationId, state: "active", actorUserId, reason: "synthetic protection probe" })).rejects.toThrow(/PROTECTED_PLATFORM_OWNER_ORGANIZATION/);
    await expect(store.setComplimentaryPlan({ organizationId: protectedOrganizationId, plan: "enterprise", actorUserId, reason: "synthetic protection probe" })).rejects.toThrow(/PROTECTED_PLATFORM_OWNER_ORGANIZATION/);
    expect(await rows("SELECT organizationId FROM organization_access_controls WHERE organizationId = ?", [protectedOrganizationId])).toEqual([]);

    expect(await store.setWorkspaceAccess({ organizationId: paidOrganizationId, state: "active", actorUserId, reason: "synthetic grant" })).toMatchObject({ state: "active" });
    expect(await store.setComplimentaryPlan({ organizationId: paidOrganizationId, plan: "enterprise", actorUserId, reason: "synthetic complimentary grant" })).toMatchObject({ complimentaryPlan: "enterprise" });
    expect(await store.setWorkspaceAccess({ organizationId: paidOrganizationId, state: "suspended", actorUserId, reason: "synthetic suspension" })).toMatchObject({ state: "suspended" });
    expect(await store.setWorkspaceAccess({ organizationId: paidOrganizationId, state: "active", actorUserId, reason: "synthetic reactivation" })).toMatchObject({ state: "active" });
    expect(await store.setComplimentaryPlan({ organizationId: paidOrganizationId, plan: null, actorUserId, reason: "synthetic grant revoked" })).toMatchObject({ complimentaryPlan: null });

    const audit = await store.listPlatformAccessAudit({ organizationId: paidOrganizationId, limit: 100 });
    expect(audit.map((event: any) => event.action)).toEqual(expect.arrayContaining([
      "workspace_access_activated", "complimentary_plan_granted", "workspace_suspended", "complimentary_plan_revoked",
    ]));
    expect(audit.some((event: any) => event.reason === "synthetic reactivation")).toBe(true);
    const [subscription] = await rows("SELECT stripeSubscriptionId, stripeCustomerId, stripePriceId, plan, status, cancelAtPeriodEnd FROM subscriptions WHERE organizationId = ?", [paidOrganizationId]);
    expect(subscription).toMatchObject({
      stripeSubscriptionId: expect.stringMatching(/^sub_synthetic_/),
      stripeCustomerId: expect.stringMatching(/^cus_synthetic_/),
      stripePriceId: expect.stringMatching(/^price_synthetic_/),
      plan: "professional",
      status: "active",
      cancelAtPeriodEnd: 0,
    });
    await expectBusinessDataUnchanged();
  }, 30_000);
  it("enforces stored suspension through direct APIs and valid public links, restores them without rewriting business or paid records", async () => {
    const [user] = await rows("SELECT * FROM users WHERE openId = ?", [`synthetic-paid-owner-${marker}`]);
    const token = `synthetic-portal-${marker}`;
    const sheetToken = `synthetic-sheet-${marker}`;
    const clientToken = `synthetic-client-${marker}`;
    await insert("client_share_tokens", { token, projectId: paidProjectId, organizationId: paidOrganizationId, createdById: user.id });
    const sheetId = await insert("coordination_sheets", { projectId: paidProjectId, organizationId: paidOrganizationId, token: sheetToken, clientToken, projectName: "Synthetic access-control sheet", createdById: user.id });
    await insert("coordination_items", { sheetId, authorName: "Synthetic author", content: "SYNTHETIC retained client content", visibility: "client", isNotified: true });
    const retainedRows = stableJson(await rows("SELECT * FROM coordination_items WHERE sheetId = ? ORDER BY id", [sheetId]));
    const { appRouter } = await import("./routers");
    const context = (account: any) => ({ user: account, organizationId: account?.organizationId ?? null, req: { headers: {} }, res: {} }) as any;
    const anonymous = appRouter.createCaller(context(null));
    const ownerSession = appRouter.createCaller(context({ ...user, isSuperAdmin: false }));
    expect((await anonymous.portal.getProject({ token })).error).toBeNull();
    expect((await anonymous.coordination.getByClientToken({ clientToken })).items).toHaveLength(1);
    expect(await ownerSession.projects.list()).toHaveLength(1);
    await store.setWorkspaceAccess({ organizationId: paidOrganizationId, state: "suspended", actorUserId, reason: "Synthetic stored-session suspension test" });
    for (const role of ["admin", "pm", "user"] as const) {
      const existingSession = appRouter.createCaller(context({ ...user, role, isSuperAdmin: false }));
      await expect(existingSession.projects.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(ownerSession.projects.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await anonymous.portal.getProject({ token })).data).toBeNull();
    await expect(anonymous.coordination.getByToken({ token: sheetToken })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(anonymous.coordination.getByClientToken({ clientToken })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(anonymous.coordination.addItem({ token: clientToken, authorName: "Synthetic blocked writer", authorType: "other", content: "Must never be inserted" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(stableJson(await rows("SELECT * FROM coordination_items WHERE sheetId = ? ORDER BY id", [sheetId]))).toBe(retainedRows);
    expect(await ownerSession.subscription.current()).toMatchObject({ accessSource: "subscription", plan: "professional", workspaceAccess: { allowed: false, reason: "suspended" } });
    await store.setWorkspaceAccess({ organizationId: paidOrganizationId, state: "active", actorUserId });
    expect(await ownerSession.projects.list()).toHaveLength(1);
    expect((await anonymous.portal.getProject({ token })).error).toBeNull();
    expect((await anonymous.coordination.getByClientToken({ clientToken })).items).toHaveLength(1);
    expect(stableJson(await rows("SELECT * FROM coordination_items WHERE sheetId = ? ORDER BY id", [sheetId]))).toBe(retainedRows);
    await expectBusinessDataUnchanged();
    const history = await store.listPlatformAccessAudit({ organizationId: paidOrganizationId, limit: 200 });
    expect(history.some((event: any) => event.details && JSON.parse(event.details).nextState === "suspended")).toBe(true);
  }, 30_000);

});
