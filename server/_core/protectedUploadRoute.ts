import fs from "fs";
import path from "path";
import type { Request, RequestHandler } from "express";
import { getClientPortalTokenFromRequest } from "./stage1Security";

export type AuthorizedUpload = { filePath: string; fileName: string };
export type UploadRecord = { fileName: string; projectId: number; organizationId: number | null; clientName: string | null };
export type UploadShare = { projectId: number | null; organizationId: number | null; clientName: string | null; isActive: boolean; expiresAt: Date | null };
type AuthorizerDependencies = {
  uploadDir: string;
  loadFile: (key: string) => Promise<UploadRecord | null>;
  loadShare: (token: string) => Promise<UploadShare | null>;
  getAuthenticatedOrganizationId: (req: Request) => Promise<number | null>;
};

export function isSafeUploadKey(key: string): boolean {
  return !!key && !key.includes("\\") && !key.includes("\0") && !path.isAbsolute(key) &&
    !key.split("/").some(part => !part || part === "." || part === "..");
}

export function createUploadAuthorizer(dependencies: AuthorizerDependencies) {
  return async (key: string, token: string | null, req: Request): Promise<AuthorizedUpload | null> => {
    if (!isSafeUploadKey(key)) return null;
    const file = await dependencies.loadFile(key);
    if (!file || !Number.isSafeInteger(file.organizationId) || file.organizationId == null || file.organizationId <= 0) return null;
    let organizationId: number | null = null;
    try { organizationId = await dependencies.getAuthenticatedOrganizationId(req); } catch { /* Public capability may still authorize. */ }
    let allowed = organizationId === file.organizationId;
    if (!allowed && token) {
      const share = await dependencies.loadShare(token);
      allowed = !!share && share.isActive && (!share.expiresAt || share.expiresAt.getTime() > Date.now()) &&
        share.organizationId === file.organizationId &&
        (share.clientName ? share.clientName === file.clientName : share.projectId === file.projectId);
    }
    if (!allowed) return null;
    // Resolve symlinks as well as '..' so an authorized key cannot escape storage.
    try {
      const root = await fs.promises.realpath(dependencies.uploadDir);
      const filePath = await fs.promises.realpath(path.resolve(root, key));
      if (!filePath.startsWith(root + path.sep)) return null;
      return { filePath, fileName: file.fileName };
    } catch { return null; }
  };
}

type Dependencies = { authorizeFile: (key: string, shareToken: string | null, req: Request) => Promise<AuthorizedUpload | null> };
export function createProtectedUploadHandler(dependencies: Dependencies): RequestHandler {
  return async (req, res) => {
    try {
      // Express has already URL-decoded this route parameter; never decode it twice.
      const key = req.params[0];
      if (typeof key !== "string" || !isSafeUploadKey(key)) return res.status(404).send("File not found");
      const token = getClientPortalTokenFromRequest(req.query.token, req.get("referer"));
      const file = await dependencies.authorizeFile(key, token, req);
      if (!file) return res.status(404).send("File not found");
      const safeName = path.basename(file.fileName).replace(/[\r\n"\\]/g, "_");
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName || "download"}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const stream = fs.createReadStream(file.filePath);
      stream.on("error", error => {
        if (!res.headersSent) res.status(404).send("File not found");
        else res.destroy(error);
      });
      stream.pipe(res);
    } catch (error) {
      console.error("Error serving protected upload:", error);
      if (!res.headersSent) res.status(500).send("Internal server error");
    }
  };
}
