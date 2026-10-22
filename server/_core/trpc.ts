import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { assertOrganizationWorkspaceAccess } from "../workspaceAccess";

const t = initTRPC.context<TrpcContext>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  // A missing workspace must never select unscoped or NULL-organization data.
  // Derive this only from the authenticated account, not caller-supplied context.
  const organizationId = ctx.user.organizationId;
  if (!Number.isSafeInteger(organizationId) || organizationId == null || organizationId <= 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "An organization workspace is required." });
  }
  return next({ ctx: { ...ctx, user: ctx.user, organizationId } });
});

// Recovery and existing paid billing remain reachable by authenticated owners.
export const accountProcedure = t.procedure.use(requireUser);
export const protectedProcedure = accountProcedure.use(async ({ ctx, next }) => {
  await assertOrganizationWorkspaceAccess(ctx.organizationId, ctx.user.isSuperAdmin);
  return next({ ctx });
});
export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  }
  return next({ ctx });
});
export const adminOrPmProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin" && ctx.user.role !== "pm") {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  }
  return next({ ctx });
});

// Platform administration remains a separate, explicitly privileged surface.
export const superAdminProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.user || !ctx.user.isSuperAdmin) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Super-admin access required" });
  }
  return next({ ctx: { ...ctx, user: ctx.user, organizationId: ctx.user.organizationId ?? null } });
});
