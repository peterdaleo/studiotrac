import { describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "http";
import {
  canAccessCoordinationImage,
  canCreateInvitedAccount,
  getCoordinationTokenFromRequest,
} from "./stage1Security";
import { createCoordinationImageHandler, type CoordinationImageRecord } from "./coordinationImageRoute";

describe("Stage 1 invite signup collision policy", () => {
  const validInvite = {
    normalizedRequestEmail: "new.person@example.com",
    inviteEmail: "NEW.PERSON@example.com",
    existingUserId: null,
    inviteOrganizationId: 17,
    teamMemberOrganizationId: 17,
    teamMemberActive: true,
  };

  it("permits a new user only when the signed email and active placeholder belong to the same org", () => {
    expect(canCreateInvitedAccount(validInvite)).toBe(true);
  });

  it.each([
    ["existing account collision", { existingUserId: 92 }],
    ["email mismatch", { normalizedRequestEmail: "attacker@example.com" }],
    ["cross-organization placeholder", { teamMemberOrganizationId: 18 }],
    ["signed token organization mismatch", { inviteOrganizationId: 19 }],
    ["inactive placeholder", { teamMemberActive: false }],
    ["missing organization", { inviteOrganizationId: 0, teamMemberOrganizationId: 0 }],
  ])("fails closed for %s", (_label, override) => {
    expect(canCreateInvitedAccount({ ...validInvite, ...override })).toBe(false);
  });
});

describe("coordination image access policy", () => {
  const sheet = {
    sheetIsActive: true,
    sheetOrganizationId: 17,
    projectOrganizationId: 17,
    authenticatedOrganizationId: null,
    tokenKind: null as "main" | "client" | null,
    itemVisibility: "internal" as "internal" | "client",
  };

  it("denies anonymous image-ID guessing without a valid sheet token", () => {
    expect(canAccessCoordinationImage(sheet)).toBe(false);
  });

  it("allows a valid main-sheet capability to see internal content", () => {
    expect(canAccessCoordinationImage({ ...sheet, tokenKind: "main" })).toBe(true);
  });

  it("allows client links to client-visible images only", () => {
    expect(canAccessCoordinationImage({ ...sheet, tokenKind: "client", itemVisibility: "client" })).toBe(true);
    expect(canAccessCoordinationImage({ ...sheet, tokenKind: "client", itemVisibility: "internal" })).toBe(false);
  });

  it("allows authenticated same-org access but rejects cross-org and org-less accounts", () => {
    expect(canAccessCoordinationImage({ ...sheet, authenticatedOrganizationId: 17 })).toBe(true);
    expect(canAccessCoordinationImage({ ...sheet, authenticatedOrganizationId: 18 })).toBe(false);
    expect(canAccessCoordinationImage({ ...sheet, authenticatedOrganizationId: null })).toBe(false);
  });

  it("rejects inactive sheets even when a link token is supplied", () => {
    expect(canAccessCoordinationImage({ ...sheet, sheetIsActive: false, tokenKind: "main" })).toBe(false);
  });

  it("rejects a sheet whose organization does not match its owning project", () => {
    expect(canAccessCoordinationImage({ ...sheet, projectOrganizationId: 18, tokenKind: "main" })).toBe(false);
  });

  it("extracts tokens from existing main/client public-sheet URLs for image requests", () => {
    expect(getCoordinationTokenFromRequest(undefined, "https://app.studiotrac.app/coordination/main-token")).toBe("main-token");
    expect(getCoordinationTokenFromRequest(undefined, "https://app.studiotrac.app/coordination/client/client-token")).toBe("client-token");
    expect(getCoordinationTokenFromRequest(undefined, "https://evil.example/other")).toBe(null);
    expect(getCoordinationTokenFromRequest("explicit-token", undefined)).toBe("explicit-token");
  });
});

describe("coordination image HTTP handler (synthetic DB/session mocks)", () => {
  const record: CoordinationImageRecord = {
    id: 1,
    fileData: Buffer.from("synthetic image bytes").toString("base64"),
    mimeType: "image/png",
    fileName: "synthetic.png",
    attachmentType: "image",
    itemVisibility: "internal",
    sheetIsActive: true,
    sheetOrganizationId: 17,
    projectOrganizationId: 17,
    mainToken: "main-secret",
    clientToken: "client-secret",
  };

  async function requestImage(options: { workspaceAllowed?: boolean; image?: Partial<CoordinationImageRecord>; cookie?: string; referer?: string; token?: string }) {
    const app = express();
    app.get("/api/coordination-image/:id", createCoordinationImageHandler({
      isWorkspaceAccessible: async () => options.workspaceAllowed !== false,
      loadImage: async id => id === 1 ? { ...record, ...options.image } : null,
      getAuthenticatedOrganizationId: async req => {
        if (req.headers.cookie === "mock-session=same-org") return 17;
        if (req.headers.cookie === "mock-session=other-org") return 18;
        throw new Error("Synthetic unauthenticated request");
      },
    }));
    const server = app.listen(0);
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Test server did not bind");
      const url = new URL(`/api/coordination-image/1${options.token ? `?token=${encodeURIComponent(options.token)}` : ""}`, `http://127.0.0.1:${address.port}`);
      const headers: Record<string, string> = {};
      if (options.cookie) headers.cookie = options.cookie;
      if (options.referer) headers.referer = options.referer;
      return await fetch(url, { headers });
    } finally {
      await new Promise<void>((resolve, reject) => (server as Server).close(error => error ? reject(error) : resolve()));
    }
  }

  it("blocks suspended workspaces even with valid existing sessions and sharing tokens", async () => {
    for (const options of [{ cookie: "mock-session=same-org" }, { token: "main-secret" }, { token: "client-secret", image: { itemVisibility: "client" as const } }]) {
      const response = await requestImage({ ...options, workspaceAllowed: false });
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain("synthetic image bytes");
    }
    expect((await requestImage({ token: "main-secret", workspaceAllowed: true })).status).toBe(200);
  });

  it("blocks unauthenticated ID guessing and returns authorized images without public caching", async () => {
    const denied = await requestImage({});
    expect(denied.status).toBe(404);
    const allowed = await requestImage({ token: "main-secret" });
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toBe("synthetic image bytes");
    expect(allowed.headers.get("cache-control")).toBe("private, no-store");
  });

  it("preserves existing main and client sheet links via their Referer path", async () => {
    const main = await requestImage({ referer: "https://app.studiotrac.app/coordination/main-secret" });
    expect(main.status).toBe(200);
    const clientVisible = await requestImage({ image: { itemVisibility: "client" }, referer: "https://app.studiotrac.app/coordination/client/client-secret" });
    expect(clientVisible.status).toBe(200);
    const clientPrivate = await requestImage({ referer: "https://app.studiotrac.app/coordination/client/client-secret" });
    expect(clientPrivate.status).toBe(404);
  });

  it("allows same-org authenticated access but rejects other-org users and inconsistent tenant data", async () => {
    expect((await requestImage({ cookie: "mock-session=same-org" })).status).toBe(200);
    expect((await requestImage({ cookie: "mock-session=other-org" })).status).toBe(404);
    expect((await requestImage({ token: "main-secret", image: { projectOrganizationId: 18 } })).status).toBe(404);
    expect((await requestImage({ token: "main-secret", image: { sheetIsActive: false } })).status).toBe(404);
  });
});
