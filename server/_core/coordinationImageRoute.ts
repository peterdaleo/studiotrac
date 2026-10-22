import type { Request, RequestHandler } from "express";
import { canAccessCoordinationImage, getCoordinationTokenFromRequest } from "./stage1Security";

export type CoordinationImageRecord = {
  id: number;
  fileData: string | null;
  mimeType: string | null;
  fileName: string | null;
  attachmentType: string;
  itemVisibility: "internal" | "client";
  sheetIsActive: boolean;
  sheetOrganizationId: number | null;
  projectOrganizationId: number | null;
  mainToken: string;
  clientToken: string | null;
};

type Dependencies = {
  loadImage: (id: number) => Promise<CoordinationImageRecord | null>;
  getAuthenticatedOrganizationId: (req: Request) => Promise<number | null>;
};

export function createCoordinationImageHandler(dependencies: Dependencies): RequestHandler {
  return async (req, res) => {
    try {
      const attachmentId = /^\d+$/.test(req.params.id) ? Number(req.params.id) : NaN;
      if (!Number.isSafeInteger(attachmentId) || attachmentId <= 0) return res.status(404).send("Image not found");
      const att = await dependencies.loadImage(attachmentId);
      if (!att || !att.fileData || att.attachmentType !== "image") return res.status(404).send("Image not found");

      let authenticatedOrganizationId: number | null = null;
      try {
        authenticatedOrganizationId = await dependencies.getAuthenticatedOrganizationId(req);
      } catch {
        // Missing/invalid sessions are not identity; a valid explicit share capability may still authorize access.
      }
      const suppliedToken = getCoordinationTokenFromRequest(req.query.token, req.get("referer"));
      // If a token matches both columns, treat it as client-scoped to avoid privilege escalation.
      const tokenKind = suppliedToken && att.clientToken && suppliedToken === att.clientToken
        ? "client"
        : suppliedToken && suppliedToken === att.mainToken ? "main" : null;
      if (!canAccessCoordinationImage({
        sheetIsActive: att.sheetIsActive,
        sheetOrganizationId: att.sheetOrganizationId,
        projectOrganizationId: att.projectOrganizationId,
        authenticatedOrganizationId,
        tokenKind,
        itemVisibility: att.itemVisibility,
      })) return res.status(404).send("Image not found");

      const buffer = Buffer.from(att.fileData, "base64");
      const mimeType = (att.mimeType || "").toLowerCase();
      const safeMime = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]).has(mimeType)
        ? mimeType
        : "application/octet-stream";
      res.setHeader("Content-Type", safeMime);
      res.setHeader("Content-Length", buffer.length);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      const safeFileName = att.fileName?.replace(/[\r\n"\\]/g, "_");
      if (safeFileName) res.setHeader("Content-Disposition", `${safeMime.startsWith("image/") ? "inline" : "attachment"}; filename="${safeFileName}"`);
      return res.send(buffer);
    } catch (error) {
      console.error("Error serving coordination image:", error);
      return res.status(500).send("Internal server error");
    }
  };
}
