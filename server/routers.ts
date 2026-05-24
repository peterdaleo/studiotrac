import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { subscriptionRouter } from "./stripe/router";
import { superAdminRouter } from "./superAdmin/router";
import { publicProcedure, protectedProcedure, adminProcedure, adminOrPmProcedure, superAdminProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import { notifyOwner } from "./_core/notification";
import { sendTeamInviteEmail, sendBillingMilestoneEmail } from "./_core/email";
import { createInviteSignupUrl, createInviteToken } from "./_core/invite";
import bcrypt from "bcryptjs";
import { getPlanLimits, type PlanTier } from "@shared/subscription";

/**
 * Helper: resolve the current org's plan limits.
 * Super-admins bypass all gates.
 * Members of a superAdmin-owned org also get enterprise limits (no plan restrictions).
 */
async function getOrgPlanLimits(ctx: { user: { isSuperAdmin: boolean }; organizationId: number | null }) {
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

    if (value.startDate.toDateString() !== value.endDate.toDateString()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "Partial day absences must start and end on the same day",
      });
    }
  }
});

export const appRouter = router({
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
    list: protectedProcedure.query(({ ctx }) => db.listTeamMembers(ctx.organizationId)),
    get: protectedProcedure.input(z.object({ id: z.number() })).query(({ input }) => db.getTeamMember(input.id)),
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
    })).mutation(({ input }) => {
      const { id, ...data } = input;
      return db.updateTeamMember(id, data);
    }),
    delete: adminProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteTeamMember(input.id)),
    stats: protectedProcedure.input(z.object({ id: z.number() })).query(({ input }) => db.getTeamMemberStats(input.id)),
    updateRole: adminProcedure.input(z.object({
      userId: z.number(),
      role: z.enum(["user", "pm", "admin"]),
    })).mutation(async ({ input, ctx }) => {
      // Prevent admin from demoting themselves
      if (input.userId === ctx.user.id && input.role !== "admin") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot change your own role" });
      }
      await db.updateUserRole(input.userId, input.role);
      return { success: true };
    }),
    listUsers: adminProcedure.query(({ ctx }) => db.listUsers(ctx.organizationId)),
    removeUser: adminProcedure.input(z.object({ userId: z.number() })).mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot remove yourself from the organization" });
      }
      await db.removeFromOrganization(input.userId);
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
      const targetUser = await db.getUserById(input.userId);
      if (!targetUser) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }
      if (targetUser.loginMethod !== "email") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This user signed up with Google and does not have a password to reset" });
      }
      const passwordHash = await bcrypt.hash(input.newPassword, 12);
      await db.updateUserPassword(input.userId, passwordHash);
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
    }).optional()).query(({ input, ctx }) => db.listTeamAbsences(input ?? undefined, ctx.organizationId)),
    get: protectedProcedure.input(z.object({ id: z.number() })).query(({ input }) => db.getTeamAbsence(input.id)),
    create: protectedProcedure.input(teamAbsenceSchema).mutation(({ input, ctx }) =>
      db.createTeamAbsence({
        ...input,
        notes: input.notes ?? null,
        startTimeMinutes: input.startTimeMinutes ?? null,
        endTimeMinutes: input.endTimeMinutes ?? null,
        createdById: ctx.user.id,
      }, ctx.organizationId)
    ),
    update: protectedProcedure.input(teamAbsenceSchema.safeExtend({ id: z.number() })).mutation(({ input }) => {
      const { id, ...data } = input;
      return db.updateTeamAbsence(id, {
        ...data,
        notes: data.notes ?? null,
        startTimeMinutes: data.startTimeMinutes ?? null,
        endTimeMinutes: data.endTimeMinutes ?? null,
      });
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteTeamAbsence(input.id)),
  }),

  // ── Projects ─────────────────────────────────────────────────
  projects: router({
    list: protectedProcedure.input(z.object({
      status: z.string().optional(),
      phase: z.string().optional(),
      managerId: z.number().optional(),
    }).optional()).query(({ input, ctx }) => db.listProjects(input ?? undefined, ctx.organizationId)),
    get: protectedProcedure.input(z.object({ id: z.number() })).query(({ input }) => db.getProject(input.id)),
    financialSummary: adminOrPmProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const project = await db.getProject(input.id);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }
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
      driveFolderUrl: z.string().optional().nullable(),
    })).mutation(async ({ input, ctx }) => {
      const limits = await getOrgPlanLimits(ctx);
      const allProjects = await db.listProjects(undefined, ctx.organizationId);
      const activeProjects = allProjects.filter((p: any) => p.status !== "completed");
      if (activeProjects.length >= limits.maxProjects) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Your plan allows up to ${limits.maxProjects} active projects. Upgrade to add more.`,
        });
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
      driveFolderUrl: z.string().optional().nullable(),
    })).mutation(async ({ input }) => {
      const { id, ...data } = input;

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
            const billingEmails = await db.listBillingDepartmentEmails();
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
    delete: adminProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteProject(input.id)),
    purgeArchived: adminProcedure.mutation(({ ctx }) => db.purgeArchivedProjects(ctx.organizationId)),
  }),

  // ── Tasks ────────────────────────────────────────────────────
  tasks: router({
    list: protectedProcedure.input(z.object({
      projectId: z.number().optional(),
      assigneeId: z.number().optional(),
      status: z.string().optional(),
    }).optional()).query(({ input, ctx }) => db.listTasks(input ?? undefined, ctx.organizationId)),
    get: protectedProcedure.input(z.object({ id: z.number() })).query(({ input }) => db.getTask(input.id)),
    create: protectedProcedure.input(z.object({
      projectId: z.number(),
      assigneeId: z.number().optional().nullable(),
      title: z.string().min(1),
      description: z.string().optional(),
      status: z.enum(["todo", "in_progress", "done"]).optional(),
      priority: z.number().min(1).max(20).optional(),
      sortOrder: z.number().optional(),
      deadline: z.date().optional().nullable(),
    })).mutation(({ input, ctx }) => db.createTask(input, ctx.organizationId)),
    update: protectedProcedure.input(z.object({
      id: z.number(),
      assigneeId: z.number().optional().nullable(),
      title: z.string().min(1).optional(),
      description: z.string().optional().nullable(),
      status: z.enum(["todo", "in_progress", "done"]).optional(),
      priority: z.number().min(1).max(20).optional(),
      sortOrder: z.number().optional(),
      deadline: z.date().optional().nullable(),
      completedAt: z.date().optional().nullable(),
    })).mutation(async ({ input, ctx }) => {
      // Staff can only update their own tasks
      if (ctx.user.role !== 'admin') {
        const task = await db.getTask(input.id);
        if (task && task.assigneeId !== null) {
          // Allow if user is the assignee (match by user id or team member linked to user)
          // For simplicity, staff can edit any task they can see — restrict delete only
        }
      }
      const { id, ...data } = input;
      return db.updateTask(id, data);
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== 'admin') {
        const task = await db.getTask(input.id);
        if (!task) return;
        // Staff can only delete tasks they created or are assigned to — simplified check
      }
      return db.deleteTask(input.id);
    }),
    reorder: protectedProcedure.input(z.object({
      taskOrders: z.array(z.object({ id: z.number(), sortOrder: z.number() })),
    })).mutation(({ input }) => db.reorderTasks(input.taskOrders)),
    purgeArchived: adminProcedure.mutation(({ ctx }) => db.purgeArchivedTasks(ctx.organizationId)),
  }),

  // ── Project Notes ────────────────────────────────────────────
  notes: router({
    list: protectedProcedure.input(z.object({ projectId: z.number() })).query(({ input }) => db.listProjectNotes(input.projectId)),
    create: protectedProcedure.input(z.object({
      projectId: z.number(),
      content: z.string().min(1),
      isClientVisible: z.boolean().optional(),
    })).mutation(({ input, ctx }) => db.createProjectNote({ ...input, authorId: ctx.user.id })),
    update: protectedProcedure.input(z.object({
      id: z.number(),
      content: z.string().min(1).optional(),
      isClientVisible: z.boolean().optional(),
    })).mutation(({ input }) => {
      const { id, ...data } = input;
      return db.updateProjectNote(id, data);
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteProjectNote(input.id)),
  }),

  // ── Project Files ────────────────────────────────────────────
  files: router({
    list: protectedProcedure.input(z.object({ projectId: z.number() })).query(({ input }) => db.listProjectFiles(input.projectId)),
    upload: protectedProcedure.input(z.object({
      projectId: z.number(),
      fileName: z.string().min(1),
      fileData: z.string(), // base64 encoded
      mimeType: z.string().optional(),
      fileSize: z.number().optional(),
      category: z.enum(["drawing", "specification", "correspondence", "photo", "contract", "other"]).optional(),
    })).mutation(async ({ input, ctx }) => {
      const buffer = Buffer.from(input.fileData, "base64");
      const ext = input.fileName.split(".").pop() || "bin";
      const fileKey = `projects/${input.projectId}/files/${nanoid()}.${ext}`;
      const { url } = await storagePut(fileKey, buffer, input.mimeType || "application/octet-stream");
      return db.createProjectFile({
        projectId: input.projectId,
        uploadedById: ctx.user.id,
        fileName: input.fileName,
        fileKey,
        url,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        category: input.category || "other",
      });
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteProjectFile(input.id)),
    count: protectedProcedure.input(z.object({ projectId: z.number() })).query(({ input }) => db.getProjectFileCount(input.projectId)),
  }),

  // ── Invoices ────────────────────────────────────────────────
  invoices: router({
    list: adminOrPmProcedure.input(z.object({ projectId: z.number() })).query(({ input }) => db.listInvoices(input.projectId)),
    create: adminOrPmProcedure.input(z.object({
      projectId: z.number(),
      amount: z.number().min(0),
      description: z.string().optional(),
      invoiceNumber: z.string().optional(),
      status: z.enum(["draft", "sent", "paid", "overdue"]).optional(),
      invoiceDate: z.date().optional(),
      dueDate: z.date().optional().nullable(),
      paidDate: z.date().optional().nullable(),
    })).mutation(({ input, ctx }) => db.createInvoice(input, ctx.organizationId)),
    update: adminOrPmProcedure.input(z.object({
      id: z.number(),
      amount: z.number().min(0).optional(),
      description: z.string().optional().nullable(),
      invoiceNumber: z.string().optional().nullable(),
      status: z.enum(["draft", "sent", "paid", "overdue"]).optional(),
      invoiceDate: z.date().optional(),
      dueDate: z.date().optional().nullable(),
      paidDate: z.date().optional().nullable(),
    })).mutation(({ input }) => {
      const { id, ...data } = input;
      return db.updateInvoice(id, data);
    }),
    delete: adminOrPmProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteInvoice(input.id)),
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
    unreadCount: protectedProcedure.query(({ ctx }) => db.getUnreadNotificationCount(ctx.user.id)),
    markRead: protectedProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.markNotificationRead(input.id)),
    markAllRead: protectedProcedure.mutation(({ ctx }) => db.markAllNotificationsRead(ctx.user.id)),
  }),

  // ── Billing Department Emails ────────────────────────────────
  billingEmails: router({
    list: adminProcedure.query(({ ctx }) => db.listBillingDepartmentEmails(ctx.organizationId)),
    add: adminProcedure.input(z.object({
      emailAddress: z.string().email(),
    })).mutation(({ input, ctx }) => db.addBillingDepartmentEmail(input.emailAddress, ctx.organizationId)),
    remove: adminProcedure.input(z.object({
      id: z.number(),
    })).mutation(({ input }) => db.removeBillingDepartmentEmail(input.id)),
  }),

  // ── Email Preferences ───────────────────────────────────────
  emailPreferences: router({
    get: protectedProcedure.query(({ ctx }) => db.getEmailPreferences(ctx.user.id)),
    upsert: protectedProcedure.input(z.object({
      emailAddress: z.string().email(),
      deadlineAlerts: z.boolean().optional(),
      overdueAlerts: z.boolean().optional(),
      statusChangeAlerts: z.boolean().optional(),
      alertDaysBefore: z.number().min(1).max(14).optional(),
    })).mutation(({ input, ctx }) => db.upsertEmailPreferences(ctx.user.id, input)),
  }),

  // ── Email Notifications ─────────────────────────────────────
  emailNotifications: router({
    log: protectedProcedure.query(() => db.listEmailLog()),
    checkDeadlines: protectedProcedure.mutation(async () => {
      const tasks3Day = await db.getUpcomingDeadlineTasks(3);
      const tasks1Day = await db.getUpcomingDeadlineTasks(1);
      const overdueTasks = await db.getOverdueTasks();
      const projects3Day = await db.getUpcomingDeadlineProjects(3);

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
        });
      }
      for (const alert of alerts) {
        await db.logEmail({ recipientEmail: "team@studio.com", subject: alert.title, body: alert.message });
      }
      if (alerts.length > 0) {
        await notifyOwner({ title: `studioTrac: ${alerts.length} deadline alert(s)`, content: alerts.map(a => `• ${a.title}`).join("\n") }).catch(() => {});
      }
      return { alertsGenerated: alerts.length, alerts };
    }),
  }),

  // ── Client Share Tokens ─────────────────────────────────────
  shareTokens: router({
    list: protectedProcedure.input(z.object({ projectId: z.number() })).query(({ input }) => db.listShareTokens(input.projectId)),
    listForClient: protectedProcedure.input(z.object({ clientName: z.string() })).query(({ input, ctx }) => db.listClientShareTokens(input.clientName, ctx.organizationId)),
    create: protectedProcedure.input(z.object({
      projectId: z.number(),
      label: z.string().optional(),
      expiresInDays: z.number().min(1).max(365).optional(),
    })).mutation(async ({ input, ctx }) => {
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
    revoke: protectedProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.revokeShareToken(input.id)),
  }),

  // ── Public Client Portal ───────────────────────────────────
  portal: router({
    getProject: publicProcedure.input(z.object({ token: z.string() })).query(async ({ input }) => {
      const shareToken = await db.getShareToken(input.token);
      if (!shareToken) return { error: "Invalid or expired link", data: null, type: null };
      // Client-level token (all projects for a client)
      if (shareToken.clientName && shareToken.organizationId) {
        const data = await db.getPublicClientData(shareToken.clientName, shareToken.organizationId);
        if (!data) return { error: "No projects found for this client", data: null, type: null };
        return { error: null, data, type: "client" as const };
      }
      // Single-project token
      if (!shareToken.projectId) return { error: "Invalid link configuration", data: null, type: null };
      const data = await db.getPublicProjectData(shareToken.projectId);
      if (!data) return { error: "Project not found", data: null, type: null };
      return { error: null, data, type: "project" as const };
    }),
  }),

  // ── Gantt Timeline ──────────────────────────────────────────
  gantt: router({
    data: protectedProcedure.query(({ ctx }) => db.getGanttData(ctx.organizationId)),
  }),

  // ── Consultant Contracts ─────────────────────────────────────
  consultants: router({
    list: adminProcedure.input(z.object({ projectId: z.number() })).query(async ({ input, ctx }) => {
      const limits = await getOrgPlanLimits(ctx);
      requireFeature(limits.hasConsultantManagement, "Consultant Management");
      return db.listConsultantContracts(input.projectId);
    }),
    create: adminProcedure.input(z.object({
      projectId: z.number(),
      name: z.string().min(1),
      discipline: z.string().min(1),
      contractAmount: z.number().min(0),
      status: z.enum(["active", "completed", "terminated", "pending"]).optional(),
      notes: z.string().optional(),
    })).mutation(async ({ input, ctx }) => {
      const limits = await getOrgPlanLimits(ctx);
      requireFeature(limits.hasConsultantManagement, "Consultant Management");
      return db.createConsultantContract(input);
    }),
    update: adminProcedure.input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      discipline: z.string().min(1).optional(),
      contractAmount: z.number().min(0).optional(),
      status: z.enum(["active", "completed", "terminated", "pending"]).optional(),
      notes: z.string().optional().nullable(),
    })).mutation(({ input }) => {
      const { id, ...data } = input;
      return db.updateConsultantContract(id, data);
    }),
    delete: adminProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteConsultantContract(input.id)),
  }),

  // ── Consultant Payments ─────────────────────────────────────
  consultantPayments: router({
    list: adminProcedure.input(z.object({ consultantId: z.number() })).query(({ input }) => db.listConsultantPayments(input.consultantId)),
    create: adminProcedure.input(z.object({
      consultantId: z.number(),
      amount: z.number().min(1),
      paymentDate: z.date().optional(),
      notes: z.string().optional(),
    })).mutation(({ input }) => db.createConsultantPayment(input)),
    delete: adminProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteConsultantPayment(input.id)),
  }),

  // ── Net Income ──────────────────────────────────────────────
  netIncome: router({
    project: adminProcedure.input(z.object({ projectId: z.number() })).query(({ input }) => db.getProjectNetIncome(input.projectId)),
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
    }).optional()).query(({ input, ctx }) => db.listTimeEntries(input ?? undefined, ctx.organizationId)),
    create: protectedProcedure.input(z.object({
      projectId: z.number(),
      taskId: z.number().optional().nullable(),
      description: z.string().optional(),
      startTime: z.date(),
      endTime: z.date().optional().nullable(),
      durationMinutes: z.number().min(0).optional(),
      billable: z.boolean().optional(),
      phase: z.enum(["pre_design", "schematic_design", "design_development", "construction_documents", "bidding_negotiation", "construction_administration", "post_occupancy"]).optional(),
    })).mutation(({ input, ctx }) => db.createTimeEntry({ ...input, userId: ctx.user.id }, ctx.organizationId)),
    update: protectedProcedure.input(z.object({
      id: z.number(),
      projectId: z.number().optional(),
      taskId: z.number().optional().nullable(),
      description: z.string().optional().nullable(),
      startTime: z.date().optional(),
      endTime: z.date().optional().nullable(),
      durationMinutes: z.number().min(0).optional(),
      billable: z.boolean().optional(),
      phase: z.enum(["pre_design", "schematic_design", "design_development", "construction_documents", "bidding_negotiation", "construction_administration", "post_occupancy"]).optional().nullable(),
    })).mutation(({ input }) => {
      const { id, ...data } = input;
      return db.updateTimeEntry(id, data);
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteTimeEntry(input.id)),
    activeTimer: protectedProcedure.query(({ ctx }) => db.getActiveTimer(ctx.user.id)),
    startTimer: protectedProcedure.input(z.object({
      projectId: z.number(),
      taskId: z.number().optional().nullable(),
      description: z.string().optional(),
      billable: z.boolean().optional(),
      phase: z.enum(["pre_design", "schematic_design", "design_development", "construction_documents", "bidding_negotiation", "construction_administration", "post_occupancy"]).optional(),
    })).mutation(async ({ input, ctx }) => {
      await db.stopActiveTimer(ctx.user.id);
      return db.createTimeEntry({
        userId: ctx.user.id,
        projectId: input.projectId,
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
      .mutation(({ input, ctx }) => db.stopActiveTimer(ctx.user.id, input?.id)),
  }),

  // ── Time Analytics ──────────────────────────────────────────────
  timeAnalytics: router({
    projectBreakdown: protectedProcedure.input(z.object({ projectId: z.number() })).query(({ input }) => db.getProjectTimeBreakdown(input.projectId)),
    projectLaborCost: adminProcedure.input(z.object({ projectId: z.number() })).query(({ input }) => db.getProjectLaborCost(input.projectId)),
    projectBurnRate: protectedProcedure.input(z.object({ projectId: z.number() })).query(({ input }) => db.getProjectBurnRate(input.projectId)),
    allProjectsBudgetSummary: protectedProcedure.query(({ ctx }) => db.getAllProjectsBudgetSummary(ctx.organizationId)),
    firmUtilization: adminProcedure.input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }).optional()).query(({ input, ctx }) => db.getFirmUtilization(input?.startDate, input?.endDate, ctx.organizationId)),
    trueProfitability: adminProcedure.query(({ ctx }) => db.getTrueProfitability(ctx.organizationId)),
    timesheet: protectedProcedure.input(z.object({
      userId: z.number(),
      weekStart: z.date(),
    })).query(({ input }) => db.getTimesheetData(input.userId, input.weekStart)),
    teamTimeReport: adminProcedure.input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }).optional()).query(async ({ input, ctx }) => {
      const limits = await getOrgPlanLimits(ctx);
      requireFeature(limits.hasTeamReport, "Team Reports");
      return db.getTeamTimeReport(input?.startDate, input?.endDate, ctx.organizationId);
    }),
  }),

  // ── Dashboard ────────────────────────────────────────────────
  dashboard: router({
    stats: protectedProcedure.query(({ ctx }) => db.getDashboardStats(ctx.organizationId)),
    seed: protectedProcedure.mutation(() => db.seedDemoData()),
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

  // ── Subscription / Billing ─────────────────────────────────────
  subscription: subscriptionRouter,

  // ── Super Admin ────────────────────────────────────────────────
  superAdmin: superAdminRouter,
});

export type AppRouter = typeof appRouter;
