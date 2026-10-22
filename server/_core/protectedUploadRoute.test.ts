import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import type { Server } from "http";
import { afterEach, describe, expect, it } from "vitest";
import {
  createProtectedUploadHandler,
  createUploadAuthorizer,
  getLocalUploadKey,
  getLocalUploadUrl,
  type UploadRecord,
  type UploadShare,
} from "./protectedUploadRoute";

type FixtureOptions = {
  workspaceAllowed?: boolean;
  files?: Record<string, string>;
  records?: Record<string, UploadRecord>;
  shares?: Record<string, UploadShare>;
  symlinks?: Record<string, string>;
};

const orgRecord = (overrides: Partial<UploadRecord> = {}): UploadRecord => ({
  fileName: "project-document.pdf",
  projectId: 100,
  organizationId: 17,
  fileOrganizationId: null,
  isClientVisible: false,
  clientName: "Acme",
  ...overrides,
});

const projectShare: UploadShare = {
  projectId: 100,
  organizationId: 17,
  clientName: null,
  isActive: true,
  expiresAt: null,
};

const clientShare: UploadShare = {
  projectId: null,
  organizationId: 17,
  clientName: "Acme",
  isActive: true,
  expiresAt: null,
};

async function withUploadServer<T>(options: FixtureOptions, run: (request: (key: string, options?: { token?: string; referer?: string; cookie?: string }) => Promise<Response>) => Promise<T>): Promise<T> {
  const uploadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "protected-upload-test-"));
  const outsideDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "protected-upload-outside-"));
  const files = { "document.pdf": "synthetic upload bytes", ...(options.files ?? {}) };
  const records = { "document.pdf": orgRecord(), ...(options.records ?? {}) };
  const shares: Record<string, UploadShare> = {
    "project-token": projectShare,
    "client-token": clientShare,
    "expired-token": { ...projectShare, expiresAt: new Date(Date.now() - 60_000) },
    "revoked-token": { ...projectShare, isActive: false },
    ...(options.shares ?? {}),
  };

  for (const [key, body] of Object.entries(files)) {
    const target = path.join(uploadDir, key);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, body);
  }
  for (const [key, body] of Object.entries(options.symlinks ?? {})) {
    const target = path.join(uploadDir, key);
    const destination = path.join(outsideDir, `${path.basename(key)}-outside`);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(destination, body);
    await fs.promises.rm(target, { force: true });
    await fs.promises.symlink(destination, target);
  }

  const app = express();
  const authorizeFile = createUploadAuthorizer({
    uploadDir,
    isWorkspaceAccessible: async () => options.workspaceAllowed !== false,
    loadFile: async key => records[key] ?? null,
    loadShare: async token => shares[token] ?? null,
    getAuthenticatedOrganizationId: async req => {
      const sessions: Record<string, number | null> = {
        "session=admin": 17,
        "session=pm": 17,
        "session=staff": 17,
        "session=other-org": 18,
        "session=no-org": null,
      };
      const cookie = req.headers.cookie;
      if (typeof cookie !== "string" || !(cookie in sessions)) throw new Error("No synthetic session");
      return sessions[cookie];
    },
  });
  app.get("/uploads/*", createProtectedUploadHandler({ authorizeFile }));
  const server = app.listen(0, "127.0.0.1");

  const request = async (key: string, requestOptions: { token?: string; referer?: string; cookie?: string } = {}): Promise<Response> => {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    const query = requestOptions.token === undefined ? "" : `?token=${encodeURIComponent(requestOptions.token)}`;
    const headers: Record<string, string> = {};
    if (requestOptions.referer) headers.referer = requestOptions.referer;
    if (requestOptions.cookie) headers.cookie = requestOptions.cookie;
    // Pass the raw path to fetch so URL normalization cannot hide traversal attempts.
    return fetch(`http://127.0.0.1:${address.port}/uploads/${key}${query}`, { headers, redirect: "manual" });
  };

  try {
    if (!server.listening) await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    return await run(request);
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => (server as Server).close(error => error ? reject(error) : resolve()));
    await fs.promises.rm(uploadDir, { recursive: true, force: true });
    await fs.promises.rm(outsideDir, { recursive: true, force: true });
  }
}

describe("protected upload route", () => {
  it.each(["admin", "pm", "staff"]) ("permits a same-organization %s session", async role => {
    await withUploadServer({}, async request => {
      const response = await request("document.pdf", { cookie: `session=${role}` });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("synthetic upload bytes");
    });
  });

  it.each([
    ["anonymous", undefined],
    ["organization-less", "session=no-org"],
    ["cross-organization", "session=other-org"],
  ])("forbids %s access without a share token", async (_label, cookie) => {
    await withUploadServer({}, async request => {
      expect((await request("document.pdf", cookie ? { cookie } : {})).status).toBe(404);
    });
  });

  it("allows a project capability only for its linked project and organization", async () => {
    await withUploadServer({
      files: { "other-project.pdf": "other project" },
      records: {
        "document.pdf": orgRecord({ isClientVisible: true }),
        "other-project.pdf": orgRecord({ projectId: 101, isClientVisible: true }),
      },
      shares: { "wrong-org-project": { ...projectShare, organizationId: 18 } },
    }, async request => {
      expect((await request("document.pdf", { token: "project-token" })).status).toBe(200);
      expect((await request("other-project.pdf", { token: "project-token" })).status).toBe(404);
      expect((await request("document.pdf", { token: "wrong-org-project" })).status).toBe(404);
    });
  });

  it("limits a client-wide capability to its matching same-organization client", async () => {
    await withUploadServer({
      files: { "other-client.pdf": "other client", "cross-org.pdf": "cross org" },
      records: {
        "document.pdf": orgRecord({ isClientVisible: true }),
        "other-client.pdf": orgRecord({ clientName: "Other Client", isClientVisible: true }),
        "cross-org.pdf": orgRecord({ organizationId: 18, isClientVisible: true }),
      },
    }, async request => {
      expect((await request("document.pdf", { token: "client-token" })).status).toBe(200);
      expect((await request("other-client.pdf", { token: "client-token" })).status).toBe(404);
      expect((await request("cross-org.pdf", { token: "client-token" })).status).toBe(404);
    });
  });

  it.each(["revoked-token", "expired-token", "wrong-token"]) ("blocks %s", async token => {
    await withUploadServer({}, async request => {
      expect((await request("document.pdf", { token })).status).toBe(404);
    });
  });

  it("preserves existing /portal/<token> links supplied through Referer", async () => {
    await withUploadServer({ records: { "document.pdf": orgRecord({ isClientVisible: true }) } }, async request => {
      const response = await request("document.pdf", { referer: "https://app.studiotrac.app/portal/project-token" });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("synthetic upload bytes");
    });
  });

  it("keeps private files available to same-org sessions but not public tokens", async () => {
    await withUploadServer({}, async request => {
      expect((await request("document.pdf", { cookie: "session=admin" })).status).toBe(200);
      expect((await request("document.pdf", { token: "project-token" })).status).toBe(404);
    });
  });

  it("rejects contradictory file organization stamps and permits null legacy stamps via project ownership", async () => {
    await withUploadServer({
      files: { "contradictory.pdf": "wrong owner" },
      records: {
        "document.pdf": orgRecord({ fileOrganizationId: null }),
        "contradictory.pdf": orgRecord({ fileOrganizationId: 18 }),
      },
    }, async request => {
      expect((await request("document.pdf", { cookie: "session=admin" })).status).toBe(200);
      expect((await request("contradictory.pdf", { cookie: "session=admin" })).status).toBe(404);
    });
  });

  it("accepts only strict canonical local upload URLs", () => {
    expect(getLocalUploadKey("/uploads/projects/12/files/Ab9-x.pdf")).toBe("projects/12/files/Ab9-x.pdf");
    expect(getLocalUploadUrl("projects/12/files/Ab9-x.pdf")).toBe("/uploads/projects/12/files/Ab9-x.pdf");
    for (const url of [
      "https://example.com/uploads/file.pdf", "//example.com/uploads/file.pdf", "/uploads/file.pdf?x=1",
      "/uploads/file.pdf#fragment", "/uploads/%2e%2e/secret", "/uploads/%252e%252e/secret",
      "/uploads/../secret", "/uploads/a\\b", "/uploads/a%2Fb", "/uploads/a//b",
    ]) expect(getLocalUploadKey(url)).toBeNull();
    for (const key of ["../secret", "%2e%2e/secret", "/absolute", "a\\b", "a//b", "a?b"]) {
      expect(getLocalUploadUrl(key)).toBeNull();
    }
  });

  it("does not serve an on-disk file without matching upload metadata", async () => {
    await withUploadServer({ files: { "orphan.pdf": "unindexed raw bytes" } }, async request => {
      expect((await request("orphan.pdf", { cookie: "session=admin" })).status).toBe(404);
    });
  });

  it.each([
    ["dot-segment traversal", "%2e%2e%2foutside.pdf"],
    ["backslash traversal", "..%5coutside.pdf"],
    ["double-encoded traversal", "%252e%252e%252foutside.pdf"],
  ])("rejects %s", async (_attack, key) => {
    await withUploadServer({}, async request => {
      expect((await request(key, { cookie: "session=admin" })).status).toBe(404);
    });
  });

  it("denies an authorized metadata key whose symlink resolves outside the upload directory", async () => {
    await withUploadServer({
      files: { "linked.pdf": "placeholder" },
      records: { "linked.pdf": orgRecord() },
      symlinks: { "linked.pdf": "secret outside bytes" },
    }, async request => {
      expect((await request("linked.pdf", { cookie: "session=admin" })).status).toBe(404);
    });
  });

  it("returns bytes with private-download security headers", async () => {
    await withUploadServer({}, async request => {
      const response = await request("document.pdf", { cookie: "session=staff" });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("synthetic upload bytes");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-type")).toBe("application/octet-stream");
      expect(response.headers.get("content-disposition")).toBe('attachment; filename="project-document.pdf"');
    });
  });
});


describe("managed workspace suspension for local downloads", () => {
  it("denies owner/admin/PM/staff sessions and valid client capabilities without altering file records", async () => {
    await withUploadServer({ workspaceAllowed: false, records: { "document.pdf": orgRecord({ isClientVisible: true }) } }, async request => {
      for (const cookie of ["session=admin", "session=pm", "session=staff"]) expect((await request("document.pdf", { cookie })).status).toBe(404);
      expect((await request("document.pdf", { token: "project-token" })).status).toBe(404);
      expect((await request("document.pdf", { token: "client-token" })).status).toBe(404);
    });
    await withUploadServer({ workspaceAllowed: true, records: { "document.pdf": orgRecord({ isClientVisible: true }) } }, async request => {
      expect(await (await request("document.pdf", { token: "project-token" })).text()).toBe("synthetic upload bytes");
    });
  });
});
