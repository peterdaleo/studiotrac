import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import * as db from "../db";
import { previewFirmOwnerInvitation, acceptFirmOwnerInvitation } from "../platformAccessStore";
import { assertOrganizationWorkspaceAccess } from "../workspaceAccess";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { verifyInviteToken } from "./invite";
import { canCreateInvitedAccount } from "./stage1Security";

type FirmInvitationStatus = "invalid" | "expired" | "revoked" | "used" | "email_exists";

function invitationStatus(error: unknown): FirmInvitationStatus {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  const value = `${typeof candidate?.code === "string" ? candidate.code : ""} ${typeof candidate?.message === "string" ? candidate.message : ""}`.toLowerCase();
  if (value.includes("expired")) return "expired";
  if (value.includes("revoked")) return "revoked";
  if (value.includes("used") || value.includes("accepted")) return "used";
  if (value.includes("email_already_exists") || value.includes("email already exists")) return "email_exists";
  return "invalid";
}

function firmInvitationError(status: FirmInvitationStatus) {
  switch (status) {
    case "expired": return { status: 410, error: "This firm invitation has expired" };
    case "revoked": return { status: 410, error: "This firm invitation has been revoked" };
    case "used": return { status: 409, error: "This firm invitation has already been used" };
    case "email_exists": return { status: 409, error: "An account with this email already exists" };
    default: return { status: 400, error: "This firm invitation is invalid" };
  }
}

export function registerOAuthRoutes(app: Express) {
  // Firm owner invitation previews are POST-only so the bearer token is never placed in access-log URLs.
  app.post("/api/auth/firm-invitation", async (req: Request, res: Response) => {
    const token = req.body?.token;
    if (typeof token !== "string" || token.length === 0) {
      res.status(400).json({ error: "A firm invitation token is required" });
      return;
    }
    try {
      const invitation = await previewFirmOwnerInvitation(token);
      if (!invitation) {
        const failure = firmInvitationError("invalid");
        res.status(failure.status).json({ error: failure.error });
        return;
      }
      res.json({ email: invitation.email, firmName: invitation.firmName, expiresAt: invitation.expiresAt, complimentaryPlan: invitation.complimentaryPlan });
    } catch (error) {
      const failure = firmInvitationError(invitationStatus(error));
      res.status(failure.status).json({ error: failure.error });
    }
  });

  // ── Sign Up ────────────────────────────────────────────────────
  app.post("/api/auth/signup", async (req: Request, res: Response) => {
    const { email, password, name, inviteToken, firmInviteToken } = req.body ?? {};

    // Do not permit self-service registrations. Reject this before any account lookup,
    // password hashing, or organization creation.
    if (!inviteToken && !firmInviteToken) {
      res.status(400).json({ error: "An invitation is required to create an account" });
      return;
    }
    if (inviteToken && firmInviteToken) {
      res.status(400).json({ error: "Use only one invitation link" });
      return;
    }
    if ((inviteToken && typeof inviteToken !== "string") || (firmInviteToken && typeof firmInviteToken !== "string")) {
      res.status(400).json({ error: "Invalid invitation token" });
      return;
    }
    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }
    if (typeof password !== "string" || password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    if (firmInviteToken) {
      try {
        // Bind the form to the persisted invitation before hashing; the store repeats
        // collision and invitation checks atomically at acceptance.
        const invitation = await previewFirmOwnerInvitation(firmInviteToken);
        if (!invitation) {
          const failure = firmInvitationError("invalid");
          res.status(failure.status).json({ error: failure.error });
          return;
        }
        if (invitation.email.trim().toLowerCase() !== normalizedEmail) {
          res.status(400).json({ error: "Please sign up using the email address that received the invitation" });
          return;
        }
        const passwordHash = await bcrypt.hash(password, 12);
        const openId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        const displayName = String(name || normalizedEmail.split("@")[0]).trim();
        await acceptFirmOwnerInvitation({ token: firmInviteToken, email: normalizedEmail, passwordHash, name: displayName, openId });
        const sessionToken = await sdk.createSessionToken(openId, { name: displayName, expiresInMs: ONE_YEAR_MS });
        const cookieOptions = getSessionCookieOptions(req);
        res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        res.json({ success: true });
      } catch (error) {
        const failure = firmInvitationError(invitationStatus(error));
        res.status(failure.status).json({ error: failure.error });
      }
      return;
    }

    try {
      const invite = await verifyInviteToken(inviteToken as string);
      if (!invite) {
        res.status(400).json({ error: "This invitation link is invalid or has expired" });
        return;
      }

      if (invite.email !== normalizedEmail) {
        res.status(400).json({ error: "Please sign up using the email address that received the invitation" });
        return;
      }

      const invitedMember = await db.getTeamMember(invite.teamMemberId);
      if (!invitedMember || invitedMember.updatedAt.getTime() !== invite.teamMemberUpdatedAt || !canCreateInvitedAccount({
        normalizedRequestEmail: normalizedEmail,
        inviteEmail: invite.email,
        existingUserId: null,
        inviteOrganizationId: invite.organizationId,
        teamMemberOrganizationId: invitedMember.organizationId,
        teamMemberActive: invitedMember.isActive,
      })) {
        res.status(400).json({ error: "This invitation is no longer valid for this organization" });
        return;
      }

      // Membership links must not be created in a pending/suspended managed workspace.
      await assertOrganizationWorkspaceAccess(invite.organizationId);

      const existing = await db.getUserByEmail(normalizedEmail);
      if (existing) {
        res.status(409).json({ error: "An account with this email already exists" });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const openId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const displayName = String(name || invite.name || normalizedEmail.split("@")[0]).trim();
      const account = {
        openId,
        name: displayName,
        email: normalizedEmail,
        passwordHash,
        loginMethod: "email",
        lastSignedIn: new Date(),
        role: invite.role,
        organizationId: invite.organizationId,
        orgRole: invite.role === "admin" ? "admin" as const : "member" as const,
      };
      await db.createInvitedUserForSignup(account, {
        teamMemberId: invite.teamMemberId,
        teamMemberUpdatedAt: invite.teamMemberUpdatedAt,
      });

      const sessionToken = await sdk.createSessionToken(openId, { name: displayName, expiresInMs: ONE_YEAR_MS });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ success: true });
    } catch (error) {
      if (error instanceof Error && error.message === "INVITATION_NO_LONGER_VALID") {
        res.status(409).json({ error: "This invitation is no longer valid" });
        return;
      }
      if (error instanceof Error && error.message === "EMAIL_ALREADY_EXISTS") {
        res.status(409).json({ error: "An account with this email already exists" });
        return;
      }
      // Workspace-access failures are expected authorization denials; never leak implementation details.
      const candidate = error as { code?: unknown };
      if (candidate?.code === "FORBIDDEN") {
        res.status(403).json({ error: "Workspace access is not available" });
        return;
      }
      console.error("[Auth] Signup failed");
      res.status(500).json({ error: "Signup failed" });
    }
  });

  // ── Login ──────────────────────────────────────────────────────
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      const user = await db.getUserByEmail(normalizedEmail);
      if (!user || !user.passwordHash) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      await db.upsertUser({
        openId: user.openId,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(user.openId, {
        name: user.name || normalizedEmail.split("@")[0],
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Login failed", error);
      res.status(500).json({ error: "Login failed" });
    }
  });
}
