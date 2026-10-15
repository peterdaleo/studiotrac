import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { prospectInteractions, prospects, projectNotes, projectTeamMembers, projects, teamMembers, users } from "../drizzle/schema";
import { getDb } from "./db";
import { normalizeBillingTerms, seedInitialBillingPhase } from "./projectBilling";
import type { ProspectStage } from "../shared/prospects";

export type ProspectDraft = {
  firm: string;
  opportunityName: string;
  contact?: string | null;
  referralSource?: string | null;
  stage?: ProspectStage;
  ownerId?: number | null;
  nextFollowUpDate?: string | null;
};

export type ProspectPatch = Partial<ProspectDraft>;

function organizationCondition<T extends { organizationId: any }>(table: T, orgId?: number | null) {
  return orgId == null ? isNull(table.organizationId) : eq(table.organizationId, orgId);
}

function scopedConditions<T extends { organizationId: any; id: any }>(
  table: T,
  id: number,
  orgId?: number | null,
) {
  const orgCondition = organizationCondition(table, orgId);
  return and(eq(table.id, id), orgCondition);
}

async function validateOwner(ownerId: number | null | undefined, orgId?: number | null) {
  if (ownerId == null) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions = [eq(teamMembers.id, ownerId), eq(teamMembers.isActive, true)];
  const orgCondition = organizationCondition(teamMembers, orgId);
  if (orgCondition) conditions.push(orgCondition);
  const [member] = await db.select({ id: teamMembers.id }).from(teamMembers).where(and(...conditions)).limit(1);
  if (!member) throw new Error("Assigned owner is not an active team member in this workspace");
}

export async function listProspects(orgId?: number | null) {
  const db = await getDb();
  if (!db) return [];
  const orgCondition = organizationCondition(prospects, orgId);
  const rows = await db.select().from(prospects)
    .where(orgCondition)
    .orderBy(desc(prospects.updatedAt), desc(prospects.id));
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const interactionConditions = [inArray(prospectInteractions.prospectId, ids)];
  const interactionOrgCondition = organizationCondition(prospectInteractions, orgId);
  if (interactionOrgCondition) interactionConditions.push(interactionOrgCondition);
  const history = await db.select().from(prospectInteractions)
    .where(and(...interactionConditions))
    .orderBy(desc(prospectInteractions.happenedAt), desc(prospectInteractions.id));

  const authorIds = Array.from(new Set(history.map((item) => item.createdById).filter((id): id is number => id != null)));
  const authors = authorIds.length
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, authorIds))
    : [];
  const authorNames = new Map(authors.map((author) => [author.id, author.name || "Team member"]));
  const historyByProspect = new Map<number, Array<(typeof history)[number] & { authorName: string }>>();
  for (const item of history) {
    const group = historyByProspect.get(item.prospectId) ?? [];
    group.push({ ...item, authorName: authorNames.get(item.createdById ?? -1) ?? "Team member" });
    historyByProspect.set(item.prospectId, group);
  }

  return rows.map((row) => {
    const interactions = historyByProspect.get(row.id) ?? [];
    return {
      ...row,
      lastInteractionAt: interactions[0]?.happenedAt ?? null,
      interactions,
    };
  });
}

export async function createProspect(data: ProspectDraft, orgId: number | null, createdById: number) {
  await validateOwner(data.ownerId, orgId);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(prospects).values({
    organizationId: orgId,
    firm: data.firm.trim(),
    opportunityName: data.opportunityName.trim(),
    contact: data.contact?.trim() || null,
    referralSource: data.referralSource?.trim() || null,
    stage: data.stage ?? "New",
    ownerId: data.ownerId ?? null,
    nextFollowUpDate: data.nextFollowUpDate || null,
    createdById,
  });
  return { id: result[0].insertId };
}

export async function updateProspect(
  id: number,
  data: ProspectPatch,
  orgId?: number | null,
) {
  if (data.ownerId !== undefined) await validateOwner(data.ownerId, orgId);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db.select({ id: prospects.id, convertedProjectId: prospects.convertedProjectId }).from(prospects)
    .where(scopedConditions(prospects, id, orgId)).limit(1);
  if (!existing) throw new Error("Prospect not found");
  if (existing.convertedProjectId != null && data.stage !== undefined) {
    throw new Error("A converted prospect must remain Won");
  }

  const patch: Record<string, unknown> = {};
  if (data.firm !== undefined) patch.firm = data.firm.trim();
  if (data.opportunityName !== undefined) patch.opportunityName = data.opportunityName.trim();
  if (data.contact !== undefined) patch.contact = data.contact?.trim() || null;
  if (data.referralSource !== undefined) patch.referralSource = data.referralSource?.trim() || null;
  if (data.stage !== undefined) patch.stage = data.stage;
  if (data.ownerId !== undefined) patch.ownerId = data.ownerId;
  if (data.nextFollowUpDate !== undefined) patch.nextFollowUpDate = data.nextFollowUpDate || null;
  if (Object.keys(patch).length) {
    await db.update(prospects).set(patch as any).where(scopedConditions(prospects, id, orgId));
  }
  return { success: true };
}

export async function addProspectInteraction(
  input: {
    prospectId: number;
    type: "note" | "call" | "email" | "meeting" | "proposal";
    content: string;
    happenedAt: Date;
    isPrivate: boolean;
  },
  orgId: number | null,
  createdById: number,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [prospect] = await db.select({ id: prospects.id }).from(prospects)
    .where(scopedConditions(prospects, input.prospectId, orgId)).limit(1);
  if (!prospect) throw new Error("Prospect not found");
  const result = await db.insert(prospectInteractions).values({
    organizationId: orgId,
    prospectId: input.prospectId,
    type: input.type,
    content: input.content.trim(),
    happenedAt: input.happenedAt,
    isPrivate: input.isPrivate,
    createdById,
  });
  return { id: result[0].insertId };
}

export async function convertProspectToProject(id: number, orgId: number | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async (tx) => {
    const condition = scopedConditions(prospects, id, orgId);
    const [prospect] = await tx.select().from(prospects).where(condition).limit(1).for("update");
    if (!prospect) throw new Error("Prospect not found");
    if (prospect.stage !== "Won") throw new Error("Only a Won prospect can be converted to a project");
    if (prospect.convertedProjectId) {
      throw new Error(`Prospect has already been converted to project ${prospect.convertedProjectId}`);
    }

    const interactions = await tx.select().from(prospectInteractions)
      .where(and(
        eq(prospectInteractions.prospectId, prospect.id),
        eq(prospectInteractions.isPrivate, false),
        organizationCondition(prospectInteractions, orgId),
      ))
      .orderBy(asc(prospectInteractions.happenedAt), asc(prospectInteractions.id));

    const terms = normalizeBillingTerms({
      billingType: "fixed_fee",
      contractedFee: 0,
      hourlyRateCents: 0,
      notToExceedCents: 0,
      revenueTargetCents: 0,
    });
    const projectResult = await tx.insert(projects).values({
      organizationId: orgId,
      name: prospect.opportunityName,
      clientName: prospect.firm,
      projectManagerId: prospect.ownerId,
      description: [
        prospect.contact ? `Primary contact: ${prospect.contact}` : null,
        prospect.referralSource ? `Referral source: ${prospect.referralSource}` : null,
      ].filter(Boolean).join("\n") || null,
      ...terms,
    });
    const projectId = projectResult[0].insertId;

    if (prospect.ownerId != null) {
      await tx.insert(projectTeamMembers).values({
        projectId,
        teamMemberId: prospect.ownerId,
        role: "pm",
      });
    }

    await seedInitialBillingPhase(
      tx as any,
      projectId,
      orgId,
      terms,
      new Date(),
    );

    for (const item of interactions) {
      const dateLabel = new Date(item.happenedAt).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
      });
      await tx.insert(projectNotes).values({
        organizationId: orgId,
        projectId,
        authorId: item.createdById,
        content: `[Prospect ${item.type} · ${dateLabel}] ${item.content}`,
        isClientVisible: false,
      });
    }

    await tx.update(prospects).set({ convertedProjectId: projectId, convertedAt: new Date() })
      .where(and(condition, isNull(prospects.convertedProjectId)));

    return { projectId };
  });
}
