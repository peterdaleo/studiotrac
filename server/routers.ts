import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";

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
    create: protectedProcedure.input(z.object({
      name: z.string().min(1),
      email: z.string().email().optional(),
      title: z.string().optional(),
      avatarColor: z.string().optional(),
    })).mutation(({ input }) => db.createTeamMember(input)),
    update: protectedProcedure.input(z.object({
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
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteTeamMember(input.id)),
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
    create: protectedProcedure.input(z.object({
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
    })).mutation(({ input }) => db.createProject(input)),
    update: protectedProcedure.input(z.object({
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
    })).mutation(({ input }) => {
      const { id, ...data } = input;
      return db.updateProject(id, data);
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteProject(input.id)),
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
    })).mutation(({ input }) => {
      const { id, ...data } = input;
      return db.updateTask(id, data);
    }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.deleteTask(input.id)),
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

  // ── Notifications ────────────────────────────────────────────
  notifications: router({
    list: protectedProcedure.query(({ ctx }) => db.listNotifications(ctx.user.id)),
    unreadCount: protectedProcedure.query(({ ctx }) => db.getUnreadNotificationCount(ctx.user.id)),
    markRead: protectedProcedure.input(z.object({ id: z.number() })).mutation(({ input }) => db.markNotificationRead(input.id)),
    markAllRead: protectedProcedure.mutation(({ ctx }) => db.markAllNotificationsRead(ctx.user.id)),
  }),

  // ── Dashboard ────────────────────────────────────────────────
  dashboard: router({
    stats: protectedProcedure.query(() => db.getDashboardStats()),
    seed: protectedProcedure.mutation(() => db.seedDemoData()),
  }),
});

export type AppRouter = typeof appRouter;
