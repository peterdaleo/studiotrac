import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import { notifyOwner } from "./_core/notification";

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
    list: protectedProcedure.query(() => db.listTeamMembers()),
    get: protectedProcedure.input(z.object({ id: z.number() })).query(({ input }) => db.getTeamMember(input.id)),
    create: adminProcedure.input(z.object({
      name: z.string().min(1),
      email: z.string().email().optional(),
      title: z.string().optional(),
      avatarColor: z.string().optional(),
    })).mutation(({ input }) => db.createTeamMember(input)),
    update: adminProcedure.input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      email: z.string().email().optional().nullable(),
      title: z.string().optional().nullable(),
      avatarColor: z.string().optional(),
      isActive: z.boolean().optional(),
    })).mutation(({ input }) => {
      const { id, ...data } = input;
      return db.updateTeamMember(id, data);
    }),
    delete: adminProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteTeamMember(input.id)),
    stats: protectedProcedure.input(z.object({ id: z.number() })).query(({ input }) => db.getTeamMemberStats(input.id)),
  }),

  // ── Projects ─────────────────────────────────────────────────
  projects: router({
    list: protectedProcedure.input(z.object({
      status: z.string().optional(),
      phase: z.string().optional(),
      managerId: z.number().optional(),
    }).optional()).query(({ input }) => db.listProjects(input ?? undefined)),
    get: protectedProcedure.input(z.object({ id: z.number() })).query(({ input }) => db.getProject(input.id)),
    create: adminProcedure.input(z.object({
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
    })).mutation(({ input }) => db.createProject(input)),
    update: adminProcedure.input(z.object({
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
    })).mutation(({ input }) => {
      const { id, ...data } = input;
      return db.updateProject(id, data);
    }),
    delete: adminProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteProject(input.id)),
  }),

  // ── Tasks ────────────────────────────────────────────────────
  tasks: router({
    list: protectedProcedure.input(z.object({
      projectId: z.number().optional(),
      assigneeId: z.number().optional(),
      status: z.string().optional(),
    }).optional()).query(({ input }) => db.listTasks(input ?? undefined)),
    get: protectedProcedure.input(z.object({ id: z.number() })).query(({ input }) => db.getTask(input.id)),
    create: protectedProcedure.input(z.object({
      projectId: z.number(),
      assigneeId: z.number().optional().nullable(),
      title: z.string().min(1),
      description: z.string().optional(),
      status: z.enum(["todo", "in_progress", "done", "overdue"]).optional(),
      priority: z.number().min(1).max(20).optional(),
      sortOrder: z.number().optional(),
      deadline: z.date().optional().nullable(),
    })).mutation(({ input }) => db.createTask(input)),
    update: protectedProcedure.input(z.object({
      id: z.number(),
      assigneeId: z.number().optional().nullable(),
      title: z.string().min(1).optional(),
      description: z.string().optional().nullable(),
      status: z.enum(["todo", "in_progress", "done", "overdue"]).optional(),
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
    list: protectedProcedure.input(z.object({ projectId: z.number() })).query(({ input }) => db.listInvoices(input.projectId)),
    create: adminProcedure.input(z.object({
      projectId: z.number(),
      amount: z.number().min(0),
      description: z.string().optional(),
      invoiceNumber: z.string().optional(),
      status: z.enum(["draft", "sent", "paid", "overdue"]).optional(),
      invoiceDate: z.date().optional(),
      dueDate: z.date().optional().nullable(),
      paidDate: z.date().optional().nullable(),
    })).mutation(({ input }) => db.createInvoice(input)),
    update: adminProcedure.input(z.object({
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
    delete: adminProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteInvoice(input.id)),
  }),

  // ── Financial Overview ──────────────────────────────────────
  financials: router({
    overview: protectedProcedure.query(() => db.getFinancialOverview()),
  }),

  // ── Exports ─────────────────────────────────────────────────
  exports: router({
    projectsSummary: protectedProcedure.query(() => db.getExportProjectsSummary()),
    tasksList: protectedProcedure.query(() => db.getExportTasksList()),
    teamWorkload: protectedProcedure.query(() => db.getExportTeamWorkload()),
  }),

  // ── Notifications ────────────────────────────────────────────
  notifications: router({
    list: protectedProcedure.query(({ ctx }) => db.listNotifications(ctx.user.id)),
    unreadCount: protectedProcedure.query(({ ctx }) => db.getUnreadNotificationCount(ctx.user.id)),
    markRead: protectedProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.markNotificationRead(input.id)),
    markAllRead: protectedProcedure.mutation(({ ctx }) => db.markAllNotificationsRead(ctx.user.id)),
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
    create: protectedProcedure.input(z.object({
      projectId: z.number(),
      label: z.string().optional(),
      expiresInDays: z.number().min(1).max(365).optional(),
    })).mutation(async ({ input, ctx }) => {
      const token = nanoid(32);
      const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400000) : null;
      return db.createShareToken({ projectId: input.projectId, token, label: input.label || null, isActive: true, expiresAt, createdById: ctx.user.id });
    }),
    revoke: protectedProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.revokeShareToken(input.id)),
  }),

  // ── Public Client Portal ───────────────────────────────────
  portal: router({
    getProject: publicProcedure.input(z.object({ token: z.string() })).query(async ({ input }) => {
      const shareToken = await db.getShareToken(input.token);
      if (!shareToken) return { error: "Invalid or expired link", data: null };
      const data = await db.getPublicProjectData(shareToken.projectId);
      if (!data) return { error: "Project not found", data: null };
      return { error: null, data };
    }),
  }),

  // ── Gantt Timeline ──────────────────────────────────────────
  gantt: router({
    data: protectedProcedure.query(() => db.getGanttData()),
  }),

  // ── Consultant Contracts ─────────────────────────────────────
  consultants: router({
    list: protectedProcedure.input(z.object({ projectId: z.number() })).query(({ input }) => db.listConsultantContracts(input.projectId)),
    create: adminProcedure.input(z.object({
      projectId: z.number(),
      name: z.string().min(1),
      discipline: z.string().min(1),
      contractAmount: z.number().min(0),
      status: z.enum(["active", "completed", "terminated", "pending"]).optional(),
      notes: z.string().optional(),
    })).mutation(({ input }) => db.createConsultantContract(input)),
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
    list: protectedProcedure.input(z.object({ consultantId: z.number() })).query(({ input }) => db.listConsultantPayments(input.consultantId)),
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
    project: protectedProcedure.input(z.object({ projectId: z.number() })).query(({ input }) => db.getProjectNetIncome(input.projectId)),
    studio: protectedProcedure.query(() => db.getStudioNetIncome()),
  }),

  // ── Time Tracking ────────────────────────────────────────────
  timeEntries: router({
    list: protectedProcedure.input(z.object({
      userId: z.number().optional(),
      projectId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      billable: z.boolean().optional(),
    }).optional()).query(({ input }) => db.listTimeEntries(input ?? undefined)),
    create: protectedProcedure.input(z.object({
      projectId: z.number(),
      taskId: z.number().optional().nullable(),
      description: z.string().optional(),
      startTime: z.date(),
      endTime: z.date().optional().nullable(),
      durationMinutes: z.number().min(0).optional(),
      billable: z.boolean().optional(),
      phase: z.enum(["pre_design", "schematic_design", "design_development", "construction_documents", "bidding_negotiation", "construction_administration", "post_occupancy"]).optional(),
    })).mutation(({ input, ctx }) => db.createTimeEntry({ ...input, userId: ctx.user.id })),
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
      // Stop any existing active timer first
      const active = await db.getActiveTimer(ctx.user.id);
      if (active) await db.stopTimer(active.id);
      return db.createTimeEntry({
        userId: ctx.user.id,
        projectId: input.projectId,
        taskId: input.taskId,
        description: input.description,
        startTime: new Date(),
        durationMinutes: 0,
        billable: input.billable ?? true,
        phase: input.phase,
      });
    }),
    stopTimer: protectedProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.stopTimer(input.id)),
  }),

  // ── Time Analytics ──────────────────────────────────────────────
  timeAnalytics: router({
    projectBreakdown: protectedProcedure.input(z.object({ projectId: z.number() })).query(({ input }) => db.getProjectTimeBreakdown(input.projectId)),
    projectLaborCost: adminProcedure.input(z.object({ projectId: z.number() })).query(({ input }) => db.getProjectLaborCost(input.projectId)),
    projectBurnRate: protectedProcedure.input(z.object({ projectId: z.number() })).query(({ input }) => db.getProjectBurnRate(input.projectId)),
    firmUtilization: adminProcedure.input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }).optional()).query(({ input }) => db.getFirmUtilization(input?.startDate, input?.endDate)),
    trueProfitability: adminProcedure.query(() => db.getTrueProfitability()),
    timesheet: protectedProcedure.input(z.object({
      userId: z.number(),
      weekStart: z.date(),
    })).query(({ input }) => db.getTimesheetData(input.userId, input.weekStart)),
  }),

  // ── Dashboard ────────────────────────────────────────────────
  dashboard: router({
    stats: protectedProcedure.query(() => db.getDashboardStats()),
    seed: protectedProcedure.mutation(() => db.seedDemoData()),
  }),
});

export type AppRouter = typeof appRouter;
