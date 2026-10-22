import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./env";
import * as db from "../db";

const DEFAULT_APP_ORIGIN = "https://studiotrac-production.up.railway.app";
const INVITE_EXPIRATION = "7d";

type InviteRole = "user" | "pm" | "admin";

export type InviteTokenPayload = {
  email: string;
  role: InviteRole;
  teamMemberId: number;
  organizationId: number;
  teamMemberUpdatedAt: number;
  name: string;
  title?: string | null;
};

function getInviteSecret() {
  return new TextEncoder().encode(ENV.jwtSecret);
}

export async function createInviteToken(payload: Omit<InviteTokenPayload, "organizationId" | "teamMemberUpdatedAt"> & { organizationId?: number }) {
  const teamMember = await db.getTeamMember(payload.teamMemberId);
  const organizationId = payload.organizationId ?? teamMember?.organizationId;
  if (
    !teamMember ||
    !teamMember.isActive ||
    !organizationId ||
    !Number.isInteger(organizationId) ||
    organizationId <= 0 ||
    teamMember.organizationId !== organizationId ||
    (teamMember.email ?? "").trim().toLowerCase() !== payload.email.trim().toLowerCase()
  ) {
    throw new Error("Cannot issue an invitation without an active organization-bound team member");
  }
  return new SignJWT({
    email: payload.email.trim().toLowerCase(),
    role: payload.role,
    teamMemberId: payload.teamMemberId,
    organizationId,
    teamMemberUpdatedAt: teamMember.updatedAt.getTime(),
    name: payload.name,
    title: payload.title ?? null,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(INVITE_EXPIRATION)
    .sign(getInviteSecret());
}

export async function verifyInviteToken(token: string): Promise<InviteTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getInviteSecret(), {
      algorithms: ["HS256"],
    });

    const email = payload.email;
    const role = payload.role;
    const teamMemberId = payload.teamMemberId;
    const organizationId = payload.organizationId;
    const teamMemberUpdatedAt = payload.teamMemberUpdatedAt;
    const name = payload.name;
    const title = payload.title;

    if (typeof email !== "string" || !email) return null;
    if (role !== "user" && role !== "pm" && role !== "admin") return null;
    if (typeof teamMemberId !== "number" || !Number.isInteger(teamMemberId)) return null;
    if (typeof organizationId !== "number" || !Number.isInteger(organizationId) || organizationId <= 0) return null;
    if (typeof teamMemberUpdatedAt !== "number" || !Number.isFinite(teamMemberUpdatedAt) || teamMemberUpdatedAt <= 0) return null;
    if (typeof name !== "string" || !name) return null;
    if (title !== undefined && title !== null && typeof title !== "string") return null;

    return {
      email: email.trim().toLowerCase(),
      role,
      teamMemberId,
      organizationId,
      teamMemberUpdatedAt,
      name,
      title: title ?? null,
    };
  } catch (error) {
    console.warn("[Invite] Invite token verification failed:", String(error));
    return null;
  }
}

function resolveAppOrigin(origin?: string) {
  if (origin) {
    try {
      return new URL(origin).origin;
    } catch {
      console.warn("[Invite] Invalid origin provided for invite email:", origin);
    }
  }

  return DEFAULT_APP_ORIGIN;
}

export function createInviteSignupUrl(origin: string | undefined, token: string) {
  const signupUrl = new URL("/signup", resolveAppOrigin(origin));
  signupUrl.searchParams.set("invite", token);
  return signupUrl.toString();
}
