import { assertOrganizationWorkspaceAccess, isOrganizationWorkspaceAccessible, resolveOrganizationWorkspaceAccess } from "./workspaceAccess";
import { platformAccessRouter } from "./platformAccessRouter";
import { createCoordinationNotice } from "./coordinationNotifications";
import { selectCollaboratorVisibleItems } from "./coordinationSharing";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { subscriptionRouter } from "./stripe/router";
import { superAdminRouter } from "./superAdmin/router";
import { publicProcedure, protectedProcedure, adminProcedure, adminOrPmProcedure, superAdminProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import * as prospectsDb from "./prospects";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import { notifyOwner } from "./_core/notification";
import { sendTeamInviteEmail, sendBillingMilestoneEmail } from "./_core/email";
import { createInviteSignupUrl, createInviteToken } from "./_core/invite";
import bcrypt from "bcryptjs";
import { getPlanLimits, type PlanTier } from "@shared/subscription";
import { PROJECT_PHASES, toSubBudgetStatusItem } from "@shared/subBudgets";
import { assertTenantEntity, assertTenantReference, filterTenantRows, listOrganizationEmailLog } from "./tenantAuthorization";
import { getLocalUploadUrl } from "./_core/protectedUploadRoute";
import { validateCoordinationAttachmentUpload } from "./coordinationAttachmentValidation";
// Resend and Twilio are lazy-loaded on first use to avoid OOM on Railway startup.
// The 20MB Twilio package loaded statically was causing the container to crash within ~14s.
let _resend: import("resend").Resend | null = null;
function getResend() {
  if (!_resend) {
    const { Resend } = require("resend");
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend!;
}
let _twilioClient: import("twilio").Twilio | null = null;
function getTwilioClient() {
  if (!_twilioClient) {
    const twilio = require("twilio");
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (accountSid && authToken) {
      _twilioClient = twilio(accountSid, authToken);
    }
  }
  return _twilioClient;
}

/**
 * Helper: resolve the current org's plan limits.
 * Super-admins bypass all gates.
 * Members of a superAdmin-owned org also get enterprise limits (no plan restrictions).
 */
async function getOrgPlanLimits(ctx: { user: { isSuperAdmin: boolean }; organizationId: number | null }) {
  const access = await resolveOrganizationWorkspaceAccess(ctx.organizationId, ctx.user.isSuperAdmin);
  if (access.managed) return getPlanLimits(access.plan);
  if (ctx.user.isSuperAdmin) return getPlanLimits("enterprise");
  if (!ctx.organizationId) return getPlanLimits(null);
  // If the org owner is a superAdmin, all org members get enterprise limits
  const ownerIsSuperAdmin = await db.orgHasSuperAdminOwner(ctx.organizationId);
  if (ownerIsSuperAdmin) return getPlanLimits("enterprise");
  const sub = await db.getActiveSubscriptionByOrg(ctx.organizationId);
  return getPlanLimits((sub?.plan as PlanTier) ?? null);
}

function requireFeature(has: boolean, featureName: string) {
  if (!has) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Upgrade your plan to access ${featureName}.`,
    });
  }
}

async function requireCoordinationItem(sheet: { id: number; organizationId: number | null; clientToken?: string | null }, itemId: number, token: string) {
  const item = await assertTenantEntity("coordinationItem", itemId, sheet.organizationId);
  if (item.sheetId !== sheet.id || (sheet.clientToken === token && item.visibility !== "client")) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
  }
  return item;
}

function requireProspectOrganization(organizationId: number | null) {
  if (organizationId == null) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Prospects require an organization workspace." });
  }
  return organizationId;
}

const absenceTypeSchema = z.enum(["full_day", "partial_day", "work_from_home"]);

const teamAbsenceSchema = z.object({
  teamMemberId: z.number(),
  absenceType: absenceTypeSchema,
  startDate: z.date(),
  endDate: z.date(),
  startTimeMinutes: z.number().min(0).max(1439).optional().nullable(),
  endTimeMinutes: z.number().min(0).max(1439).optional().nullable(),
  notes: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.endDate < value.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "End date must be on or after the start date",
    });
  }

  if (value.absenceType === "partial_day") {
    if (value.startTimeMinutes == null || value.endTimeMinutes == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startTimeMinutes"],
        message: "Partial day absences require a start and end time",
      });
    } else if (value.endTimeMinutes <= value.startTimeMinutes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endTimeMinutes"],
        message: "End time must be after the start time",
      });
    }

    // Compare UTC date parts to avoid timezone-shift false positives
    // (client sends local midnight/23:59 which can shift to a different UTC day on the server)
    const sameUTCDay =
      value.startDate.getUTCFullYear() === value.endDate.getUTCFullYear() &&
      value.startDate.getUTCMonth() === value.endDate.getUTCMonth() &&
      value.startDate.getUTCDate() === value.endDate.getUTCDate();
    // Also allow end to be at most 23h59m ahead (covers T00:00:00 → T23:59:59 local → next UTC day)
    const diffMs = value.endDate.getTime() - value.startDate.getTime();
    const withinOneDay = diffMs >= 0 && diffMs < 24 * 60 * 60 * 1000;
    if (!sameUTCDay && !withinOneDay) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "Partial day absences must start and end on the same day",
      });
    }
  }
});

export const appRouter = router({
  platformAccess: platformAccessRouter,
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ── Team Members ─────────────────────────────────────────────
  teamMembers: router({
    list: protectedProcedure.query(async ({ ctx }) => filterTenantRows("teamMember", await db.listTeamMembers(ctx.organizationId), ctx.organizationId)),
    get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("teamMember", input.id, ctx.organizationId);
      return db.getTeamMember(input.id);
    }),
    create: adminProcedure.input(z.object({
      name: z.string().min(1),
      email: z.string().email().optional(),
      title: z.string().optional(),
      avatarColor: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const limits = await getOrgPlanLimits(ctx);
      const existing = await db.listTeamMembers(ctx.organizationId);
      if (existing.length >= limits.maxTeamMembers) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Your plan allows up to ${limits.maxTeamMembers} team members. Upgrade to add more.`,
        });
      }
      return db.createTeamMember(input, ctx.organizationId);
    }),
    update: adminProcedure.input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      email: z.string().email().optional().nullable(),
      title: z.string().optional().nullable(),
      avatarColor: z.string().optional(),
      isActive: z.boolean().optional(),
      billingRate: z.number().min(0).optional(),
     })).mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await assertTenantEntity("teamMember", id, ctx.organizationId);
      return db.updateTeamMember(id, data);
    }),
    delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("teamMember", input.id, ctx.organizationId);
      return db.deleteTeamMember(input.id);
    }),
    stats: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("teamMember", input.id, ctx.organizationId);
      return db.getTeamMemberStats(input.id);
    }),
    updateRole: adminProcedure.input(z.object({
      userId: z.number(),
      role: z.enum(["user", "pm", "admin"]),
    })).mutation(async ({ input, ctx }) => {
      // Prevent admin from demoting themselves
      if (input.userId === ctx.user.id && input.role !== "admin") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot change your own role" });
      }
      await assertTenantEntity("user", input.userId, ctx.organizationId);
      await db.updateUserRole(input.userId, input.role, ctx.organizationId);
      return { success: true };
    }),
    listUsers: adminProcedure.query(({ ctx }) => db.listUsers(ctx.organizationId)),
    removeUser: adminProcedure.input(z.object({ userId: z.number() })).mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot remove yourself from the organization" });
      }
      await assertTenantEntity("user", input.userId, ctx.organizationId);
      await db.removeFromOrganization(input.userId, ctx.organizationId);
      return { success: true };
    }),
    resetPassword: adminProcedure.input(z.object({
      userId: z.number(),
      newPassword: z.string().min(6, "Password must be at least 6 characters"),
    })).mutation(async ({ input, ctx }) => {
      // Prevent admin from using this on themselves (they can use normal settings)
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Use your account settings to change your own password" });
      }
      // Verify the target user exists and uses email/password auth
      await assertTenantEntity("user", input.userId, ctx.organizationId);
      const targetUser = await db.getUserById(input.userId);
      if (!targetUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      if (targetUser.loginMethod !== "email") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This user signed up with Google and does not have a password to reset" });
      }
      const passwordHash = await bcrypt.hash(input.newPassword, 12);
      await db.updateUserPassword(input.userId, passwordHash, ctx.organizationId);
      return { success: true };
    }),
    invite: adminProcedure.input(z.object({
      name: z.string().min(1),
      email: z.string().email(),
      title: z.string().optional(),
      role: z.enum(["user", "pm", "admin"]).optional(),
      origin: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      // Enforce team member limit
      const limits = await getOrgPlanLimits(ctx);
      const existing = await db.listTeamMembers(ctx.organizationId);
      if (existing.length >= limits.maxTeamMembers) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Your plan allows up to ${limits.maxTeamMembers} team members. Upgrade to add more.`,
        });
      }
      const normalizedEmail = input.email.trim().toLowerCase();
      const role = input.role ?? "user";
      const result = await db.inviteTeamMember({
        ...input,
        email: normalizedEmail,
        role,
      }, ctx.organizationId);

      const inviteToken = await createInviteToken({
        email: normalizedEmail,
        role,
        teamMemberId: result.id,
        name: input.name.trim(),
        title: input.title?.trim() || null,
      });
      const signupUrl = createInviteSignupUrl(input.origin, inviteToken);

      let emailSent = false;
      try {
        const emailResult = await sendTeamInviteEmail({
          to: normalizedEmail,
          inviteeName: input.name,
          invitedByName: ctx.user.name,
          role,
          title: input.title,
          signupUrl,
        });
        emailSent = emailResult.sent;
      } catch (e) {
        console.warn("[Invite] Email delivery failed:", e);
      }

      try {
        await notifyOwner({
          title: `New Team Invite: ${input.name}`,
          content: `${input.name} (${normalizedEmail}) has been invited as ${role === "admin" ? "Admin" : role === "pm" ? "Project Manager" : "Staff"}.${emailSent ? " Invitation email sent successfully." : " Invitation was created, but email delivery was skipped or failed."}`,
        });
      } catch (e) {
        // Non-blocking: invite still succeeds even if notification fails
        console.warn("[Invite] Notification failed:", e);
      }

      return { success: true, teamMemberId: result.id, emailSent };
    }),
  }),

  // ── Team Absences ───────────────────────────────────────────
  teamAbsences: router({
    list: protectedProcedure.input(z.object({
      teamMemberId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }).optional()).query(async ({ input, ctx }) => {
      if (input?.teamMemberId != null) await assertTenantEntity("teamMember", input.teamMemberId, ctx.organizationId);
      return filterTenantRows("teamAbsence", await db.listTeamAbsences(input ?? undefined, ctx.organizationId), ctx.organizationId);
    }),
    get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("teamAbsence", input.id, ctx.organizationId);
      return db.getTeamAbsence(input.id);
    }),
    create: protectedProcedure.input(teamAbsenceSchema).mutation(async ({ input, ctx }) => {
      const member = await assertTenantEntity("teamMember", input.teamMemberId, ctx.organizationId);
      if (ctx.user.role !== "admin" && member.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "You can only request absence for yourself" });
      const isAdmin = ctx.user.role === "admin";
      const approvalStatus = isAdmin ? "approved" : "pending";
      const absence = await db.createTeamAbsence({
        ...input,
        notes: input.notes ?? null,
        startTimeMinutes: input.startTimeMinutes ?? null,
        endTimeMinutes: input.endTimeMinutes ?? null,
        approvalStatus,
        createdById: ctx.user.id,
      }, ctx.organizationId);
      // Notify admins when a non-admin submits a request
      if (!isAdmin && ctx.organizationId) {
        const startStr = input.startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
        const endStr = input.endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
        const members = await db.listTeamMembers(ctx.organizationId);
        const member = members.find(m => m.id === input.teamMemberId);
        const memberName = member?.name ?? "A team member";
        await db.createNotification({
          title: `${memberName} requested time off`,
          message: `${memberName} requested PTO from ${startStr}\u2013${endStr}. Review in the Calendar.`,
          type: "general",
        }, ctx.organizationId);
      }
      return absence;
    }),
    update: protectedProcedure.input(teamAbsenceSchema.safeExtend({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const absence = await assertTenantEntity("teamAbsence", id, ctx.organizationId);
      const member = await assertTenantEntity("teamMember", data.teamMemberId, ctx.organizationId);
      if (ctx.user.role !== "admin" && (absence.createdById !== ctx.user.id || member.userId !== ctx.user.id)) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return db.updateTeamAbsence(id, {
        ...data,
        notes: data.notes ?? null,
        startTimeMinutes: data.startTimeMinutes ?? null,
        endTimeMinutes: data.endTimeMinutes ?? null,
      });
    }),
    approve: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("teamAbsence", input.id, ctx.organizationId);
      await db.updateTeamAbsence(input.id, { approvalStatus: "approved" });
      // Notify the requesting user
      const absence = await db.getTeamAbsence(input.id);
      if (absence && ctx.organizationId) {
        const startStr = new Date(absence.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
        const endStr = new Date(absence.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
        const members = await db.listTeamMembers(ctx.organizationId);
        const member = members.find(m => m.id === absence.teamMemberId);
        if (member?.userId) {
          await db.createNotification({
            title: "Absence request approved",
            message: `Your time off request for ${startStr}\u2013${endStr} was approved.`,
            type: "general",
            userId: member.userId,
          }, ctx.organizationId);
        }
      }
      return { success: true };
    }),
    reject: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("teamAbsence", input.id, ctx.organizationId);
      await db.updateTeamAbsence(input.id, { approvalStatus: "rejected" });
      // Notify the requesting user
      const absence = await db.getTeamAbsence(input.id);
      if (absence && ctx.organizationId) {
        const startStr = new Date(absence.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
        const endStr = new Date(absence.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
        const members = await db.listTeamMembers(ctx.organizationId);
        const member = members.find(m => m.id === absence.teamMemberId);
        if (member?.userId) {
          await db.createNotification({
            title: "Absence request rejected",
            message: `Your time off request for ${startStr}\u2013${endStr} was rejected.`,
            type: "general",
            userId: member.userId,
          }, ctx.organizationId);
        }
      }
      return { success: true };
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const absence = await assertTenantEntity("teamAbsence", input.id, ctx.organizationId);
      if (ctx.user.role !== "admin" && (absence.createdById !== ctx.user.id || absence.approvalStatus !== "pending")) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return db.deleteTeamAbsence(input.id);
    }),
  }),

  // ── Prospects ────────────────────────────────────────────────
  prospects: router({
    list: adminOrPmProcedure.query(({ ctx }) => prospectsDb.listProspects(requireProspectOrganization(ctx.organizationId))),
    create: adminOrPmProcedure.input(z.object({
      firm: z.string().trim().max(255).optional().nullable(),
      opportunityName: z.string().trim().min(1).max(500),
      contact: z.string().trim().max(500).optional().nullable(),
      referralSource: z.string().trim().max(255).optional().nullable(),
      stage: z.enum(["New", "Contacted", "Proposal", "Negotiation", "Won", "Lost"]).optional(),
      ownerId: z.number().int().positive().optional().nullable(),
      nextFollowUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      lastInteractionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    })).mutation(({ input, ctx }) => prospectsDb.createProspect(input, requireProspectOrganization(ctx.organizationId), ctx.user.id)),
    update: adminOrPmProcedure.input(z.object({
      id: z.number().int().positive(),
      firm: z.string().trim().max(255).optional().nullable(),
      opportunityName: z.string().trim().min(1).max(500).optional(),
      contact: z.string().trim().max(500).optional().nullable(),
      referralSource: z.string().trim().max(255).optional().nullable(),
      stage: z.enum(["New", "Contacted", "Proposal", "Negotiation", "Won", "Lost"]).optional(),
      ownerId: z.number().int().positive().optional().nullable(),
      nextFollowUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      lastInteractionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    })).mutation(({ input, ctx }) => {
      const { id, ...patch } = input;
      return prospectsDb.updateProspect(id, patch, requireProspectOrganization(ctx.organizationId));
    }),
    addInteraction: adminOrPmProcedure.input(z.object({
      prospectId: z.number().int().positive(),
      type: z.enum(["note", "call", "email", "meeting", "proposal"]),
      content: z.string().trim().min(1).max(10000),
      happenedAt: z.date(),
      lastInteractionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      isPrivate: z.boolean().default(false),
    })).mutation(({ input, ctx }) => prospectsDb.addProspectInteraction(input, requireProspectOrganization(ctx.organizationId), ctx.user.id)),
    convertToProject: adminOrPmProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ input, ctx }) => {
      const organizationId = requireProspectOrganization(ctx.organizationId);
      const limits = await getOrgPlanLimits(ctx);
      const existingProjects = await db.listProjects(undefined, organizationId);
      const activeProjects = existingProjects.filter((project: any) => project.status !== "completed");
      if (activeProjects.length >= limits.maxProjects) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Your plan allows up to ${limits.maxProjects} active projects. Upgrade to add more.`,
        });
      }
      return prospectsDb.convertProspectToProject(input.id, organizationId);
    }),
  }),

  // ── Approved Project Sub-Budgets ────────────────────────────
  subBudgets: router({
    status: protectedProcedure.input(z.object({ projectId: z.number().int().positive() }))
      .query(async ({ input, ctx }) => {
        await db.assertProjectInOrganization(input.projectId, ctx.organizationId);
        const summary = await db.listProjectSubBudgets(input.projectId, ctx.organizationId);
        return summary.items.map(toSubBudgetStatusItem);
      }),
    list: adminOrPmProcedure.input(z.object({ projectId: z.number().int().positive() }))
      .query(async ({ input, ctx }) => {
        return db.listProjectSubBudgets(input.projectId, ctx.organizationId);
      }),
    options: protectedProcedure.input(z.object({ projectId: z.number().int().positive() }))
      .query(async ({ input, ctx }) => {
        return db.listProjectSubBudgetOptions(input.projectId, ctx.organizationId);
      }),
    create: adminOrPmProcedure.input(z.object({
      projectId: z.number().int().positive(),
      name: z.string().trim().min(1).max(255),
      phase: z.enum(PROJECT_PHASES).nullable().optional(),
      description: z.string().nullable().optional(),
      budgetCents: z.number().int().min(0),
      kind: z.enum(["within_existing", "approved_addition"]),
      trackingMode: z.enum(["fixed_amount", "hourly"]).default("fixed_amount"),
      notToExceedCents: z.number().int().min(0).nullable().optional(),
    }).superRefine((value, issue) => {
      if (value.trackingMode === "fixed_amount" && value.notToExceedCents != null) {
        issue.addIssue({ code: z.ZodIssueCode.custom, path: ["notToExceedCents"], message: "NTE applies only to hourly sub-budgets" });
      }
    })).mutation(async ({ input, ctx }) => {
      return db.createProjectSubBudget({
      ...input,
      phase: input.phase ?? null,
      description: input.description ?? null,
      }, ctx.organizationId);
    }),
    update: adminOrPmProcedure.input(z.object({
      id: z.number().int().positive(),
      name: z.string().trim().min(1).max(255).optional(),
      phase: z.enum(PROJECT_PHASES).nullable().optional(),
      description: z.string().nullable().optional(),
      budgetCents: z.number().int().min(0).optional(),
      kind: z.enum(["within_existing", "approved_addition"]).optional(),
      trackingMode: z.enum(["fixed_amount", "hourly"]).optional(),
      notToExceedCents: z.number().int().min(0).nullable().optional(),
    }).superRefine((value, issue) => {
      if (value.trackingMode === "fixed_amount" && value.notToExceedCents != null) {
        issue.addIssue({ code: z.ZodIssueCode.custom, path: ["notToExceedCents"], message: "NTE applies only to hourly sub-budgets" });
      }
    })).mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      return db.updateProjectSubBudget(id, data, ctx.organizationId);
    }),
    delete: adminOrPmProcedure.input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        return db.deleteProjectSubBudget(input.id, ctx.organizationId);
      }),
  }),

  // ── Projects ─────────────────────────────────────────────────
  projects: router({
    list: protectedProcedure.input(z.object({
      status: z.string().optional(),
      phase: z.string().optional(),
      managerId: z.number().optional(),
    }).optional()).query(async ({ input, ctx }) => {
      if (input?.managerId != null) await assertTenantEntity("teamMember", input.managerId, ctx.organizationId);
      return filterTenantRows("project", await db.listProjects(input ?? undefined, ctx.organizationId), ctx.organizationId);
    }),
    get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.id, ctx.organizationId);
      return db.getProject(input.id);
    }),
    financialSummary: adminOrPmProcedure.input(z.object({ id: z.number() })).query(async ({ input, ctx }) => {
      await db.assertProjectInOrganization(input.id, ctx.organizationId);
      const project = await db.getProject(input.id);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
      const subBudgetSummary = await db.listProjectSubBudgets(input.id, ctx.organizationId);
      return {
        id: project.id,
        contractedFee: project.contractedFee,
        invoicedAmount: project.invoicedAmount,
        completionPercentage: project.completionPercentage,
        billingOk: project.billingOk,
        billing25: project.billing25,
        billing50: project.billing50,
        billing75: project.billing75,
        billing100: project.billing100,
        billingType: project.billingType,
        hourlyRateCents: project.hourlyRateCents,
        notToExceedCents: project.notToExceedCents,
        revenueTargetCents: project.revenueTargetCents,
        originalBudgetCents: subBudgetSummary.originalBudgetCents,
        approvedAdditionsCents: subBudgetSummary.approvedAdditionsCents,
        approvedBudgetCents: subBudgetSummary.approvedBudgetCents,
      };
    }),
    create: adminOrPmProcedure.input(z.object({
      name: z.string().min(1),
      clientName: z.string().optional(),
      address: z.string().optional(),
      projectManagerId: z.number().optional().nullable(),
      status: z.enum(["on_track", "on_hold", "delayed", "completed"]).optional(),
      phase: z.enum(["pre_design", "schematic_design", "design_development", "construction_documents", "bidding_negotiation", "construction_administration", "post_occupancy"]).optional(),
      completionPercentage: z.number().min(0).max(100).optional(),
      startDate: z.date().optional().nullable(),
      deadline: z.date().optional().nullable(),
      description: z.string().optional(),
      billing25: z.boolean().optional(),
      billing50: z.boolean().optional(),
      billing75: z.boolean().optional(),
      billing100: z.boolean().optional(),
      billingOk: z.boolean().optional(),
      contractedFee: z.number().optional(),
      billingType: z.enum(["fixed_fee", "hourly"]).optional(),
      hourlyRateCents: z.number().int().min(0).optional(),
      notToExceedCents: z.number().int().min(0).optional(),
      revenueTargetCents: z.number().int().min(0).optional(),
      driveFolderUrl: z.string().optional().nullable(),
    })).mutation(async ({ input, ctx }) => {
      await assertTenantReference("teamMember", input.projectManagerId, ctx.organizationId);
      const limits = await getOrgPlanLimits(ctx);
      const allProjects = await db.listProjects(undefined, ctx.organizationId);
      const activeProjects = allProjects.filter((p: any) => p.status !== "completed");
      if (activeProjects.length >= limits.maxProjects) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Your plan allows up to ${limits.maxProjects} active projects. Upgrade to add more.`,
        });
      }
      // Auto-set start date to today if not provided
      if (!input.startDate) {
        input.startDate = new Date();
      }
      return db.createProject(input, ctx.organizationId);
    }),
    update: adminOrPmProcedure.input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      clientName: z.string().optional().nullable(),
      address: z.string().optional().nullable(),
      projectManagerId: z.number().optional().nullable(),
      status: z.enum(["on_track", "on_hold", "delayed", "completed"]).optional(),
      phase: z.enum(["pre_design", "schematic_design", "design_development", "construction_documents", "bidding_negotiation", "construction_administration", "post_occupancy"]).optional(),
      completionPercentage: z.number().min(0).max(100).optional(),
      startDate: z.date().optional().nullable(),
      deadline: z.date().optional().nullable(),
      description: z.string().optional().nullable(),
      billing25: z.boolean().optional(),
      billing50: z.boolean().optional(),
      billing75: z.boolean().optional(),
      billing100: z.boolean().optional(),
      billingOk: z.boolean().optional(),
      contractedFee: z.number().optional(),
      billingType: z.enum(["fixed_fee", "hourly"]).optional(),
      hourlyRateCents: z.number().int().min(0).optional(),
      notToExceedCents: z.number().int().min(0).optional(),
      revenueTargetCents: z.number().int().min(0).optional(),
      billingChangeDate: z.date().optional().nullable(),
      billingChangeNotes: z.string().optional().nullable(),
      driveFolderUrl: z.string().optional().nullable(),
    })).mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await assertTenantEntity("project", id, ctx.organizationId);
      if (data.projectManagerId !== undefined) await assertTenantReference("teamMember", data.projectManagerId, ctx.organizationId);

      // If completionPercentage is being updated, check for milestone triggers
      if (data.completionPercentage !== undefined) {
        const currentProject = await db.getProject(id);
        if (currentProject) {
          const pct = data.completionPercentage;
          const milestonesToTrigger: Array<{ field: 'billing25' | 'billing50' | 'billing75' | 'billing100'; threshold: number }> = [];

          if (pct >= 25 && !currentProject.billing25 && !data.billing25) {
            data.billing25 = true;
            milestonesToTrigger.push({ field: 'billing25', threshold: 25 });
          }
          if (pct >= 50 && !currentProject.billing50 && !data.billing50) {
            data.billing50 = true;
            milestonesToTrigger.push({ field: 'billing50', threshold: 50 });
          }
          if (pct >= 75 && !currentProject.billing75 && !data.billing75) {
            data.billing75 = true;
            milestonesToTrigger.push({ field: 'billing75', threshold: 75 });
          }
          if (pct >= 100 && !currentProject.billing100 && !data.billing100) {
            data.billing100 = true;
            milestonesToTrigger.push({ field: 'billing100', threshold: 100 });
          }

          // Send email notifications for newly triggered milestones
          if (milestonesToTrigger.length > 0) {
            const billingEmails = await db.listBillingDepartmentEmails(ctx.organizationId);
            const recipients = billingEmails.map(e => e.emailAddress);
            if (recipients.length > 0) {
              for (const milestone of milestonesToTrigger) {
                await sendBillingMilestoneEmail({
                  to: recipients,
                  projectName: currentProject.name,
                  clientName: currentProject.clientName || undefined,
                  milestonePercentage: milestone.threshold,
                  completionPercentage: pct,
                  projectId: id,
                }).catch(err => console.error('[BillingMilestone] Email send failed:', err));
              }
            }
          }
        }
      }

      return db.updateProject(id, data);
    }),
    delete: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.id, ctx.organizationId);
      return db.deleteProject(input.id);
    }),
    purgeArchived: adminProcedure.mutation(({ ctx }) => {
      if (ctx.organizationId == null) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
      return db.purgeArchivedProjects(ctx.organizationId);
    }),
    billingPhases: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      return db.listProjectBillingPhases(input.projectId);
    }),
  }),

  // ── Tasks ────────────────────────────────────────────────────
  tasks: router({
    list: protectedProcedure.input(z.object({
      projectId: z.number().optional(),
      assigneeId: z.number().optional(),
      status: z.string().optional(),
    }).optional()).query(async ({ input, ctx }) => {
      if (input?.projectId != null) await assertTenantEntity("project", input.projectId, ctx.organizationId);
      if (input?.assigneeId != null) await assertTenantEntity("teamMember", input.assigneeId, ctx.organizationId);
      return filterTenantRows("task", await db.listTasks(input ?? undefined, ctx.organizationId), ctx.organizationId);
    }),
    get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("task", input.id, ctx.organizationId);
      return db.getTask(input.id);
    }),
    create: protectedProcedure.input(z.object({
      projectId: z.number(),
      assigneeId: z.number().optional().nullable(),
      title: z.string().min(1),
      description: z.string().optional(),
      status: z.enum(["todo", "in_progress", "done"]).optional(),
      priority: z.number().min(1).max(20).optional(),
      sortOrder: z.number().optional(),
      startDate: z.date().optional().nullable(),
      deadline: z.date().optional().nullable(),
    })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      await assertTenantReference("teamMember", input.assigneeId, ctx.organizationId);
      return db.createTask(input, ctx.organizationId);
    }),
    update: protectedProcedure.input(z.object({
      id: z.number(),
      assigneeId: z.number().optional().nullable(),
      title: z.string().min(1).optional(),
      description: z.string().optional().nullable(),
      status: z.enum(["todo", "in_progress", "done"]).optional(),
      priority: z.number().min(1).max(20).optional(),
      sortOrder: z.number().optional(),
      startDate: z.date().optional().nullable(),
      deadline: z.date().optional().nullable(),
      completedAt: z.date().optional().nullable(),
    })).mutation(async ({ input, ctx }) => {
      const task = await assertTenantEntity("task", input.id, ctx.organizationId);
      await assertTenantReference("teamMember", input.assigneeId, ctx.organizationId);
      if (ctx.user.role !== "admin") {
        if (task.assigneeId == null) throw new TRPCError({ code: "FORBIDDEN", message: "You can only update tasks assigned to you" });
        const assignee = await assertTenantEntity("teamMember", task.assigneeId, ctx.organizationId);
        if (assignee.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "You can only update tasks assigned to you" });
        if (input.assigneeId !== undefined && input.assigneeId !== task.assigneeId) throw new TRPCError({ code: "FORBIDDEN", message: "You cannot reassign this task" });
      }
      const { id, ...data } = input;
      return db.updateTask(id, data, ctx.organizationId);
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const task = await assertTenantEntity("task", input.id, ctx.organizationId);
      if (ctx.user.role !== "admin") {
        if (task.assigneeId == null) throw new TRPCError({ code: "FORBIDDEN", message: "You can only delete tasks assigned to you" });
        const assignee = await assertTenantEntity("teamMember", task.assigneeId, ctx.organizationId);
        if (assignee.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "You can only delete tasks assigned to you" });
      }
      return db.deleteTask(input.id, ctx.organizationId);
    }),
    reorder: protectedProcedure.input(z.object({
      taskOrders: z.array(z.object({ id: z.number(), sortOrder: z.number() })),
    })).mutation(async ({ input, ctx }) => {
      await Promise.all(input.taskOrders.map(({ id }) => assertTenantEntity("task", id, ctx.organizationId)));
      return db.reorderTasks(input.taskOrders);
    }),
    purgeArchived: adminProcedure.mutation(({ ctx }) => {
      if (ctx.organizationId == null) throw new TRPCError({ code: "FORBIDDEN", message: "Organization required" });
      return db.purgeArchivedTasks(ctx.organizationId);
    }),
  }),

  // ── Project Notes ────────────────────────────────────────────
  notes: router({
    list: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      return filterTenantRows("projectNote", await db.listProjectNotes(input.projectId), ctx.organizationId);
    }),
    create: protectedProcedure.input(z.object({
      projectId: z.number(),
      content: z.string().min(1),
      isClientVisible: z.boolean().optional(),
    })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      return db.createProjectNote({ ...input, authorId: ctx.user.id, organizationId: ctx.organizationId });
    }),
    update: protectedProcedure.input(z.object({
      id: z.number(),
      content: z.string().min(1).optional(),
      isClientVisible: z.boolean().optional(),
    })).mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await assertTenantEntity("projectNote", id, ctx.organizationId);
      return db.updateProjectNote(id, data);
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("projectNote", input.id, ctx.organizationId);
      return db.deleteProjectNote(input.id);
    }),
  }),

  // ── Project Files ────────────────────────────────────────────
  files: router({
    list: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      return filterTenantRows("projectFile", await db.listProjectFiles(input.projectId, ctx.organizationId), ctx.organizationId);
    }),
    upload: protectedProcedure.input(z.object({
      projectId: z.number(),
      fileName: z.string().min(1),
      fileData: z.string(), // base64 encoded
      mimeType: z.string().optional(),
      fileSize: z.number().optional(),
      category: z.enum(["document", "drawing", "image", "other"]).optional(),
    })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      const buffer = Buffer.from(input.fileData, "base64");
      const ext = input.fileName.split(".").pop() || "bin";
      const fileKey = `projects/${input.projectId}/files/${nanoid()}.${ext}`;
      const url = getLocalUploadUrl(fileKey);
      if (!url) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid upload key" });
      await storagePut(fileKey, buffer, input.mimeType || "application/octet-stream");
      return db.createProjectFile({
        organizationId: ctx.organizationId,
        projectId: input.projectId,
        uploadedById: ctx.user.id,
        fileName: input.fileName,
        url,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        category: input.category || "other",
        isClientVisible: false,
      });
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("projectFile", input.id, ctx.organizationId);
      return db.deleteProjectFile(input.id);
    }),
    count: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      return db.getProjectFileCount(input.projectId, ctx.organizationId);
    }),
  }),

  // ── Invoices ────────────────────────────────────────────────
  invoices: router({
    list: adminOrPmProcedure.input(z.object({ projectId: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      return filterTenantRows("invoice", await db.listInvoices(input.projectId), ctx.organizationId);
    }),
    create: adminOrPmProcedure.input(z.object({
      projectId: z.number(),
      amount: z.number().min(0),
      description: z.string().optional(),
      invoiceNumber: z.string().optional(),
      status: z.enum(["draft", "sent", "paid", "overdue"]).optional(),
      invoiceDate: z.date().optional(),
      dueDate: z.date().optional().nullable(),
      paidDate: z.date().optional().nullable(),
    })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      return db.createInvoice(input, ctx.organizationId);
    }),
    update: adminOrPmProcedure.input(z.object({
      id: z.number(),
      amount: z.number().min(0).optional(),
      description: z.string().optional().nullable(),
      invoiceNumber: z.string().optional().nullable(),
      status: z.enum(["draft", "sent", "paid", "overdue"]).optional(),
      invoiceDate: z.date().optional(),
      dueDate: z.date().optional().nullable(),
      paidDate: z.date().optional().nullable(),
    })).mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await assertTenantEntity("invoice", id, ctx.organizationId);
      return db.updateInvoice(id, data);
    }),
    delete: adminOrPmProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("invoice", input.id, ctx.organizationId);
      return db.deleteInvoice(input.id);
    }),
  }),

  // ── Financial Overview ──────────────────────────────────────
  financials: router({
    overview: adminProcedure.query(async ({ ctx }) => {
      const limits = await getOrgPlanLimits(ctx);
      requireFeature(limits.hasFinancials, "Financials");
      return db.getFinancialOverview(ctx.organizationId);
    }),
  }),

  // ── Exports ─────────────────────────────────────────────────
  exports: router({
    projectsSummary: protectedProcedure.query(async ({ ctx }) => {
      const limits = await getOrgPlanLimits(ctx);
      requireFeature(limits.hasAdvancedReports, "CSV Exports");
      return db.getExportProjectsSummary(ctx.organizationId);
    }),
    tasksList: protectedProcedure.query(async ({ ctx }) => {
      const limits = await getOrgPlanLimits(ctx);
      requireFeature(limits.hasAdvancedReports, "CSV Exports");
      return db.getExportTasksList(ctx.organizationId);
    }),
    teamWorkload: protectedProcedure.query(async ({ ctx }) => {
      const limits = await getOrgPlanLimits(ctx);
      requireFeature(limits.hasAdvancedReports, "CSV Exports");
      return db.getExportTeamWorkload(ctx.organizationId);
    }),
  }),

  // ── Notifications ────────────────────────────────────────────
  notifications: router({
    list: protectedProcedure.query(({ ctx }) => db.listNotifications(ctx.user.id, 50, ctx.organizationId)),
    unreadCount: protectedProcedure.query(({ ctx }) => db.getUnreadNotificationCount(ctx.user.id, ctx.organizationId)),
    markRead: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const notification = await assertTenantEntity("notification", input.id, ctx.organizationId);
      if (notification.userId != null && notification.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return db.markNotificationRead(input.id);
    }),
    markAllRead: protectedProcedure.mutation(({ ctx }) => db.markAllNotificationsRead(ctx.user.id, ctx.organizationId)),
  }),

  // ── Billing Department Emails ────────────────────────────────
  billingEmails: router({
    list: adminProcedure.query(({ ctx }) => db.listBillingDepartmentEmails(ctx.organizationId)),
    add: adminProcedure.input(z.object({
      emailAddress: z.string().email(),
    })).mutation(({ input, ctx }) => db.addBillingDepartmentEmail(input.emailAddress, ctx.organizationId)),
    remove: adminProcedure.input(z.object({
      id: z.number(),
    })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("billingEmail", input.id, ctx.organizationId);
      return db.removeBillingDepartmentEmail(input.id);
    }),
  }),

  // ── Email Preferences ───────────────────────────────────────
  emailPreferences: router({
    get: protectedProcedure.query(({ ctx }) => db.getEmailPreferences(ctx.user.id)),
    upsert: protectedProcedure.input(z.object({
      deadlineAlerts: z.boolean().optional(),
      overdueAlerts: z.boolean().optional(),
      statusChangeAlerts: z.boolean().optional(),
      alertDaysBefore: z.number().min(1).max(14).optional(),
    }).strict()).mutation(({ input, ctx }) => db.upsertEmailPreferences(ctx.user.id, input)),
  }),

  // ── Email Notifications ─────────────────────────────────────
  emailNotifications: router({
    log: protectedProcedure.query(async ({ ctx }) => filterTenantRows("emailLog", await listOrganizationEmailLog(ctx.organizationId), ctx.organizationId)),
    checkDeadlines: protectedProcedure.mutation(async ({ ctx }) => {
      const tasks3Day = await filterTenantRows("task", await db.getUpcomingDeadlineTasks(3), ctx.organizationId);
      const tasks1Day = await filterTenantRows("task", await db.getUpcomingDeadlineTasks(1), ctx.organizationId);
      const overdueTasks = await filterTenantRows("task", await db.getOverdueTasks(), ctx.organizationId);
      const projects3Day = await filterTenantRows("project", await db.getUpcomingDeadlineProjects(3), ctx.organizationId);

      const alerts: Array<{ type: string; title: string; message: string; daysUntil?: number }> = [];

      for (const task of tasks1Day) {
        alerts.push({ type: "task_deadline_1day", title: `Urgent: "${task.title}" due tomorrow`, message: `Task is due on ${task.deadline?.toLocaleDateString()}`, daysUntil: 1 });
      }
      for (const task of tasks3Day) {
        if (!tasks1Day.some(t => t.id === task.id)) {
          alerts.push({ type: "task_deadline_3day", title: `Upcoming: "${task.title}" due in 3 days`, message: `Task deadline is ${task.deadline?.toLocaleDateString()}`, daysUntil: 3 });
        }
      }
      for (const task of overdueTasks) {
        alerts.push({ type: "task_overdue", title: `Overdue: "${task.title}"`, message: `Task was due on ${task.deadline?.toLocaleDateString()}` });
      }
      for (const project of projects3Day) {
        alerts.push({ type: "project_deadline", title: `Project deadline approaching: "${project.name}"`, message: `Project deadline is ${project.deadline?.toLocaleDateString()}` });
      }

      for (const alert of alerts) {
        await db.createNotification({
          type: alert.type.includes("overdue") ? "task_overdue" : "deadline_approaching",
          title: alert.title,
          message: alert.message,
        }, ctx.organizationId);
      }
      for (const alert of alerts) {
        await db.logEmail({ recipientEmail: "team@studio.com", subject: alert.title, body: alert.message, organizationId: ctx.organizationId });
      }
      if (alerts.length > 0) {
        await notifyOwner({ title: `studioTrac: ${alerts.length} deadline alert(s)`, content: alerts.map(a => `• ${a.title}`).join("\n") }).catch(() => {});
      }
      return { alertsGenerated: alerts.length, alerts };
    }),
  }),

  // ── Client Share Tokens ─────────────────────────────────────
  shareTokens: router({
    list: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      return filterTenantRows("shareToken", await db.listShareTokens(input.projectId), ctx.organizationId);
    }),
    listForClient: protectedProcedure.input(z.object({ clientName: z.string() })).query(({ input, ctx }) =>
      ctx.organizationId == null ? [] : db.listClientShareTokens(input.clientName, ctx.organizationId)),
    create: protectedProcedure.input(z.object({
      projectId: z.number(),
      label: z.string().optional(),
      expiresInDays: z.number().min(1).max(365).optional(),
    })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      const token = nanoid(32);
      const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400000) : null;
      return db.createShareToken({ projectId: input.projectId, token, label: input.label || null, isActive: true, expiresAt, createdById: ctx.user.id, organizationId: ctx.organizationId });
    }),
    createClientLink: protectedProcedure.input(z.object({
      clientName: z.string().min(1),
      label: z.string().optional(),
      expiresInDays: z.number().min(1).max(365).optional(),
    })).mutation(async ({ input, ctx }) => {
      const token = nanoid(32);
      const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400000) : null;
      return db.createShareToken({ clientName: input.clientName, token, label: input.label || `All ${input.clientName} Projects`, isActive: true, expiresAt, createdById: ctx.user.id, organizationId: ctx.organizationId });
    }),
    revoke: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("shareToken", input.id, ctx.organizationId);
      return db.revokeShareToken(input.id);
    }),
  }),

  // ── Public Client Portal ───────────────────────────────────
  portal: router({
    getProject: publicProcedure.input(z.object({ token: z.string() })).query(async ({ input }) => {
      const shareToken = await db.getShareToken(input.token);
      if (!shareToken) return { error: "Invalid or expired link", data: null, type: null };
      if (!await isOrganizationWorkspaceAccessible(shareToken.organizationId)) return { error: "Invalid or expired link", data: null, type: null };
      // Client-level token (all projects for a client)
      if (shareToken.clientName && shareToken.organizationId) {
        const data = await db.getPublicClientData(shareToken.clientName, shareToken.organizationId);
        if (!data) return { error: "No projects found for this client", data: null, type: null };
        return { error: null, data, type: "client" as const };
      }
      // Single-project token
      if (!shareToken.projectId) return { error: "Invalid link configuration", data: null, type: null };
      await assertTenantEntity("project", shareToken.projectId, shareToken.organizationId);
      const data = await db.getPublicProjectData(shareToken.projectId);
      if (!data) return { error: "Project not found", data: null, type: null };
      return { error: null, data, type: "project" as const };
    }),
  }),

  // ── Gantt Timeline ──────────────────────────────────────────
  gantt: router({
    data: protectedProcedure.query(({ ctx }) => db.getGanttData(ctx.organizationId)),
  }),

  // ── Project Team Members ────────────────────────────────────
  projectTeam: router({
    list: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      const rows = await db.listProjectTeamMembers(input.projectId);
      await Promise.all(rows.map(row => assertTenantEntity("projectTeamMember", row.id, ctx.organizationId)));
      return rows;
    }),
    listByMember: protectedProcedure.input(z.object({ teamMemberId: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("teamMember", input.teamMemberId, ctx.organizationId);
      return filterTenantRows("project", await db.listProjectsForTeamMember(input.teamMemberId), ctx.organizationId);
    }),
    add: adminOrPmProcedure.input(z.object({
      projectId: z.number(),
      teamMemberId: z.number(),
      role: z.enum(["designer", "pm", "production"]),
    })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      await assertTenantEntity("teamMember", input.teamMemberId, ctx.organizationId);
      return db.addProjectTeamMember(input);
    }),
    remove: adminOrPmProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("projectTeamMember", input.id, ctx.organizationId);
      return db.removeProjectTeamMember(input.id);
    }),
    avgRate: adminOrPmProcedure.input(z.object({ projectId: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      return db.getProjectTeamAvgRate(input.projectId);
    }),
  }),

  // ── Consultant Contracts ─────────────────────────────────────
  consultants: router({
    list: adminOrPmProcedure.input(z.object({ projectId: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      const limits = await getOrgPlanLimits(ctx);
      requireFeature(limits.hasConsultantManagement, "Consultant Management");
      return filterTenantRows("consultant", await db.listConsultantContracts(input.projectId), ctx.organizationId);
    }),
    create: adminOrPmProcedure.input(z.object({
      projectId: z.number(),
      name: z.string().min(1),
      discipline: z.string().min(1),
      contractAmount: z.number().min(0),
      subBudgetId: z.number().int().positive().nullable().optional(),
      status: z.enum(["active", "completed", "terminated", "pending"]).optional(),
      notes: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      if (input.subBudgetId != null) await assertTenantReference("subBudget", input.subBudgetId, ctx.organizationId, { entity: "project", id: input.projectId });
      const limits = await getOrgPlanLimits(ctx);
      requireFeature(limits.hasConsultantManagement, "Consultant Management");
      return db.createConsultantContract(input, ctx.organizationId);
    }),
    update: adminOrPmProcedure.input(z.object({
      id: z.number(),
      projectId: z.number().int().positive().optional(),
      subBudgetId: z.number().int().positive().nullable().optional(),
      name: z.string().min(1).optional(),
      discipline: z.string().min(1).optional(),
      contractAmount: z.number().min(0).optional(),
      status: z.enum(["active", "completed", "terminated", "pending"]).optional(),
      notes: z.string().optional().nullable(),
    })).mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const existing = await assertTenantEntity("consultant", id, ctx.organizationId);
      const projectId = data.projectId ?? existing.projectId;
      await assertTenantEntity("project", projectId, ctx.organizationId);
      if (data.subBudgetId !== undefined || data.projectId !== undefined) {
        const subBudgetId = data.subBudgetId !== undefined ? data.subBudgetId : existing.subBudgetId;
        if (subBudgetId != null) await assertTenantReference("subBudget", subBudgetId, ctx.organizationId, { entity: "project", id: projectId });
      }
      return db.updateConsultantContract(id, data, ctx.organizationId);
    }),
    delete: adminOrPmProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("consultant", input.id, ctx.organizationId);
      return db.deleteConsultantContract(input.id);
    }),
  }),

  // ── Consultant Payments ─────────────────────────────
  consultantPayments: router({
    list: adminOrPmProcedure.input(z.object({ consultantId: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("consultant", input.consultantId, ctx.organizationId);
      return filterTenantRows("consultantPayment", await db.listConsultantPayments(input.consultantId), ctx.organizationId);
    }),
    create: adminOrPmProcedure.input(z.object({
      consultantId: z.number(),
      amount: z.number().min(1),
      paymentDate: z.date().optional(),
      notes: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("consultant", input.consultantId, ctx.organizationId);
      return db.createConsultantPayment({ ...input, organizationId: ctx.organizationId });
    }),
    delete: adminOrPmProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("consultantPayment", input.id, ctx.organizationId);
      return db.deleteConsultantPayment(input.id);
    }),
  }),

  // ── Net Income ──────────────────────────────────────────────
  netIncome: router({
    project: adminProcedure.input(z.object({ projectId: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      return db.getProjectNetIncome(input.projectId);
    }),
    studio: adminProcedure.query(({ ctx }) => db.getStudioNetIncome(ctx.organizationId)),
  }),

  // ── Time Tracking ────────────────────────────────────────────
  timeEntries: router({
    list: protectedProcedure.input(z.object({
      userId: z.number().optional(),
      projectId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      billable: z.boolean().optional(),
    }).optional()).query(async ({ input, ctx }) => {
      if (input?.projectId != null) await assertTenantEntity("project", input.projectId, ctx.organizationId);
      if (input?.userId != null) {
        await assertTenantEntity("user", input.userId, ctx.organizationId);
        if (ctx.user.role !== "admin" && ctx.user.role !== "pm" && input.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      }
      return filterTenantRows("timeEntry", await db.listTimeEntries(input ?? undefined, ctx.organizationId), ctx.organizationId);
    }),
    create: protectedProcedure.input(z.object({
      projectId: z.number(),
      taskId: z.number().optional().nullable(),
      description: z.string().optional(),
      startTime: z.date(),
      endTime: z.date().optional().nullable(),
      durationMinutes: z.number().min(0).optional(),
      billable: z.boolean().optional(),
      phase: z.enum(["pre_design", "schematic_design", "design_development", "construction_documents", "bidding_negotiation", "construction_administration", "post_occupancy"]).optional(),
      subBudgetId: z.number().int().positive().nullable().optional(),
    })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      if (input.taskId != null) await assertTenantReference("task", input.taskId, ctx.organizationId, { entity: "project", id: input.projectId });
      if (input.subBudgetId != null) await assertTenantReference("subBudget", input.subBudgetId, ctx.organizationId, { entity: "project", id: input.projectId });
      return db.createTimeEntry({ ...input, userId: ctx.user.id }, ctx.organizationId);
    }),
    update: protectedProcedure.input(z.object({
      id: z.number(),
      projectId: z.number().optional(),
      subBudgetId: z.number().int().positive().nullable().optional(),
      taskId: z.number().optional().nullable(),
      description: z.string().optional().nullable(),
      startTime: z.date().optional(),
      endTime: z.date().optional().nullable(),
      durationMinutes: z.number().min(0).optional(),
      billable: z.boolean().optional(),
      phase: z.enum(["pre_design", "schematic_design", "design_development", "construction_documents", "bidding_negotiation", "construction_administration", "post_occupancy"]).optional().nullable(),
    })).mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const entry = await assertTenantEntity("timeEntry", id, ctx.organizationId);
      if (ctx.user.role !== "admin" && ctx.user.role !== "pm" && entry.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      const projectId = data.projectId ?? entry.projectId;
      await assertTenantEntity("project", projectId, ctx.organizationId);
      if (data.taskId !== undefined) {
        if (data.taskId != null) await assertTenantReference("task", data.taskId, ctx.organizationId, { entity: "project", id: projectId });
      } else if (data.projectId !== undefined && entry.taskId != null) {
        await assertTenantReference("task", entry.taskId, ctx.organizationId, { entity: "project", id: projectId });
      }
      if (data.subBudgetId !== undefined) {
        if (data.subBudgetId != null) await assertTenantReference("subBudget", data.subBudgetId, ctx.organizationId, { entity: "project", id: projectId });
      } else if (data.projectId !== undefined && entry.subBudgetId != null) {
        await assertTenantReference("subBudget", entry.subBudgetId, ctx.organizationId, { entity: "project", id: projectId });
      }
      return db.updateTimeEntry(id, data, ctx.organizationId);
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      const entry = await assertTenantEntity("timeEntry", input.id, ctx.organizationId);
      if (ctx.user.role !== "admin" && ctx.user.role !== "pm" && entry.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN", message: "You can only delete your own time entries" });
      return db.deleteTimeEntry(input.id);
    }),
    activeTimer: protectedProcedure.query(({ ctx }) => db.getActiveTimer(ctx.user.id, ctx.organizationId)),
    allActiveTimers: protectedProcedure.query(({ ctx }) =>
      ctx.organizationId == null ? [] : db.getAllActiveTimers(ctx.organizationId)),
    startTimer: protectedProcedure.input(z.object({
      projectId: z.number(),
      taskId: z.number().optional().nullable(),
      description: z.string().optional(),
      billable: z.boolean().optional(),
      phase: z.enum(["pre_design", "schematic_design", "design_development", "construction_documents", "bidding_negotiation", "construction_administration", "post_occupancy"]).optional(),
      subBudgetId: z.number().int().positive().nullable().optional(),
    })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      if (input.taskId != null) await assertTenantReference("task", input.taskId, ctx.organizationId, { entity: "project", id: input.projectId });
      if (input.subBudgetId != null) await assertTenantReference("subBudget", input.subBudgetId, ctx.organizationId, { entity: "project", id: input.projectId });
      await db.stopActiveTimer(ctx.user.id, undefined, ctx.organizationId);
      return db.createTimeEntry({
        userId: ctx.user.id,
        projectId: input.projectId,
        subBudgetId: input.subBudgetId,
        taskId: input.taskId,
        description: input.description,
        startTime: new Date(),
        durationMinutes: 0,
        billable: input.billable ?? true,
        phase: input.phase,
      }, ctx.organizationId);
    }),
    stopTimer: protectedProcedure
      .input(z.object({ id: z.number() }).optional())
      .mutation(async ({ input, ctx }) => {
        if (input?.id != null) {
          const entry = await assertTenantEntity("timeEntry", input.id, ctx.organizationId);
          if (entry.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
        }
        return db.stopActiveTimer(ctx.user.id, input?.id, ctx.organizationId);
      }),
  }),

  // ── Time Analytics ──────────────────────────────────────────────
  timeAnalytics: router({
    projectBreakdown: adminOrPmProcedure.input(z.object({ projectId: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      return db.getProjectTimeBreakdown(input.projectId, ctx.organizationId);
    }),
    projectLaborCost: adminProcedure.input(z.object({ projectId: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      return db.getProjectLaborCost(input.projectId);
    }),
    projectBurnRate: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      return db.getProjectBurnRate(input.projectId);
    }),
    allProjectsBudgetSummary: protectedProcedure.query(({ ctx }) => db.getAllProjectsBudgetSummary(ctx.organizationId)),
    firmUtilization: adminProcedure.input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }).optional()).query(({ input, ctx }) => db.getFirmUtilization(input?.startDate, input?.endDate, ctx.organizationId)),
    trueProfitability: adminProcedure.query(({ ctx }) => db.getTrueProfitability(ctx.organizationId)),
    timesheet: protectedProcedure.input(z.object({
      userId: z.number(),
      weekStart: z.date(),
    })).query(async ({ input, ctx }) => {
      await assertTenantEntity("user", input.userId, ctx.organizationId);
      if (ctx.user.role !== "admin" && ctx.user.role !== "pm" && input.userId !== ctx.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "Record not found" });
      return db.getTimesheetData(input.userId, input.weekStart, ctx.organizationId);
    }),
    teamTimeReport: adminProcedure.input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }).optional()).query(async ({ input, ctx }) => {
      const limits = await getOrgPlanLimits(ctx);
      requireFeature(limits.hasTeamReport, "Team Reports");
      return db.getTeamTimeReport(input?.startDate, input?.endDate, ctx.organizationId);
    }),
    teamMemberTimeLog: adminProcedure.input(z.object({
      teamMemberId: z.number().int().positive(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      projectId: z.number().int().positive().optional(),
    })).query(async ({ input, ctx }) => {
      const limits = await getOrgPlanLimits(ctx);
      requireFeature(limits.hasTeamReport, "Team Reports");
      await assertTenantEntity("teamMember", input.teamMemberId, ctx.organizationId);
      if (input.projectId != null) await assertTenantEntity("project", input.projectId, ctx.organizationId);
      return db.getTeamMemberTimeLog(
        input.teamMemberId,
        input.startDate,
        input.endDate,
        input.projectId,
        ctx.organizationId,
      );
    }),
  }),

  // ── Dashboard ────────────────────────────────────────────────
  dashboard: router({
    stats: protectedProcedure.query(({ ctx }) => db.getDashboardStats(ctx.organizationId)),
    seed: protectedProcedure.mutation(() => {
      throw new TRPCError({ code: "FORBIDDEN", message: "Demo data seeding is unavailable in tenant workspaces" });
    }),
  }),

  // ── Waitlist ─────────────────────────────────────────────────
  waitlist: router({
    // Public endpoint — called by the marketing site signup form
    signup: publicProcedure
      .input(
        z.object({
          name: z.string().min(1).max(255),
          email: z.string().email().max(320),
          firmName: z.string().min(1).max(255),
          firmSize: z.string().min(1).max(64),
        }),
      )
      .mutation(async ({ input }) => {
        await db.createWaitlistSignup(input);
        return { success: true };
      }),

    // Alias for the marketing site form
    join: publicProcedure
      .input(
        z.object({
          name: z.string().min(1).max(255),
          email: z.string().email().max(320),
          firmName: z.string().min(1).max(255),
          firmSize: z.string().min(1).max(64),
        }),
      )
      .mutation(async ({ input }) => {
        await db.createWaitlistSignup(input);
        return { success: true };
      }),

    // Super-admin only: list all signups
    list: superAdminProcedure.query(() => db.listWaitlistSignups()),

    // Super-admin only: total count
    count: superAdminProcedure.query(() => db.countWaitlistSignups()),

    // Super-admin only: permanently delete an individual signup
    delete: superAdminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await db.deleteWaitlistSignup(input.id);
        return { success: true };
      }),
  }),

  // ── Onboarding ─────────────────────────────────────────────────
  onboarding: router({
    status: protectedProcedure.query(async ({ ctx }) => {
      // Invited members (non-owner) always skip onboarding — they're joining an existing firm
      if (ctx.user?.orgRole && ctx.user.orgRole !== "owner") return { completed: true, orgName: null };
      if (!ctx.organizationId) return { completed: false, orgName: null };
      const org = await db.getOrganization(ctx.organizationId);
      return { completed: org?.onboardingCompleted ?? false, orgName: org?.name ?? null };
    }),
    updateFirm: protectedProcedure
      .input(z.object({
        firmName: z.string().min(1).max(255),
        firmSize: z.string().min(1).max(50),
        logoUrl: z.string().max(512).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ctx.organizationId) throw new TRPCError({ code: "BAD_REQUEST", message: "No organization" });
        const slug = input.firmName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        await db.updateOrganization(ctx.organizationId, {
          name: input.firmName,
          slug: `${slug}-${ctx.organizationId}`,
          firmSize: input.firmSize,
          ...(input.logoUrl ? { logoUrl: input.logoUrl } : {}),
        });
        return { success: true };
      }),
    inviteMembers: protectedProcedure
      .input(z.object({
        members: z.array(z.object({
          name: z.string().min(1).max(255),
          email: z.string().email().max(320),
        })).max(20),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ctx.organizationId) throw new TRPCError({ code: "BAD_REQUEST", message: "No organization" });
        const results: { email: string; success: boolean }[] = [];
        for (const member of input.members) {
          try {
            await db.inviteTeamMember({ name: member.name, email: member.email }, ctx.organizationId);
            results.push({ email: member.email, success: true });
          } catch {
            results.push({ email: member.email, success: false });
          }
        }
        return { results };
      }),
    complete: protectedProcedure.mutation(async ({ ctx }) => {
      if (!ctx.organizationId) throw new TRPCError({ code: "BAD_REQUEST", message: "No organization" });
      await db.updateOrganization(ctx.organizationId, { onboardingCompleted: true });
      return { success: true };
    }),
  }),

  // ── Coordination Sheets ─────────────────────────────────────────
  coordination: router({
    // Admin: get sheet for a project
    getForProject: protectedProcedure.input(z.object({ projectId: z.number() })).query(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      let sheet = await db.getCoordinationSheetByProject(input.projectId);
      if (sheet) {
        await assertTenantEntity("coordinationSheet", sheet.id, ctx.organizationId);
        if (!sheet.collaboratorToken) sheet = await db.ensureCoordinationCollaboratorToken(sheet.id);
      }
      return sheet;
    }),

    // Authenticated: get unread item count for a coordination sheet
    unreadCount: protectedProcedure
      .input(z.object({ sheetId: z.number() }))
      .query(async ({ input, ctx }) => {
        await assertTenantEntity("coordinationSheet", input.sheetId, ctx.organizationId);
        return db.getCoordinationUnreadCount(input.sheetId, ctx.user.id);
      }),

    // Authenticated: mark a coordination sheet as viewed (resets unread badge)
    markViewed: protectedProcedure
      .input(z.object({ sheetId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await assertTenantEntity("coordinationSheet", input.sheetId, ctx.organizationId);
        return db.markCoordinationSheetViewed(input.sheetId, ctx.user.id);
      }),

    // Admin: create sheet for a project
    create: adminOrPmProcedure.input(z.object({
      projectId: z.number(),
      projectName: z.string().min(1),
    })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("project", input.projectId, ctx.organizationId);
      const token = nanoid(24);
      const clientToken = nanoid(24);
      const collaboratorToken = nanoid(24);
      return db.createCoordinationSheet({
        organizationId: ctx.organizationId,
        projectId: input.projectId,
        projectName: input.projectName,
        token,
        clientToken,
        collaboratorToken,
        createdById: ctx.user.id,
      });
    }),

    // Admin: update sheet settings (e.g. sharedFolderUrl)
    update: adminOrPmProcedure.input(z.object({
      id: z.number(),
      sharedFolderUrl: z.string().url().optional().nullable(),
    })).mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      await assertTenantEntity("coordinationSheet", id, ctx.organizationId);
      await db.updateCoordinationSheet(id, data);
      return { success: true };
    }),

    // Admin: delete sheet
    delete: adminOrPmProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("coordinationSheet", input.id, ctx.organizationId);
      // Images are stored as base64 in DB, so deleting the sheet cascades cleanup
      await db.deleteCoordinationSheet(input.id);
      return { success: true };
    }),

    // Public: get sheet data by token (no auth required)
    getByToken: publicProcedure.input(z.object({ token: z.string() })).query(async ({ input }) => {
      const sheet = await db.getCoordinationSheetByToken(input.token);
      if (!sheet || !sheet.isActive) return { error: "Sheet not found or inactive", sheet: null, items: [], attachments: [], subscribers: [] };
      await assertTenantEntity("coordinationSheet", sheet.id, sheet.organizationId);
      await assertOrganizationWorkspaceAccess(sheet.organizationId);
      const items = await db.listCoordinationItems(sheet.id);
      const itemIds = items.map(i => i.id);
      const attachments = await db.listCoordinationAttachments(itemIds);
      const subscribers = (await db.listCoordinationSubscribers(sheet.id)).filter(sub => sub.audience !== "client");
      // Strip fileData from response to keep payload small — images served via /api/coordination-image/:id
      const lightAttachments = attachments.map(({ fileData, ...rest }) => rest);
      return { error: null, sheet, items, attachments: lightAttachments, subscribers };
    }),

    // Public: get sheet data by client token (only client-visible items)
    getByClientToken: publicProcedure.input(z.object({ clientToken: z.string() })).query(async ({ input }) => {
      const sheet = await db.getCoordinationSheetByClientToken(input.clientToken);
      if (!sheet || !sheet.isActive) return { error: "Sheet not found or inactive", sheet: null, items: [], attachments: [], subscribers: [] };
      await assertTenantEntity("coordinationSheet", sheet.id, sheet.organizationId);
      await assertOrganizationWorkspaceAccess(sheet.organizationId);
      const allItems = await db.listCoordinationItems(sheet.id);
      // Only show items marked as client-visible
      const clientItems = allItems.filter(i => i.visibility === "client");
      const clientItemIds = new Set(clientItems.map(i => i.id));
      const items = clientItems.map(item => ({ ...item, parentId: item.parentId != null && clientItemIds.has(item.parentId) ? item.parentId : null }));
      const itemIds = items.map(i => i.id);
      const attachments = await db.listCoordinationAttachments(itemIds);
      const lightAttachments = attachments.map(({ fileData, ...rest }) => rest);
      const { token: _internalToken, clientToken: _clientToken, collaboratorToken: _collaboratorToken, ...clientSheet } = sheet;
      return { error: null, sheet: clientSheet, items, attachments: lightAttachments, subscribers: [], isClientView: true };
    }),

    // Public, read-only: external collaborators see only items explicitly marked for them.
    getByCollaboratorToken: publicProcedure.input(z.object({ collaboratorToken: z.string() })).query(async ({ input }) => {
      let sheet = await db.getCoordinationSheetByCollaboratorToken(input.collaboratorToken);
      if (!sheet || !sheet.isActive) return { error: "Sheet not found or inactive", sheet: null, items: [], attachments: [], subscribers: [] };
      await assertTenantEntity("coordinationSheet", sheet.id, sheet.organizationId);
      await assertOrganizationWorkspaceAccess(sheet.organizationId);
      const allItems = await db.listCoordinationItems(sheet.id);
      const items = selectCollaboratorVisibleItems(allItems);
      const itemIds = items.map(item => item.id);
      const attachments = await db.listCoordinationAttachments(itemIds);
      const lightAttachments = attachments.map(({ fileData, ...rest }) => rest);
      return {
        error: null,
        sheet: { projectName: sheet.projectName, sharedFolderUrl: null },
        items,
        attachments: lightAttachments,
        subscribers: [],
        isCollaboratorView: true,
      };
    }),

    // Public: add item
    addItem: publicProcedure.input(z.object({
      token: z.string(),
      parentId: z.number().optional().nullable(),
      authorName: z.string().min(1),
      authorType: z.enum(["project_lead", "architectural", "structural", "civil", "mechanical", "plumbing", "landscaping", "other"]),
      content: z.string().min(1),
      isUrgent: z.boolean().optional(),
    })).mutation(async ({ input }) => {
      const sheet = await db.getCoordinationSheetByAnyToken(input.token);
      if (!sheet || !sheet.isActive) throw new TRPCError({ code: "NOT_FOUND", message: "Sheet not found" });
      await assertTenantEntity("coordinationSheet", sheet.id, sheet.organizationId);
      await assertOrganizationWorkspaceAccess(sheet.organizationId);
      // If the request came in via the client token, auto-set visibility = "client"
      // so the item immediately appears in the client-filtered view.
      const isClientToken = sheet.clientToken === input.token;
      if (input.parentId != null) await requireCoordinationItem(sheet, input.parentId, input.token);
      const item = await db.createCoordinationItem({
        sheetId: sheet.id,
        parentId: input.parentId ?? null,
        authorName: input.authorName,
        authorType: input.authorType,
        content: input.content,
        isUrgent: input.isUrgent ?? false,
        visibility: isClientToken ? "client" : "internal",
      });
      // Send email notifications (fire-and-forget)
      if (item) {
        sendCoordinationNotification(sheet, item, input.parentId ? "reply" : "new").catch(() => {});
        notifyProjectTeamOfCoordinationUpdate(sheet).catch(() => {});
      }
      return item;
    }),

    // Public: update item (edit content, toggle urgent/addressed)
    updateItem: publicProcedure.input(z.object({
      token: z.string(),
      itemId: z.number(),
      content: z.string().optional(),
      isUrgent: z.boolean().optional(),
      isAddressed: z.boolean().optional(),
      visibility: z.enum(["internal", "client"]).optional(),
      isCollaboratorVisible: z.boolean().optional(),
    })).mutation(async ({ input }) => {
      const sheet = await db.getCoordinationSheetByAnyToken(input.token);
      if (!sheet || !sheet.isActive) throw new TRPCError({ code: "NOT_FOUND", message: "Sheet not found" });
      await assertTenantEntity("coordinationSheet", sheet.id, sheet.organizationId);
      await assertOrganizationWorkspaceAccess(sheet.organizationId);
      const item = await requireCoordinationItem(sheet, input.itemId, input.token);
      const { token, itemId, ...data } = input;
      if (sheet.clientToken === token) {
        data.visibility = "client";
        delete data.isCollaboratorVisible;
      }
      return db.updateCoordinationItem(item.id, data);
    }),

    // Public: delete item
    deleteItem: publicProcedure.input(z.object({
      token: z.string(),
      itemId: z.number(),
    })).mutation(async ({ input }) => {
      const sheet = await db.getCoordinationSheetByAnyToken(input.token);
      if (!sheet || !sheet.isActive) throw new TRPCError({ code: "NOT_FOUND", message: "Sheet not found" });
      await assertTenantEntity("coordinationSheet", sheet.id, sheet.organizationId);
      await assertOrganizationWorkspaceAccess(sheet.organizationId);
      await requireCoordinationItem(sheet, input.itemId, input.token);
      await db.deleteCoordinationItem(input.itemId);
      return { success: true };
    }),

    // Public: upload attachment (base64 image)
    uploadAttachment: publicProcedure.input(z.object({
      token: z.string(),
      itemId: z.number(),
      fileName: z.string().min(1),
      fileData: z.string(), // base64
      mimeType: z.string().optional(),
    })).mutation(async ({ input }) => {
      const sheet = await db.getCoordinationSheetByAnyToken(input.token);
      if (!sheet || !sheet.isActive) throw new TRPCError({ code: "NOT_FOUND", message: "Sheet not found" });
      await assertTenantEntity("coordinationSheet", sheet.id, sheet.organizationId);
      await assertOrganizationWorkspaceAccess(sheet.organizationId);
      await requireCoordinationItem(sheet, input.itemId, input.token);
      const validation = await validateCoordinationAttachmentUpload(input.fileName, input.mimeType, input.fileData);
      if (!validation.valid) throw new TRPCError({ code: "BAD_REQUEST", message: validation.message });
      // Store base64 in DB (fileData column) for persistence across deploys
      return db.createCoordinationAttachment({
        itemId: input.itemId,
        type: "image",
        url: "db-stored", // placeholder — client constructs data URL from fileData+mimeType
        fileName: input.fileName,
        fileKey: null,
        fileData: input.fileData,
        mimeType: validation.mimeType,
      });
    }),

    // Public: add link attachment
    addLinkAttachment: publicProcedure.input(z.object({
      token: z.string(),
      itemId: z.number(),
      url: z.string().url(),
      fileName: z.string().optional(),
    })).mutation(async ({ input }) => {
      const sheet = await db.getCoordinationSheetByAnyToken(input.token);
      if (!sheet || !sheet.isActive) throw new TRPCError({ code: "NOT_FOUND", message: "Sheet not found" });
      await assertTenantEntity("coordinationSheet", sheet.id, sheet.organizationId);
      await assertOrganizationWorkspaceAccess(sheet.organizationId);
      await requireCoordinationItem(sheet, input.itemId, input.token);
      return db.createCoordinationAttachment({
        itemId: input.itemId,
        type: "link",
        url: input.url,
        fileName: input.fileName ?? null,
      });
    }),

    // Public: delete attachment
    deleteAttachment: publicProcedure.input(z.object({
      token: z.string(),
      attachmentId: z.number(),
    })).mutation(async ({ input }) => {
      const sheet = await db.getCoordinationSheetByAnyToken(input.token);
      if (!sheet || !sheet.isActive) throw new TRPCError({ code: "NOT_FOUND", message: "Sheet not found" });
      await assertTenantEntity("coordinationSheet", sheet.id, sheet.organizationId);
      await assertOrganizationWorkspaceAccess(sheet.organizationId);
      const attachment = await assertTenantEntity("coordinationAttachment", input.attachmentId, sheet.organizationId);
      await requireCoordinationItem(sheet, attachment.itemId, input.token);
      await db.deleteCoordinationAttachment(input.attachmentId);
      return { success: true };
    }),

    // Public: subscribe to notifications
    subscribe: publicProcedure.input(z.object({
      token: z.string(),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      name: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      if (!input.email && !input.phone) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Email or phone number is required" });
      }
      const sheet = await db.getCoordinationSheetByAnyToken(input.token);
      if (!sheet || !sheet.isActive) throw new TRPCError({ code: "NOT_FOUND", message: "Sheet not found" });
      await assertTenantEntity("coordinationSheet", sheet.id, sheet.organizationId);
      await assertOrganizationWorkspaceAccess(sheet.organizationId);
      const email = input.email ? input.email.trim().toLowerCase() : null;
      const initialAudience = sheet.clientToken === input.token
        ? "client"
        : !email && ctx.user && ctx.organizationId === sheet.organizationId ? "team" : "collaborator";
      const audience = await db.resolveCoordinationSubscriberAudience({ audience: initialAudience, email }, sheet.organizationId);
      return db.addCoordinationSubscriber({
        sheetId: sheet.id,
        email,
        phone: input.phone ? input.phone.trim() : null,
        name: input.name?.trim() || null,
        audience,
      });
    }),
    // Public: unsubscribe
    unsubscribe: publicProcedure.input(z.object({
      token: z.string(),
      emailOrPhone: z.string(),
    })).mutation(async ({ input }) => {
      const sheet = await db.getCoordinationSheetByAnyToken(input.token);
      if (!sheet || !sheet.isActive) throw new TRPCError({ code: "NOT_FOUND", message: "Sheet not found" });
      await assertTenantEntity("coordinationSheet", sheet.id, sheet.organizationId);
      await assertOrganizationWorkspaceAccess(sheet.organizationId);
      const audience = sheet.clientToken === input.token ? "client" : "collaborator";
      await db.removeCoordinationSubscriber(sheet.id, input.emailOrPhone.trim(), audience);
      return { success: true };

    }),
    // Admin/PM: pin an item
    pinItem: adminOrPmProcedure.input(z.object({
      itemId: z.number(),
    })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("coordinationItem", input.itemId, ctx.organizationId);
      await db.pinCoordinationItem(input.itemId);
      return { success: true };
    }),
    // Admin/PM: unpin an item
    unpinItem: adminOrPmProcedure.input(z.object({
      itemId: z.number(),
    })).mutation(async ({ input, ctx }) => {
      await assertTenantEntity("coordinationItem", input.itemId, ctx.organizationId);
      await db.unpinCoordinationItem(input.itemId);
            return { success: true };
    }),
  }),

  // ── Subscription / Billing ─────────────────────────────────────
  subscription: subscriptionRouter,

  // ── Super Admin ────────────────────────────────────────────────
  superAdmin: superAdminRouter,
});

// ── Coordination Sheet Email Notifications ──────────────────────
async function notifyProjectTeamOfCoordinationUpdate(sheet: { projectId: number; organizationId: number | null; projectName: string }) {
  if (!sheet.organizationId || !await isOrganizationWorkspaceAccessible(sheet.organizationId)) return;
  const userIds = await db.listProjectCoordinationNotificationUserIds(sheet.projectId, sheet.organizationId);
  await Promise.all(userIds.map(userId => db.createNotification({
    type: "general",
    title: `Coordination update: ${sheet.projectName.replace(/[\r\n]/g, " ")}`,
    message: "New coordination activity is available. Sign in to the project to review the team sheet.",
    relatedProjectId: sheet.projectId,
    userId,
  }, sheet.organizationId)));
}

async function sendCoordinationNotification(
  sheet: { id: number; projectId: number; organizationId: number | null; clientToken: string | null; collaboratorToken: string | null; projectName: string },
  _item: any,
  _type: "new" | "reply"
) {
  if (!await isOrganizationWorkspaceAccessible(sheet.organizationId)) return;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const subscribers = await db.listCoordinationSubscribers(sheet.id);
  if (subscribers.length === 0) return;

  let notificationSheet = sheet;
  if (!notificationSheet.collaboratorToken && subscribers.some(sub => sub.audience === "collaborator")) {
    notificationSheet = await db.ensureCoordinationCollaboratorToken(sheet.id) ?? sheet;
  }

  const now = new Date();
  const THIRTY_MINUTES = 30 * 60 * 1000;

  // Find subscribers who haven't been notified in the last 30 minutes
  const eligibleSubscribers = subscribers.filter(sub => {
    if (!sub.lastNotifiedAt) return true;
    return (now.getTime() - new Date(sub.lastNotifiedAt).getTime()) > THIRTY_MINUTES;
  });

  if (eligibleSubscribers.length === 0) return;

  // Get all unnotified items for this sheet to send as a digest
  const unnotifiedItems = await db.listUnnotifiedCoordinationItems(sheet.id);
  if (unnotifiedItems.length === 0) return;

  const resend = getResend();
  const baseUrl = process.env.APP_URL || "https://app.studiotrac.app";
  // Twilio SMS client (lazy-cached to avoid OOM on startup)
  const twilioFrom = process.env.TWILIO_PHONE_NUMBER;
  const twilioClient = getTwilioClient();


  // Send to eligible subscribers
  let anySent = false;
  for (const sub of eligibleSubscribers) {
    let subSent = false;
    const audience = await db.resolveCoordinationSubscriberAudience(sub, sheet.organizationId);
    const notice = createCoordinationNotice(notificationSheet, audience, baseUrl);
    if (!notice) continue;

    // Email
    if (sub.email) {
      try {
        const result = await resend.emails.send({
          from: "studioTrac <notifications@studiotrac.app>",
          to: sub.email,
          subject: notice.subject,
          html: notice.html,
        });
        if (result.error) {
          console.error(`[Coordination] Resend API error for ${sub.email}:`, JSON.stringify(result.error));
        } else {
          console.log(`[Coordination] Email sent to ${sub.email}, id: ${result.data?.id}`);
          subSent = true;
        }
      } catch (e) {
        console.error(`[Coordination] Exception sending email to ${sub.email}:`, e);
      }
    }

    // SMS (with 10s timeout to prevent long hangs on Twilio API failures)
    if (sub.phone && twilioClient && twilioFrom) {
      try {
        const smsTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Twilio SMS timeout after 10s")), 10_000)
        );
        const msg = await Promise.race([
          twilioClient.messages.create({ body: notice.smsBody, from: twilioFrom, to: sub.phone }),
          smsTimeout,
        ]);
        console.log(`[Coordination] SMS sent to ${sub.phone}, sid: ${msg.sid}`);
        subSent = true;
      } catch (e: any) {
        console.error(`[Coordination] SMS failed for ${sub.phone}: ${e?.message ?? e}`);
      }
    }

    if (subSent) {
      await db.updateSubscriberLastNotified(sub.id);
      anySent = true;
    }
  }

  // Only mark items as notified if at least one notification was successfully sent
  if (anySent) {
    await db.markCoordinationItemsAsNotified(unnotifiedItems.map(i => i.id));
  }
}

export type AppRouter = typeof appRouter;
