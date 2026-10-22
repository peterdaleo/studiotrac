import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import {
  billingDepartmentEmails,
  clientShareTokens,
  consultantContracts,
  consultantPayments,
  coordinationAttachments,
  coordinationItems,
  coordinationSheets,
  emailLog,
  invoices,
  notifications,
  projectFiles,
  projectNotes,
  projectSubBudgets,
  projectTeamMembers,
  projects,
  prospectInteractions,
  prospects,
  tasks,
  teamAbsences,
  teamMembers,
  timeEntries,
  users,
} from "../drizzle/schema";

type OrgId = number | null | undefined;
type TenantEntity =
  | "project" | "teamMember" | "teamAbsence" | "task" | "invoice" | "projectNote"
  | "projectFile" | "shareToken" | "consultant" | "consultantPayment" | "timeEntry"
  | "billingEmail" | "notification" | "subBudget" | "prospect" | "prospectInteraction"
  | "emailLog" | "coordinationSheet" | "coordinationItem" | "coordinationAttachment"
  | "projectTeamMember" | "user";

function notFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
}

async function rowById(table: any, id: number): Promise<any | undefined> {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  const database = await getDb();
  if (!database) return undefined;
  const rows = await (database as any).select().from(table).where(eq(table.id, id)).limit(1);
  return rows[0];
}

async function belongs(entity: TenantEntity, id: number, organizationId: OrgId): Promise<any> {
  if (!Number.isSafeInteger(organizationId) || organizationId == null || organizationId <= 0) return notFound();
  const tableByEntity: Record<TenantEntity, any> = {
    project: projects,
    teamMember: teamMembers,
    teamAbsence: teamAbsences,
    task: tasks,
    invoice: invoices,
    projectNote: projectNotes,
    projectFile: projectFiles,
    shareToken: clientShareTokens,
    consultant: consultantContracts,
    consultantPayment: consultantPayments,
    timeEntry: timeEntries,
    billingEmail: billingDepartmentEmails,
    notification: notifications,
    subBudget: projectSubBudgets,
    prospect: prospects,
    prospectInteraction: prospectInteractions,
    emailLog,
    coordinationSheet: coordinationSheets,
    coordinationItem: coordinationItems,
    coordinationAttachment: coordinationAttachments,
    projectTeamMember: projectTeamMembers,
    user: users,
  };
  const row = await rowById(tableByEntity[entity], id);
  if (!row) return notFound();
  const legacyProjectOwnedConsultant = entity === "consultant" && row.organizationId == null && row.projectId != null;
  if ("organizationId" in row && row.organizationId !== organizationId && !legacyProjectOwnedConsultant) return notFound();

  switch (entity) {
    case "project":
      if (row.projectManagerId != null) await belongs("teamMember", row.projectManagerId, organizationId);
      break;
    case "teamMember":
      // Staff records and assignments remain firm-owned after a login account leaves.
      // The historical userId is not a membership grant; account operations check users separately.
      break;
    case "user":
      if (row.organizationId !== organizationId) return notFound();
      break;
    case "task":
      await assertTenantEntity("project", row.projectId, organizationId);
      if (row.assigneeId != null) await assertTenantEntity("teamMember", row.assigneeId, organizationId);
      break;
    case "teamAbsence":
      await assertTenantEntity("teamMember", row.teamMemberId, organizationId);
      break;
    case "invoice":
    case "projectNote":
    case "projectFile":
    case "consultant":
    case "emailLog":
      if (row.projectId != null) await assertTenantEntity("project", row.projectId, organizationId);
      if (entity === "consultant" && row.subBudgetId != null) {
        const budget = await assertTenantEntity("subBudget", row.subBudgetId, organizationId);
        if (budget.projectId !== row.projectId) return notFound();
      }
      if (entity === "emailLog") {
        if (row.relatedProjectId != null) await assertTenantEntity("project", row.relatedProjectId, organizationId);
        if (row.relatedTaskId != null) await assertTenantEntity("task", row.relatedTaskId, organizationId);
      }
      break;
    case "timeEntry": {
      await assertTenantEntity("project", row.projectId, organizationId);
      // Historical time stays owned by its stamped org/project after account removal.
      if (row.taskId != null) {
        const task = await assertTenantEntity("task", row.taskId, organizationId);
        if (task.projectId !== row.projectId) return notFound();
      }
      if (row.subBudgetId != null) {
        const budget = await assertTenantEntity("subBudget", row.subBudgetId, organizationId);
        if (budget.projectId !== row.projectId) return notFound();
      }
      break;
    }
    case "shareToken":
      if (row.projectId != null) await assertTenantEntity("project", row.projectId, organizationId);
      break;
    case "notification":
      if (row.userId != null) await assertTenantEntity("user", row.userId, organizationId);
      if (row.relatedProjectId != null) await assertTenantEntity("project", row.relatedProjectId, organizationId);
      if (row.relatedTaskId != null) await assertTenantEntity("task", row.relatedTaskId, organizationId);
      break;
    case "consultantPayment":
      await assertTenantEntity("consultant", row.consultantId, organizationId);
      break;
    case "prospectInteraction":
      await assertTenantEntity("prospect", row.prospectId, organizationId);
      break;
    case "coordinationSheet":
      await assertTenantEntity("project", row.projectId, organizationId);
      break;
    case "subBudget":
      await assertTenantEntity("project", row.projectId, organizationId);
      break;
    case "coordinationItem": {
      const sheet = await assertTenantEntity("coordinationSheet", row.sheetId, organizationId);
      if (row.parentId != null) {
        const parent = await assertTenantEntity("coordinationItem", row.parentId, organizationId);
        if (parent.sheetId !== sheet.id) return notFound();
      }
      break;
    }
    case "coordinationAttachment": {
      const item = await assertTenantEntity("coordinationItem", row.itemId, organizationId);
      if (item.sheetId == null) return notFound();
      break;
    }
    case "projectTeamMember":
      await assertTenantEntity("project", row.projectId, organizationId);
      await assertTenantEntity("teamMember", row.teamMemberId, organizationId);
      break;
  }
  return row;
}

/** Verify that a row and all organization-scoped parents/references belong to the caller. */
export async function assertTenantEntity(entity: TenantEntity, id: number, organizationId: OrgId): Promise<any> {
  return belongs(entity, id, organizationId);
}

/** Verify an explicitly supplied foreign key against a specific same-tenant parent. */
export async function assertTenantReference(
  entity: TenantEntity,
  id: number | null | undefined,
  organizationId: OrgId,
  expectedParent?: { entity: TenantEntity; id: number },
): Promise<any | undefined> {
  if (id == null) return undefined;
  const row = await assertTenantEntity(entity, id, organizationId);
  if (expectedParent) {
    const parentFieldByReferencedEntity: Partial<Record<TenantEntity, string>> = {
      teamAbsence: "teamMemberId", task: "projectId", invoice: "projectId", projectNote: "projectId",
      projectFile: "projectId", shareToken: "projectId", consultant: "projectId", consultantPayment: "consultantId",
      timeEntry: "projectId", notification: "userId", subBudget: "projectId", prospectInteraction: "prospectId",
      coordinationSheet: "projectId", coordinationItem: "sheetId", coordinationAttachment: "itemId", projectTeamMember: "projectId",
    };
    const parentField = parentFieldByReferencedEntity[entity];
    if (!parentField || row[parentField] !== expectedParent.id) return notFound();
    await assertTenantEntity(expectedParent.entity, expectedParent.id, organizationId);
  }
  return row;
}

export async function listOrganizationEmailLog(organizationId: OrgId, limit = 50): Promise<any[]> {
  if (!Number.isSafeInteger(organizationId) || organizationId == null || organizationId <= 0) return notFound();
  const database = await getDb();
  if (!database) return [];
  return (database as any).select().from(emailLog).where(eq(emailLog.organizationId, organizationId)).orderBy(desc(emailLog.sentAt)).limit(limit);
}

export async function filterTenantRows<T extends { id: number }>(entity: TenantEntity, rows: T[], organizationId: OrgId): Promise<T[]> {
  const allowed: T[] = [];
  for (const row of rows) {
    try {
      await assertTenantEntity(entity, row.id, organizationId);
      allowed.push(row);
    } catch (error) {
      if (!(error instanceof TRPCError) || error.code !== "NOT_FOUND") throw error;
    }
  }
  return allowed;
}
