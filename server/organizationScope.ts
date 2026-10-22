import { TRPCError } from "@trpc/server";

/** Tenant operations must never interpret an absent organization as all organizations. */
export function requireOrganizationId(organizationId: number | null | undefined): asserts organizationId is number {
  if (!Number.isSafeInteger(organizationId) || organizationId == null || organizationId <= 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "An organization workspace is required." });
  }
}
