import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { sendFirmOwnerInviteEmail } from "./_core/email";
import * as store from "./platformAccessStore";

const positiveId = z.number().int().safe().positive();
const reasonSchema = z.string().max(2000).optional();
const platformOwnerProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const user = ctx.user;
  if (!user || user.isSuperAdmin !== true || user.orgRole !== "owner" ||
      !Number.isSafeInteger(user.organizationId) || user.organizationId == null || user.organizationId <= 0 ||
      !Number.isSafeInteger(ctx.organizationId) || ctx.organizationId !== user.organizationId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Platform owner access required" });
  }
  return next({ ctx: { ...ctx, user, organizationId: user.organizationId } });
});

function invitationOrigin() {
  const configured = process.env.PUBLIC_APP_ORIGIN || "https://app.studiotrac.app";
  let url: URL;
  try { url = new URL(configured); } catch { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Invitation origin is not configured correctly" }); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Invitation origin is not configured correctly" });
  }
  return url.origin;
}

export const platformAccessRouter = router({
  overview: platformOwnerProcedure.query(async () => ({
    controls: await store.listAccessControls(),
    invitations: await store.listFirmInvitations(),
  })),
  audit: platformOwnerProcedure.input(z.object({ organizationId: positiveId.optional(), limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(({ input }) => store.listPlatformAccessAudit({ organizationId: input?.organizationId, limit: input?.limit })),
  inviteFirmOwner: platformOwnerProcedure.input(z.object({
    email: z.string().email().max(320),
    firmName: z.string().trim().min(1).max(255),
    complimentaryPlan: z.enum(["starter", "professional", "enterprise"]).default("starter"),
  }))
    .mutation(async ({ input, ctx }) => {
      const issued = await store.issueFirmOwnerInvitation({ ...input, actorUserId: ctx.user.id, origin: invitationOrigin() });
      const delivery = await sendFirmOwnerInviteEmail({ to: input.email, firmName: input.firmName, invitationUrl: issued.invitationUrl, complimentaryPlan: issued.complimentaryPlan });
      return {
        ...issued,
        emailSent: delivery.sent,
        ...(!delivery.sent ? { emailFailureReason: delivery.reason } : {}),
      };
    }),
  revokeFirmInvitation: platformOwnerProcedure.input(z.object({ invitationId: positiveId, reason: reasonSchema }))
    .mutation(({ input, ctx }) => store.revokeFirmOwnerInvitation({ ...input, actorUserId: ctx.user.id })),
  grantComplimentaryPlan: platformOwnerProcedure.input(z.object({ organizationId: positiveId, plan: z.enum(["starter", "professional", "enterprise"]), reason: reasonSchema }))
    .mutation(({ input, ctx }) => store.setComplimentaryPlan({ ...input, actorUserId: ctx.user.id })),
  revokeComplimentaryPlan: platformOwnerProcedure.input(z.object({ organizationId: positiveId, reason: reasonSchema }))
    .mutation(({ input, ctx }) => store.setComplimentaryPlan({ ...input, plan: null, actorUserId: ctx.user.id })),
  grantWorkspaceAccess: platformOwnerProcedure.input(z.object({ organizationId: positiveId, reason: reasonSchema }))
    .mutation(({ input, ctx }) => store.setWorkspaceAccess({ ...input, state: "active", actorUserId: ctx.user.id })),
  suspendWorkspace: platformOwnerProcedure.input(z.object({ organizationId: positiveId, reason: reasonSchema }))
    .mutation(({ input, ctx }) => store.setWorkspaceAccess({ ...input, state: "suspended", actorUserId: ctx.user.id })),
  reactivateWorkspace: platformOwnerProcedure.input(z.object({ organizationId: positiveId, reason: reasonSchema }))
    .mutation(({ input, ctx }) => store.setWorkspaceAccess({ ...input, state: "active", actorUserId: ctx.user.id })),
});
