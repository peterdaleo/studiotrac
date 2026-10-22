import express from "express";
import type { Server } from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hash: vi.fn(async (password: string) => `synthetic-hash:${password}`),
  compare: vi.fn(async () => true),
  getUserByEmail: vi.fn(),
  getTeamMember: vi.fn(),
  createOrganization: vi.fn(),
  createUserForSignup: vi.fn(),
  createInvitedUserForSignup: vi.fn(),
  upsertUser: vi.fn(),
  previewFirmOwnerInvitation: vi.fn(),
  acceptFirmOwnerInvitation: vi.fn(),
  assertOrganizationWorkspaceAccess: vi.fn(),
  verifyInviteToken: vi.fn(),
  createSessionToken: vi.fn(async () => "synthetic-session"),
}));

vi.mock("bcryptjs", () => ({ default: { hash: mocks.hash, compare: mocks.compare } }));
vi.mock("../db", () => ({
  getUserByEmail: mocks.getUserByEmail,
  getTeamMember: mocks.getTeamMember,
  createOrganization: mocks.createOrganization,
  createUserForSignup: mocks.createUserForSignup,
  createInvitedUserForSignup: mocks.createInvitedUserForSignup,
  upsertUser: mocks.upsertUser,
}));
vi.mock("../platformAccessStore", () => ({
  previewFirmOwnerInvitation: mocks.previewFirmOwnerInvitation,
  acceptFirmOwnerInvitation: mocks.acceptFirmOwnerInvitation,
}));
vi.mock("../workspaceAccess", () => ({ assertOrganizationWorkspaceAccess: mocks.assertOrganizationWorkspaceAccess }));
vi.mock("./invite", () => ({ verifyInviteToken: mocks.verifyInviteToken }));
vi.mock("./sdk", () => ({ sdk: { createSessionToken: mocks.createSessionToken } }));
vi.mock("./cookies", () => ({ getSessionCookieOptions: () => ({ httpOnly: true, secure: true, sameSite: "lax" }) }));

import { registerOAuthRoutes } from "./oauth";

let server: Server | undefined;
async function startTestServer() {
  const app = express();
  app.use(express.json());
  registerOAuthRoutes(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server!.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Synthetic HTTP server did not bind");
  const request = (path: string, body: unknown) => fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return request;
}

afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  vi.clearAllMocks();
});

beforeEach(() => {
  mocks.previewFirmOwnerInvitation.mockResolvedValue({
    email: "owner@example.test", firmName: "Synthetic Studio", expiresAt: "2030-01-01T00:00:00.000Z",
  });
  mocks.acceptFirmOwnerInvitation.mockResolvedValue({ id: 42, organizationId: 77 });
  mocks.verifyInviteToken.mockResolvedValue(null);
  mocks.getUserByEmail.mockResolvedValue(undefined);
  mocks.getTeamMember.mockResolvedValue(null);
});

describe("auth invitation HTTP routes (synthetic fixtures)", () => {
  it("rejects an uninvited signup before account lookup, hashing, or organization creation", async () => {
    const request = await startTestServer();
    const response = await request("/api/auth/signup", { email: "new@example.test", password: "secret123" });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/invitation is required/i);
    expect(mocks.getUserByEmail).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.createOrganization).not.toHaveBeenCalled();
    expect(mocks.createUserForSignup).not.toHaveBeenCalled();
  });

  it("previews a firm invite using POST and discloses only its form fields", async () => {
    const request = await startTestServer();
    const response = await request("/api/auth/firm-invitation", { token: "synthetic-bearer" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      email: "owner@example.test", firmName: "Synthetic Studio", expiresAt: "2030-01-01T00:00:00.000Z",
    });
    expect(mocks.previewFirmOwnerInvitation).toHaveBeenCalledWith("synthetic-bearer");
  });

  it.each([
    ["expired", "expired"], ["revoked", "revoked"], ["used", "already been used"], ["invalid", "invalid"],
  ])("returns a sanitized %s firm-invitation error", async (kind, expected) => {
    const request = await startTestServer();
    if (kind === "invalid") mocks.previewFirmOwnerInvitation.mockResolvedValue(null);
    else mocks.previewFirmOwnerInvitation.mockRejectedValue(new Error(`INVITATION_${kind.toUpperCase()}`));
    const response = await request("/api/auth/firm-invitation", { token: "secret-token-value" });
    const body = await response.json();
    expect(body.error).toContain(expected);
    expect(JSON.stringify(body)).not.toContain("secret-token-value");
    expect(response.status).not.toBe(500);
  });

  it("accepts a firm invite via the transactional store and sets session only after success", async () => {
    const request = await startTestServer();
    const response = await request("/api/auth/signup", {
      email: " OWNER@example.test ", password: "synthetic-password", name: "Owner",
      firmInviteToken: "synthetic-bearer",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("synthetic-session");
    expect(mocks.getUserByEmail).not.toHaveBeenCalled();
    expect(mocks.createOrganization).not.toHaveBeenCalled();
    expect(mocks.createUserForSignup).not.toHaveBeenCalled();
    expect(mocks.acceptFirmOwnerInvitation).toHaveBeenCalledWith(expect.objectContaining({
      token: "synthetic-bearer", email: "owner@example.test", name: "Owner", passwordHash: "synthetic-hash:synthetic-password",
    }));
  });

  it("enforces email-bound firm invitation before hashing or acceptance", async () => {
    const request = await startTestServer();
    const response = await request("/api/auth/signup", {
      email: "other@example.test", password: "synthetic-password", firmInviteToken: "synthetic-bearer",
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/email address that received/i);
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.acceptFirmOwnerInvitation).not.toHaveBeenCalled();
  });

  it("rejects a token-type conflict and does not attempt either acceptance", async () => {
    const request = await startTestServer();
    const response = await request("/api/auth/signup", {
      email: "owner@example.test", password: "synthetic-password", inviteToken: "team", firmInviteToken: "firm",
    });
    expect(response.status).toBe(400);
    expect(mocks.previewFirmOwnerInvitation).not.toHaveBeenCalled();
    expect(mocks.verifyInviteToken).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
  });

  it("checks workspace access before a verified team invite can create a user", async () => {
    const request = await startTestServer();
    mocks.verifyInviteToken.mockResolvedValue({
      email: "member@example.test", role: "user", teamMemberId: 8, organizationId: 19,
      teamMemberUpdatedAt: 1000, name: "Member",
    });
    mocks.getTeamMember.mockResolvedValue({ id: 8, organizationId: 19, isActive: true, updatedAt: new Date(1000) });
    mocks.assertOrganizationWorkspaceAccess.mockRejectedValue(Object.assign(new Error("denied"), { code: "FORBIDDEN" }));
    const response = await request("/api/auth/signup", {
      email: "member@example.test", password: "synthetic-password", inviteToken: "team-token",
    });
    expect(response.status).toBe(403);
    expect(mocks.assertOrganizationWorkspaceAccess).toHaveBeenCalledWith(19);
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.createInvitedUserForSignup).not.toHaveBeenCalled();
  });

  it("sets no session if atomic firm invite acceptance fails", async () => {
    const request = await startTestServer();
    mocks.acceptFirmOwnerInvitation.mockRejectedValue(new Error("INVITATION_USED"));
    const response = await request("/api/auth/signup", {
      email: "owner@example.test", password: "synthetic-password", firmInviteToken: "synthetic-bearer",
    });
    expect(response.status).toBe(409);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await response.json()).error).toMatch(/already been used/i);
  });
});
