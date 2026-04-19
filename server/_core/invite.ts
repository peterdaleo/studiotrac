import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./env";

const DEFAULT_APP_ORIGIN = "https://studiotrac-production.up.railway.app";
const INVITE_EXPIRATION = "7d";

type InviteRole = "user" | "admin";

export type InviteTokenPayload = {
  email: string;
  role: InviteRole;
  teamMemberId: number;
  name: string;
  title?: string | null;
};

function getInviteSecret() {
  return new TextEncoder().encode(ENV.jwtSecret);
}

export async function createInviteToken(payload: InviteTokenPayload) {
  return new SignJWT({
    email: payload.email.trim().toLowerCase(),
    role: payload.role,
    teamMemberId: payload.teamMemberId,
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
    const name = payload.name;
    const title = payload.title;

    if (typeof email !== "string" || !email) return null;
    if (role !== "user" && role !== "admin") return null;
    if (typeof teamMemberId !== "number" || !Number.isInteger(teamMemberId)) return null;
    if (typeof name !== "string" || !name) return null;
    if (title !== undefined && title !== null && typeof title !== "string") return null;

    return {
      email: email.trim().toLowerCase(),
      role,
      teamMemberId,
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
