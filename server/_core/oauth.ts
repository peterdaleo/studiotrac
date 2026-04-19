import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { verifyInviteToken } from "./invite";

export function registerOAuthRoutes(app: Express) {
  // ── Sign Up ────────────────────────────────────────────────────
  app.post("/api/auth/signup", async (req: Request, res: Response) => {
    try {
      const { email, password, name, inviteToken } = req.body;

      if (!email || !password) {
        res.status(400).json({ error: "Email and password are required" });
        return;
      }

      if (password.length < 6) {
        res.status(400).json({ error: "Password must be at least 6 characters" });
        return;
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      let invite = null;

      if (inviteToken) {
        if (typeof inviteToken !== "string") {
          res.status(400).json({ error: "Invalid invitation token" });
          return;
        }

        invite = await verifyInviteToken(inviteToken);
        if (!invite) {
          res.status(400).json({ error: "This invitation link is invalid or has expired" });
          return;
        }

        if (invite.email !== normalizedEmail) {
          res.status(400).json({ error: "Please sign up using the email address that received the invitation" });
          return;
        }
      }

      // Check if user already exists
      const existing = await db.getUserByEmail(normalizedEmail);
      if (existing) {
        res.status(409).json({ error: "An account with this email already exists" });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const openId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const displayName = String(name || invite?.name || normalizedEmail.split("@")[0]).trim();

      await db.upsertUser({
        openId,
        name: displayName,
        email: normalizedEmail,
        passwordHash,
        loginMethod: "email",
        lastSignedIn: new Date(),
        role: invite?.role,
      });

      const createdUser = await db.getUserByEmail(normalizedEmail);
      if (invite && createdUser) {
        try {
          await db.linkUserToInvitedTeamMember({
            teamMemberId: invite.teamMemberId,
            userId: createdUser.id,
            email: normalizedEmail,
            name: displayName,
          });
        } catch (linkError) {
          console.warn("[Auth] Failed to link invited team member", linkError);
        }
      }

      const sessionToken = await sdk.createSessionToken(openId, {
        name: displayName,
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Signup failed", error);
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
