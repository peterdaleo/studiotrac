import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  consultantContracts,
  projectBillingPhases,
  projects,
  teamMembers,
  timeEntries,
  users,
  type InsertProject,
  type InsertProjectBillingPhase,
  type Project,
  type ProjectBillingPhase,
} from "../drizzle/schema";
import {
  addCostSlice,
  costsFallInPhase,
  emptyCostSlice,
  evaluateBudgetHealth,
  inferBillingType,
  type BillingPhaseInput,
  type BillingType,
  type BudgetHealth,
  type CostSlice,
} from "../shared/billing";

async function getDb() {
  const mod = await import("./db");
  return mod.getDb();
}

export type BillingTerms = {
  billingType: BillingType;
  contractedFee: number;
  hourlyRateCents: number;
  notToExceedCents: number;
  revenueTargetCents: number;
};

export type BudgetSummaryRow = {
  projectId: number;
  contractedFee: number;
  totalCost: number;
  billingType: BillingType;
  hourlyRateCents: number;
  notToExceedCents: number;
  revenueTargetCents: number;
  laborCost: number;
  billableLaborCost: number;
  consultantCost: number;
  totalMinutes: number;
  billableMinutes: number;
  budgetHealth: BudgetHealth;
};

type DbClient = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function asBillingType(value: unknown, contractedFee = 0): BillingType {
  return inferBillingType(contractedFee, value === "hourly" || value === "fixed_fee" ? value : null);
}

export function normalizeBillingTerms(input: {
  billingType?: BillingType | string | null;
  contractedFee?: number | null;
  hourlyRateCents?: number | null;
  notToExceedCents?: number | null;
  revenueTargetCents?: number | null;
}): BillingTerms {
  const contractedFee = Math.max(0, input.contractedFee ?? 0);
  const billingType = asBillingType(input.billingType, contractedFee);
  return {
    billingType,
    contractedFee: billingType === "hourly" ? contractedFee : contractedFee,
    hourlyRateCents: Math.max(0, input.hourlyRateCents ?? 0),
    notToExceedCents: Math.max(0, input.notToExceedCents ?? 0),
    revenueTargetCents: Math.max(0, input.revenueTargetCents ?? 0),
  };
}

function phaseStartedAt(project: { startDate?: Date | null; createdAt?: Date | null }): Date {
  return project.startDate ?? project.createdAt ?? new Date();
}

export async function listProjectBillingPhases(projectId: number): Promise<ProjectBillingPhase[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    return await db
      .select()
      .from(projectBillingPhases)
      .where(eq(projectBillingPhases.projectId, projectId))
      .orderBy(asc(projectBillingPhases.startedAt), asc(projectBillingPhases.id));
  } catch (error) {
    console.warn("[Database] project_billing_phases is not available yet:", error);
    return [];
  }
}

async function getOpenBillingPhase(db: DbClient, projectId: number) {
  const [open] = await db
    .select()
    .from(projectBillingPhases)
    .where(and(eq(projectBillingPhases.projectId, projectId), isNull(projectBillingPhases.endedAt)))
    .orderBy(asc(projectBillingPhases.startedAt), asc(projectBillingPhases.id))
    .limit(1);
  return open;
}

export async function ensureProjectBillingPhase(
  project: Pick<Project, "id" | "organizationId" | "billingType" | "contractedFee" | "hourlyRateCents" | "notToExceedCents" | "revenueTargetCents" | "startDate" | "createdAt">,
  tx?: DbClient,
) {
  const db = tx ?? await getDb();
  if (!db) return;
  try {
    const existing = await db
      .select({ id: projectBillingPhases.id })
      .from(projectBillingPhases)
      .where(eq(projectBillingPhases.projectId, project.id))
      .limit(1);
    if (existing.length > 0) return;
    await db.insert(projectBillingPhases).values({
      organizationId: project.organizationId,
      projectId: project.id,
      billingType: asBillingType(project.billingType, project.contractedFee),
      startedAt: phaseStartedAt(project),
      endedAt: null,
      contractedFee: project.contractedFee || 0,
      hourlyRateCents: project.hourlyRateCents || 0,
      notToExceedCents: project.notToExceedCents || 0,
      revenueTargetCents: project.revenueTargetCents || 0,
    });
  } catch (error) {
    console.warn("[Database] Could not seed project billing phase:", error);
  }
}

export async function seedInitialBillingPhase(
  tx: DbClient,
  projectId: number,
  orgId: number | null | undefined,
  terms: BillingTerms,
  startedAt: Date,
) {
  await tx.insert(projectBillingPhases).values({
    organizationId: orgId ?? null,
    projectId,
    billingType: terms.billingType,
    startedAt,
    endedAt: null,
    contractedFee: terms.contractedFee,
    hourlyRateCents: terms.hourlyRateCents,
    notToExceedCents: terms.notToExceedCents,
    revenueTargetCents: terms.revenueTargetCents,
  });
}

export type BillingTransitionInput = {
  billingType?: BillingType;
  contractedFee?: number;
  hourlyRateCents?: number;
  notToExceedCents?: number;
  revenueTargetCents?: number;
  billingChangeDate?: Date | null;
  billingChangeNotes?: string | null;
};

export async function applyProjectBillingUpdate(
  tx: DbClient,
  projectId: number,
  current: Project,
  patch: BillingTransitionInput,
): Promise<Partial<InsertProject>> {
  const nextTerms = normalizeBillingTerms({
    billingType: patch.billingType ?? current.billingType,
    contractedFee: patch.contractedFee ?? current.contractedFee,
    hourlyRateCents: patch.hourlyRateCents ?? current.hourlyRateCents,
    notToExceedCents: patch.notToExceedCents ?? current.notToExceedCents,
    revenueTargetCents: patch.revenueTargetCents ?? current.revenueTargetCents,
  });
  const currentType = asBillingType(current.billingType, current.contractedFee);
  const typeChanged = nextTerms.billingType !== currentType;
  const now = patch.billingChangeDate ?? new Date();

  try {
    await ensureProjectBillingPhase(current, tx);
    const open = await getOpenBillingPhase(tx, projectId);

    if (typeChanged) {
      if (open) {
        await tx.update(projectBillingPhases)
          .set({ endedAt: now })
          .where(eq(projectBillingPhases.id, open.id));
      }
      await tx.insert(projectBillingPhases).values({
        organizationId: current.organizationId,
        projectId,
        billingType: nextTerms.billingType,
        startedAt: now,
        endedAt: null,
        contractedFee: nextTerms.billingType === "fixed_fee" ? nextTerms.contractedFee : 0,
        hourlyRateCents: nextTerms.hourlyRateCents,
        notToExceedCents: nextTerms.notToExceedCents,
        revenueTargetCents: nextTerms.revenueTargetCents,
        notes: patch.billingChangeNotes ?? null,
      } satisfies InsertProjectBillingPhase);
    } else if (open) {
      await tx.update(projectBillingPhases).set({
        contractedFee: nextTerms.billingType === "fixed_fee" ? nextTerms.contractedFee : open.contractedFee,
        hourlyRateCents: nextTerms.hourlyRateCents,
        notToExceedCents: nextTerms.notToExceedCents,
        revenueTargetCents: nextTerms.revenueTargetCents,
      }).where(eq(projectBillingPhases.id, open.id));
    }
  } catch (error) {
    console.warn("[Database] Could not update project billing phases:", error);
  }

  return {
    billingType: nextTerms.billingType,
    contractedFee: typeChanged && nextTerms.billingType === "hourly"
      ? current.contractedFee || 0
      : nextTerms.contractedFee,
    hourlyRateCents: nextTerms.hourlyRateCents,
    notToExceedCents: nextTerms.notToExceedCents,
    revenueTargetCents: nextTerms.revenueTargetCents,
  };
}

async function buildUserBillingRateMap(db: DbClient) {
  const allMembers = await db.select().from(teamMembers);
  const allUsers = await db.select({ id: users.id, email: users.email, name: users.name }).from(users);
  const userIdToBillingRate = new Map<number, number>();
  for (const member of allMembers) {
    if (member.userId) userIdToBillingRate.set(member.userId, member.billingRate);
  }
  for (const user of allUsers) {
    if (userIdToBillingRate.has(user.id)) continue;
    const byEmail = user.email
      ? allMembers.find((member) => !member.userId && member.email && member.email.toLowerCase() === user.email!.toLowerCase())
      : undefined;
    if (byEmail) {
      userIdToBillingRate.set(user.id, byEmail.billingRate);
      continue;
    }
    const byName = user.name
      ? allMembers.find((member) => !member.userId && !member.email && member.name.toLowerCase() === user.name!.toLowerCase())
      : undefined;
    if (byName) userIdToBillingRate.set(user.id, byName.billingRate);
  }
  return userIdToBillingRate;
}

export async function getProjectCostSlice(projectId: number): Promise<CostSlice> {
  const db = await getDb();
  if (!db) return emptyCostSlice();

  const userIdToBillingRate = await buildUserBillingRateMap(db);
  const entries = await db
    .select({
      userId: timeEntries.userId,
      durationMinutes: timeEntries.durationMinutes,
      billable: timeEntries.billable,
    })
    .from(timeEntries)
    .where(and(eq(timeEntries.projectId, projectId), sql`${timeEntries.endTime} IS NOT NULL`));

  const slice = emptyCostSlice();
  for (const entry of entries) {
    const minutes = entry.durationMinutes ?? 0;
    const cost = Math.round((minutes / 60) * (userIdToBillingRate.get(entry.userId) ?? 0));
    slice.laborCost += cost;
    slice.totalMinutes += minutes;
    if (entry.billable) {
      slice.billableLaborCost += cost;
      slice.billableMinutes += minutes;
    }
  }

  const contracts = await db
    .select({ contractAmount: consultantContracts.contractAmount })
    .from(consultantContracts)
    .where(eq(consultantContracts.projectId, projectId));
  slice.consultantCost = contracts.reduce((sum, contract) => sum + (contract.contractAmount ?? 0), 0);
  return slice;
}

type RawLaborRow = {
  projectId: number;
  userId: number;
  durationMinutes: number | null;
  billable: boolean | null;
  startTime: Date;
};

type RawConsultantRow = {
  projectId: number;
  contractAmount: number | null;
  createdAt: Date;
};

function laborRowToSlice(row: RawLaborRow, rate: number): CostSlice {
  const minutes = row.durationMinutes ?? 0;
  const cost = Math.round((minutes / 60) * rate);
  return {
    laborCost: cost,
    billableLaborCost: row.billable ? cost : 0,
    consultantCost: 0,
    totalMinutes: minutes,
    billableMinutes: row.billable ? minutes : 0,
  };
}

function allocateCostsToPhases(
  phases: ProjectBillingPhase[],
  laborRows: RawLaborRow[],
  consultantRows: RawConsultantRow[],
  rates: Map<number, number>,
): BillingPhaseInput[] {
  return phases.map((phase) => {
    const bounds = { startedAt: phase.startedAt, endedAt: phase.endedAt };
    let costs = emptyCostSlice();
    for (const row of laborRows) {
      if (costsFallInPhase(row.startTime, bounds)) {
        costs = addCostSlice(costs, laborRowToSlice(row, rates.get(row.userId) ?? 0));
      }
    }
    for (const row of consultantRows) {
      if (costsFallInPhase(row.createdAt, bounds)) {
        costs = addCostSlice(costs, {
          laborCost: 0,
          billableLaborCost: 0,
          consultantCost: row.contractAmount ?? 0,
          totalMinutes: 0,
          billableMinutes: 0,
        });
      }
    }
    return {
      billingType: asBillingType(phase.billingType, phase.contractedFee),
      startedAt: phase.startedAt,
      endedAt: phase.endedAt,
      contractedFee: phase.contractedFee || 0,
      hourlyRateCents: phase.hourlyRateCents || 0,
      notToExceedCents: phase.notToExceedCents || 0,
      revenueTargetCents: phase.revenueTargetCents || 0,
      costs,
    };
  });
}

export async function getProjectBudgetContext(projectId: number) {
  const db = await getDb();
  const empty = {
    project: undefined as Project | undefined,
    costs: emptyCostSlice(),
    phases: [] as ProjectBillingPhase[],
    budgetHealth: evaluateBudgetHealth({
      billingType: "hourly",
      contractedFee: 0,
      laborCost: 0,
      consultantCost: 0,
    }),
  };
  if (!db) return empty;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return empty;

  const rates = await buildUserBillingRateMap(db);
  const laborRows = await db
    .select({
      projectId: timeEntries.projectId,
      userId: timeEntries.userId,
      durationMinutes: timeEntries.durationMinutes,
      billable: timeEntries.billable,
      startTime: timeEntries.startTime,
    })
    .from(timeEntries)
    .where(and(eq(timeEntries.projectId, projectId), sql`${timeEntries.endTime} IS NOT NULL`));

  const consultantRows = await db
    .select({
      projectId: consultantContracts.projectId,
      contractAmount: consultantContracts.contractAmount,
      createdAt: consultantContracts.createdAt,
    })
    .from(consultantContracts)
    .where(eq(consultantContracts.projectId, projectId));

  const costs = emptyCostSlice();
  for (const row of laborRows) {
    const slice = laborRowToSlice(row, rates.get(row.userId) ?? 0);
    costs.laborCost += slice.laborCost;
    costs.billableLaborCost += slice.billableLaborCost;
    costs.totalMinutes += slice.totalMinutes;
    costs.billableMinutes += slice.billableMinutes;
  }
  for (const row of consultantRows) {
    costs.consultantCost += row.contractAmount ?? 0;
  }

  const phases = await listProjectBillingPhases(projectId);
  const phaseInputs = allocateCostsToPhases(phases, laborRows, consultantRows, rates);
  const budgetHealth = evaluateBudgetHealth({
    billingType: asBillingType(project.billingType, project.contractedFee),
    contractedFee: project.contractedFee || 0,
    laborCost: costs.laborCost,
    billableLaborCost: costs.billableLaborCost,
    consultantCost: costs.consultantCost,
    totalMinutes: costs.totalMinutes,
    billableMinutes: costs.billableMinutes,
    hourlyRateCents: project.hourlyRateCents || 0,
    notToExceedCents: project.notToExceedCents || 0,
    revenueTargetCents: project.revenueTargetCents || 0,
    phases: phaseInputs,
  });

  return { project, costs, phases, budgetHealth };
}

export async function getAllProjectsBudgetSummary(orgId?: number | null): Promise<BudgetSummaryRow[]> {
  const db = await getDb();
  if (!db) return [];

  const pWhere = orgId ? eq(projects.organizationId, orgId) : undefined;
  const allProjects = await db
    .select({
      id: projects.id,
      contractedFee: projects.contractedFee,
      billingType: projects.billingType,
      hourlyRateCents: projects.hourlyRateCents,
      notToExceedCents: projects.notToExceedCents,
      revenueTargetCents: projects.revenueTargetCents,
    })
    .from(projects)
    .where(pWhere);

  if (allProjects.length === 0) return [];

  const rates = await buildUserBillingRateMap(db);
  const laborEntries = await db
    .select({
      projectId: timeEntries.projectId,
      userId: timeEntries.userId,
      durationMinutes: timeEntries.durationMinutes,
      billable: timeEntries.billable,
      startTime: timeEntries.startTime,
    })
    .from(timeEntries)
    .where(sql`${timeEntries.endTime} IS NOT NULL`);

  const laborByProject = new Map<number, CostSlice>();
  const laborRowsByProject = new Map<number, RawLaborRow[]>();
  for (const row of laborEntries) {
    const slice = laborRowToSlice(row, rates.get(row.userId) ?? 0);
    laborByProject.set(row.projectId, addCostSlice(laborByProject.get(row.projectId) ?? emptyCostSlice(), slice));
    const rows = laborRowsByProject.get(row.projectId) ?? [];
    rows.push(row);
    laborRowsByProject.set(row.projectId, rows);
  }

  const contractRows = await db
    .select({
      projectId: consultantContracts.projectId,
      contractAmount: consultantContracts.contractAmount,
      createdAt: consultantContracts.createdAt,
    })
    .from(consultantContracts);

  const consultantByProject = new Map<number, number>();
  const consultantRowsByProject = new Map<number, RawConsultantRow[]>();
  for (const row of contractRows) {
    consultantByProject.set(row.projectId, (consultantByProject.get(row.projectId) ?? 0) + (row.contractAmount ?? 0));
    const rows = consultantRowsByProject.get(row.projectId) ?? [];
    rows.push(row);
    consultantRowsByProject.set(row.projectId, rows);
  }

  let phases: ProjectBillingPhase[] = [];
  try {
    phases = await db.select().from(projectBillingPhases);
  } catch (error) {
    console.warn("[Database] project_billing_phases is not available yet:", error);
  }
  const phasesByProject = new Map<number, ProjectBillingPhase[]>();
  for (const phase of phases) {
    const list = phasesByProject.get(phase.projectId) ?? [];
    list.push(phase);
    phasesByProject.set(phase.projectId, list);
  }

  return allProjects.map((project) => {
    const labor = laborByProject.get(project.id) ?? emptyCostSlice();
    const consultantCost = consultantByProject.get(project.id) ?? 0;
    const costs: CostSlice = { ...labor, consultantCost };
    const billingType = asBillingType(project.billingType, project.contractedFee);
    const phaseInputs = allocateCostsToPhases(
      (phasesByProject.get(project.id) ?? []).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime()),
      laborRowsByProject.get(project.id) ?? [],
      consultantRowsByProject.get(project.id) ?? [],
      rates,
    );
    const budgetHealth = evaluateBudgetHealth({
      billingType,
      contractedFee: project.contractedFee ?? 0,
      laborCost: costs.laborCost,
      billableLaborCost: costs.billableLaborCost,
      consultantCost,
      totalMinutes: costs.totalMinutes,
      billableMinutes: costs.billableMinutes,
      hourlyRateCents: project.hourlyRateCents ?? 0,
      notToExceedCents: project.notToExceedCents ?? 0,
      revenueTargetCents: project.revenueTargetCents ?? 0,
      phases: phaseInputs,
    });
    return {
      projectId: project.id,
      contractedFee: project.contractedFee ?? 0,
      totalCost: costs.laborCost + consultantCost,
      billingType,
      hourlyRateCents: project.hourlyRateCents ?? 0,
      notToExceedCents: project.notToExceedCents ?? 0,
      revenueTargetCents: project.revenueTargetCents ?? 0,
      laborCost: costs.laborCost,
      billableLaborCost: costs.billableLaborCost,
      consultantCost,
      totalMinutes: costs.totalMinutes,
      billableMinutes: costs.billableMinutes,
      budgetHealth,
    };
  });
}

export async function deleteProjectBillingPhases(projectId: number) {
  const db = await getDb();
  if (!db) return;
  try {
    await db.delete(projectBillingPhases).where(eq(projectBillingPhases.projectId, projectId));
  } catch (error) {
    console.warn("[Database] Could not delete project billing phases:", error);
  }
}
