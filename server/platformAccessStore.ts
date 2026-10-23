import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { organizations, users, firmOwnerInvitations, organizationAccessControls, platformAccessAudit } from "../drizzle/schema";
import { assertSignupEmailAvailable, getDb } from "./db";
import { createFirmInvitationToken, decodeFirmInvitationGrant, hashFirmInvitationToken, isSupportedFirmInvitationToken } from "./firmInvitationGrant";

export type ComplimentaryPlan = "starter" | "professional" | "enterprise";
export type AccessState = "pending" | "active" | "suspended";
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function requirePositiveId(id: number, label: string) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`INVALID_${label.toUpperCase()}_ID`);
}
function normalizedEmail(email: string) {
  const value = email.trim().toLowerCase();
  if (value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("INVALID_EMAIL");
  return value;
}
function cleanReason(reason?: string | null) {
  if (reason == null || reason.trim() === "") return null;
  const value = reason.trim();
  if (value.length > 2000 || /[A-Za-z0-9_-]{40,}|[?&](?:firmInvite|invite|inviteToken|token)=|\bBearer\s+\S+/i.test(value)) throw new Error("INVALID_AUDIT_REASON");
  return value;
}
function tokenDigest(token: string) {
  if (!isSupportedFirmInvitationToken(token)) return null;
  return hashFirmInvitationToken(token);
}
async function database() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}
function appendAudit(tx: any, event: { action: string; actorUserId: number; organizationId?: number | null; invitationId?: number | null; reason?: string | null; details?: Record<string, string | null> }) {
  return tx.insert(platformAccessAudit).values({
    action: event.action,
    actorUserId: event.actorUserId,
    organizationId: event.organizationId ?? null,
    invitationId: event.invitationId ?? null,
    reason: cleanReason(event.reason),
    details: event.details ? JSON.stringify(event.details) : null,
  });
}
async function assertNotProtectedOrganization(tx: any, organizationId: number) {
  const [organization] = await tx.select({ id: organizations.id }).from(organizations)
    .where(eq(organizations.id, organizationId)).limit(1).for("update");
  if (!organization) throw new Error("ORGANIZATION_NOT_FOUND");
  const [protectedOwner] = await tx.select({ id: users.id }).from(users)
    .where(and(eq(users.organizationId, organizationId), eq(users.orgRole, "owner"), eq(users.isSuperAdmin, true)))
    .limit(1).for("update");
  if (protectedOwner) throw new Error("PROTECTED_PLATFORM_OWNER_ORGANIZATION");
}
function slugForFirm(name: string) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "studio";
  return `${base}-${randomBytes(8).toString("hex")}`;
}

export async function readOrganizationAccessControl(orgId: number) {
  requirePositiveId(orgId, "organization");
  const db = await database();
  const [row] = await db.select().from(organizationAccessControls).where(eq(organizationAccessControls.organizationId, orgId)).limit(1);
  return row ?? null;
}

export async function hasAcceptedFirmInvitation(orgId: number): Promise<boolean> {
  requirePositiveId(orgId, "organization");
  const db = await database();
  const [row] = await db.select({ id: firmOwnerInvitations.id }).from(firmOwnerInvitations)
    .where(and(eq(firmOwnerInvitations.acceptedOrganizationId, orgId), isNotNull(firmOwnerInvitations.acceptedAt))).limit(1);
  return !!row;
}

export async function listAccessControls() {
  const db = await database();
  return db.select().from(organizationAccessControls).orderBy(asc(organizationAccessControls.organizationId));
}

export async function listFirmInvitations() {
  const db = await database();
  return db.select({
    id: firmOwnerInvitations.id,
    email: firmOwnerInvitations.email,
    firmName: firmOwnerInvitations.firmName,
    createdById: firmOwnerInvitations.createdById,
    expiresAt: firmOwnerInvitations.expiresAt,
    acceptedAt: firmOwnerInvitations.acceptedAt,
    revokedAt: firmOwnerInvitations.revokedAt,
    acceptedOrganizationId: firmOwnerInvitations.acceptedOrganizationId,
    createdAt: firmOwnerInvitations.createdAt,
  }).from(firmOwnerInvitations).orderBy(desc(firmOwnerInvitations.createdAt));
}

export async function listPlatformAccessAudit(options: { organizationId?: number; limit?: number } = {}) {
  if (options.organizationId != null) requirePositiveId(options.organizationId, "organization");
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("INVALID_AUDIT_LIMIT");
  const db = await database();
  const query = db.select().from(platformAccessAudit);
  const rows = options.organizationId == null
    ? await query.orderBy(desc(platformAccessAudit.createdAt), desc(platformAccessAudit.id)).limit(limit)
    : await query.where(eq(platformAccessAudit.organizationId, options.organizationId)).orderBy(desc(platformAccessAudit.createdAt), desc(platformAccessAudit.id)).limit(limit);
  return rows;
}

export async function issueFirmOwnerInvitation(input: { email: string; firmName: string; actorUserId: number; origin: string; complimentaryPlan?: ComplimentaryPlan }) {
  requirePositiveId(input.actorUserId, "actor");
  const complimentaryPlan = input.complimentaryPlan === undefined ? "starter" : input.complimentaryPlan;
  if (!["starter", "professional", "enterprise"].includes(complimentaryPlan)) throw new Error("INVALID_COMPLIMENTARY_PLAN");
  const email = normalizedEmail(input.email);
  const firmName = input.firmName.trim();
  if (!firmName || firmName.length > 255) throw new Error("INVALID_FIRM_NAME");
  let origin: URL;
  try { origin = new URL(input.origin); } catch { throw new Error("INVALID_INVITATION_ORIGIN"); }
  if (!["https:", "http:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("INVALID_INVITATION_ORIGIN");
  }
  const token = createFirmInvitationToken(complimentaryPlan);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const db = await database();
  const invitationId = await db.transaction(async (tx: any) => {
    await assertSignupEmailAvailable(tx, email);
    const result = await tx.insert(firmOwnerInvitations).values({
      tokenHash: hashFirmInvitationToken(token), email, firmName,
      createdById: input.actorUserId, expiresAt,
    });
    const id = Number(result[0].insertId);
    await appendAudit(tx, { action: "invitation_issued", actorUserId: input.actorUserId, invitationId: id, details: { selectedPlan: complimentaryPlan, activation: "active" } });
    return id;
  });
  const inviteUrl = new URL("/signup", origin.origin);
  inviteUrl.searchParams.set("firmInvite", token);
  return { invitationId, invitationUrl: inviteUrl.toString(), expiresAt, complimentaryPlan };
}

export async function previewFirmOwnerInvitation(token: string): Promise<{ email: string; firmName: string; expiresAt: Date; complimentaryPlan: ComplimentaryPlan | null } | null> {
  const hash = tokenDigest(token);
  if (!hash) return null;
  const db = await database();
  const [row] = await db.select({ email: firmOwnerInvitations.email, firmName: firmOwnerInvitations.firmName, expiresAt: firmOwnerInvitations.expiresAt, acceptedAt: firmOwnerInvitations.acceptedAt, revokedAt: firmOwnerInvitations.revokedAt })
    .from(firmOwnerInvitations).where(eq(firmOwnerInvitations.tokenHash, hash)).limit(1);
  if (!row || row.acceptedAt || row.revokedAt || row.expiresAt.getTime() <= Date.now()) return null;
  const grant = decodeFirmInvitationGrant(token);
  return { email: row.email, firmName: row.firmName, expiresAt: row.expiresAt, complimentaryPlan: grant?.complimentaryPlan ?? null };
}

export async function acceptFirmOwnerInvitation(input: { token: string; email: string; passwordHash: string; name: string; openId: string }) {
  const hash = tokenDigest(input.token);
  if (!hash) throw new Error("INVITATION_NO_LONGER_VALID");
  const email = normalizedEmail(input.email);
  if (!input.passwordHash || input.passwordHash.length > 255 || !input.name.trim() || input.name.length > 255 || !input.openId || input.openId.length > 64) throw new Error("INVALID_INVITATION_ACCEPTANCE");
  const db = await database();
  return db.transaction(async (tx: any) => {
    await assertSignupEmailAvailable(tx, email);
    const [invitation] = await tx.select().from(firmOwnerInvitations)
      .where(eq(firmOwnerInvitations.tokenHash, hash)).limit(1).for("update");
    if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt.getTime() <= Date.now() || invitation.email !== email) {
      throw new Error("INVITATION_NO_LONGER_VALID");
    }
    const grant = decodeFirmInvitationGrant(input.token);
    if (!grant) throw new Error("INVITATION_NO_LONGER_VALID");
    const orgInsert = await tx.insert(organizations).values({ name: invitation.firmName, slug: slugForFirm(invitation.firmName), trialStartedAt: null });
    const organizationId = Number(orgInsert[0].insertId);
    await tx.insert(users).values({
      openId: input.openId, name: input.name.trim(), email, passwordHash: input.passwordHash,
      loginMethod: "email", role: "admin", orgRole: "owner", organizationId, isSuperAdmin: false,
    });
    const [created] = await tx.select().from(users).where(eq(users.openId, input.openId)).limit(1);
    if (!created) throw new Error("INVITED_ACCOUNT_COULD_NOT_BE_LOADED");
    await tx.insert(organizationAccessControls).values({ organizationId, state: grant.activation, complimentaryPlan: grant.complimentaryPlan });
    await tx.update(firmOwnerInvitations).set({ acceptedAt: new Date(), acceptedOrganizationId: organizationId }).where(eq(firmOwnerInvitations.id, invitation.id));
    await appendAudit(tx, { action: "invitation_accepted", actorUserId: created.id, organizationId, invitationId: invitation.id, details: { selectedPlan: grant.complimentaryPlan, activation: grant.activation } });
    return created;
  });
}

export async function revokeFirmOwnerInvitation(input: { invitationId: number; actorUserId: number; reason?: string }) {
  requirePositiveId(input.invitationId, "invitation");
  requirePositiveId(input.actorUserId, "actor");
  const reason = cleanReason(input.reason);
  const db = await database();
  return db.transaction(async (tx: any) => {
    const [invitation] = await tx.select().from(firmOwnerInvitations).where(eq(firmOwnerInvitations.id, input.invitationId)).limit(1).for("update");
    if (!invitation || invitation.acceptedAt || invitation.revokedAt) throw new Error("INVITATION_NOT_REVOCABLE");
    await tx.update(firmOwnerInvitations).set({ revokedAt: new Date() }).where(eq(firmOwnerInvitations.id, invitation.id));
    await appendAudit(tx, { action: "invitation_revoked", actorUserId: input.actorUserId, invitationId: invitation.id, reason });
    return { success: true as const };
  });
}

async function writeControl(input: { organizationId: number; actorUserId: number; state?: "active" | "suspended"; plan?: ComplimentaryPlan | null; reason?: string }, action: string) {
  requirePositiveId(input.organizationId, "organization");
  requirePositiveId(input.actorUserId, "actor");
  const reason = cleanReason(input.reason);
  const db = await database();
  return db.transaction(async (tx: any) => {
    await assertNotProtectedOrganization(tx, input.organizationId);
    const [existing] = await tx.select().from(organizationAccessControls)
      .where(eq(organizationAccessControls.organizationId, input.organizationId)).limit(1).for("update");
    if (Object.prototype.hasOwnProperty.call(input, "plan") && input.plan == null && !existing?.complimentaryPlan) throw new Error("COMPLIMENTARY_GRANT_NOT_FOUND");
    const state = input.state ?? existing?.state ?? "active";
    const complimentaryPlan = Object.prototype.hasOwnProperty.call(input, "plan") ? input.plan ?? null : existing?.complimentaryPlan ?? null;
    if (existing) {
      await tx.update(organizationAccessControls).set({ state, complimentaryPlan, updatedAt: new Date() }).where(eq(organizationAccessControls.organizationId, input.organizationId));
    } else {
      await tx.insert(organizationAccessControls).values({ organizationId: input.organizationId, state, complimentaryPlan });
    }
    await appendAudit(tx, { action, actorUserId: input.actorUserId, organizationId: input.organizationId, reason, details: { previousState: existing?.state ?? "legacy", nextState: state, previousPlan: existing?.complimentaryPlan ?? null, nextPlan: complimentaryPlan } });
    const [updated] = await tx.select().from(organizationAccessControls).where(eq(organizationAccessControls.organizationId, input.organizationId)).limit(1);
    return updated;
  });
}

export async function setWorkspaceAccess(input: { organizationId: number; state: "active" | "suspended"; actorUserId: number; reason?: string }) {
  return writeControl(input, input.state === "suspended" ? "workspace_suspended" : "workspace_access_activated");
}
export async function setComplimentaryPlan(input: { organizationId: number; plan: ComplimentaryPlan | null; actorUserId: number; reason?: string }) {
  return writeControl(input, input.plan == null ? "complimentary_plan_revoked" : "complimentary_plan_granted");
}
