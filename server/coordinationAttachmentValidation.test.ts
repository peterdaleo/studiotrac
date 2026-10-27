import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import sharp from "sharp";
import {
  COORDINATION_ATTACHMENT_ALLOWED_MIME_TYPES,
  COORDINATION_ATTACHMENT_MAX_BYTES,
  COORDINATION_ATTACHMENT_NOTICE,
  getCoordinationAttachmentMetadataError,
} from "../shared/coordinationAttachments";

const mocks = vi.hoisted(() => ({
  db: {
    getCoordinationSheetByAnyToken: vi.fn(),
    createCoordinationAttachment: vi.fn(),
  },
  assertTenantEntity: vi.fn(),
  assertOrganizationWorkspaceAccess: vi.fn(),
}));
vi.mock("./db", () => mocks.db);
vi.mock("./tenantAuthorization", () => ({
  assertTenantEntity: mocks.assertTenantEntity,
  assertTenantReference: vi.fn(),
  filterTenantRows: vi.fn(),
  listOrganizationEmailLog: vi.fn(),
}));
vi.mock("./workspaceAccess", () => ({
  assertOrganizationWorkspaceAccess: mocks.assertOrganizationWorkspaceAccess,
  isOrganizationWorkspaceAccessible: vi.fn(),
  resolveOrganizationWorkspaceAccess: vi.fn(),
}));

import { validateCoordinationAttachmentUpload } from "./coordinationAttachmentValidation";
import { appRouter } from "./routers";

const formats = [
  { mimeType: "image/png", extension: "png", sharpFormat: "png" },
  { mimeType: "image/jpeg", extension: "jpg", sharpFormat: "jpeg" },
  { mimeType: "image/gif", extension: "gif", sharpFormat: "gif" },
  { mimeType: "image/webp", extension: "webp", sharpFormat: "webp" },
  { mimeType: "image/avif", extension: "avif", sharpFormat: "avif" },
] as const;
type SupportedMimeType = typeof formats[number]["mimeType"];
let imageFixtures: Record<SupportedMimeType, Buffer>;
const pdfBytes = Buffer.from("%PDF-1.7\n");
const sheet = { id: 3, organizationId: 8, isActive: true, clientToken: null };

function b64(bytes: Buffer | number[]): string {
  return Buffer.isBuffer(bytes) ? bytes.toString("base64") : Buffer.from(bytes).toString("base64");
}

function caller() {
  return appRouter.createCaller({ req: {} as any, res: {} as any, user: null as any, organizationId: null });
}

function upload(overrides: Record<string, unknown> = {}) {
  return caller().coordination.uploadAttachment({
    token: "valid-sheet-token",
    itemId: 12,
    fileName: "screenshot.png",
    fileData: b64(imageFixtures["image/png"]),
    mimeType: "image/png",
    ...overrides,
  } as any);
}

beforeAll(async () => {
  const source = sharp({ create: { width: 3, height: 2, channels: 4, background: { r: 35, g: 90, b: 160, alpha: 1 } } });
  imageFixtures = Object.fromEntries(await Promise.all(formats.map(async format => [
    format.mimeType,
    await source.clone().toFormat(format.sharpFormat).toBuffer(),
  ]))) as Record<SupportedMimeType, Buffer>;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.getCoordinationSheetByAnyToken.mockResolvedValue(sheet);
  mocks.db.createCoordinationAttachment.mockResolvedValue({ id: 99 });
  mocks.assertTenantEntity.mockImplementation(async (entity: string, id: number) => {
    if (entity === "coordinationSheet") return sheet;
    if (entity === "coordinationItem") return { id, sheetId: sheet.id, visibility: "internal" };
    throw new Error(`Unexpected tenant entity: ${entity}`);
  });
  mocks.assertOrganizationWorkspaceAccess.mockResolvedValue(undefined);
});

describe("coordination attachment metadata policy", () => {
  it("exports a File-shaped metadata check used by the browser and allows exactly 10 MB", () => {
    expect(getCoordinationAttachmentMetadataError({ name: "screenshot.PNG", type: "image/png", size: COORDINATION_ATTACHMENT_MAX_BYTES })).toBeNull();
    expect(getCoordinationAttachmentMetadataError({ name: "estimate.PdF", type: "image/png", size: 10 })).toBe(COORDINATION_ATTACHMENT_NOTICE);
    expect(getCoordinationAttachmentMetadataError({ name: "estimate.png", type: "application/pdf", size: 10 })).toBe(COORDINATION_ATTACHMENT_NOTICE);
    expect(getCoordinationAttachmentMetadataError({ name: "large.png", type: "image/png", size: COORDINATION_ATTACHMENT_MAX_BYTES + 1 })).toBe(COORDINATION_ATTACHMENT_NOTICE);
    expect(getCoordinationAttachmentMetadataError({ name: "notes.txt", type: "text/plain", size: 10 })).toBe(COORDINATION_ATTACHMENT_NOTICE);
    expect(getCoordinationAttachmentMetadataError({ name: "empty.png", type: "image/png", size: 0 })).toBe(COORDINATION_ATTACHMENT_NOTICE);
  });

  it("allows only the five image formats the coordination preview can render", () => {
    expect(COORDINATION_ATTACHMENT_ALLOWED_MIME_TYPES).toEqual([
      "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif",
    ]);
    for (const mimeType of ["image/bmp", "image/heic", "image/heif", "image/tiff"]) {
      expect(getCoordinationAttachmentMetadataError({ name: "image.bin", type: mimeType, size: 10 })).toBe(COORDINATION_ATTACHMENT_NOTICE);
    }
  });
});

describe("coordination attachment content validation", () => {
  it.each(formats)("accepts a real, decodable $mimeType image", async ({ mimeType, extension }) => {
    const bytes = imageFixtures[mimeType];
    await expect(validateCoordinationAttachmentUpload(`screen.${extension}`, mimeType, b64(bytes))).resolves.toEqual({
      valid: true,
      mimeType,
      byteLength: bytes.byteLength,
    });
  });

  it("infers MIME from a valid signature when the declaration is omitted", async () => {
    const bytes = imageFixtures["image/jpeg"];
    await expect(validateCoordinationAttachmentUpload("screen.jpg", undefined, b64(bytes))).resolves.toMatchObject({
      valid: true,
      mimeType: "image/jpeg",
    });
  });

  it("rejects a PDF signature anywhere in decoded bytes, including beyond the prefix", async () => {
    const embeddedPdf = Buffer.concat([imageFixtures["image/png"], Buffer.alloc(1100), pdfBytes]);
    await expect(validateCoordinationAttachmentUpload("attachment.png", "image/png", b64(embeddedPdf))).resolves.toEqual({
      valid: false,
      message: COORDINATION_ATTACHMENT_NOTICE,
    });
    await expect(validateCoordinationAttachmentUpload("attachment.bin", undefined, b64(pdfBytes))).resolves.toEqual({
      valid: false,
      message: COORDINATION_ATTACHMENT_NOTICE,
    });
  });

  it.each([
    ["malformed base64", "screen.png", "image/png", "AA=A"],
    ["empty base64", "screen.png", "image/png", ""],
  ])("rejects %s", async (_label, fileName, mimeType, fileData) => {
    await expect(validateCoordinationAttachmentUpload(fileName as string, mimeType as string, fileData as string)).resolves.toEqual({
      valid: false,
      message: COORDINATION_ATTACHMENT_NOTICE,
    });
  });

  it("rejects PDF metadata, mismatched MIME, and a forged valid PNG signature", async () => {
    const png = b64(imageFixtures["image/png"]);
    const jpeg = b64(imageFixtures["image/jpeg"]);
    const forgedPng = b64(Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("not a PNG"),
    ]));
    for (const [name, type, data] of [
      ["invoice.PDF", "image/png", png],
      ["invoice.png", "application/pdf", png],
      ["photo.jpg", "image/png", jpeg],
      ["fake.png", "image/png", forgedPng],
    ]) {
      await expect(validateCoordinationAttachmentUpload(name, type, data)).resolves.toEqual({
        valid: false,
        message: COORDINATION_ATTACHMENT_NOTICE,
      });
    }
  });

  it("accepts a genuinely decodable image at exactly 10 MB and rejects above the limit", async () => {
    const image = imageFixtures["image/png"];
    const exactLimit = Buffer.concat([image, Buffer.alloc(COORDINATION_ATTACHMENT_MAX_BYTES - image.byteLength)]);
    const tooLarge = Buffer.alloc(COORDINATION_ATTACHMENT_MAX_BYTES + 1);
    image.copy(tooLarge);
    await expect(validateCoordinationAttachmentUpload("max.png", "image/png", b64(exactLimit))).resolves.toMatchObject({
      valid: true,
      byteLength: COORDINATION_ATTACHMENT_MAX_BYTES,
    });
    await expect(validateCoordinationAttachmentUpload("large.png", "image/png", b64(tooLarge))).resolves.toEqual({
      valid: false,
      message: COORDINATION_ATTACHMENT_NOTICE,
    });
  });
});

describe("coordination uploadAttachment endpoint validation", () => {
  it.each([
    ["PDF by filename", { fileName: "plan.PDF" }],
    ["PDF by MIME", { mimeType: "application/pdf" }],
    ["PDF signature with spoofed image metadata", { fileData: b64(pdfBytes) }],
    ["malformed base64", { fileData: "AA=A" }],
    ["non-image bytes", { fileData: b64(Buffer.from("not an image")) }],
    ["oversized decoded bytes", { fileData: b64(Buffer.alloc(COORDINATION_ATTACHMENT_MAX_BYTES + 1)) }],
  ])("rejects %s before any attachment write", async (_label, overrides) => {
    await expect(upload(overrides)).rejects.toMatchObject({ code: "BAD_REQUEST", message: COORDINATION_ATTACHMENT_NOTICE });
    expect(mocks.db.createCoordinationAttachment).not.toHaveBeenCalled();
  });

  it("rejects malformed image bytes with a valid PNG signature before any attachment write", async () => {
    const forgedPng = Buffer.concat([
      imageFixtures["image/png"].subarray(0, 8),
      Buffer.from("not an image"),
    ]);
    await expect(upload({ fileData: b64(forgedPng) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: COORDINATION_ATTACHMENT_NOTICE,
    });
    expect(mocks.db.createCoordinationAttachment).not.toHaveBeenCalled();
  });

  it("awaits validation and retains tenant checks while persisting the original valid image bytes", async () => {
    const originalBytes = imageFixtures["image/png"];
    const originalBase64 = b64(originalBytes);
    await expect(upload({ fileData: originalBase64 })).resolves.toEqual({ id: 99 });
    expect(mocks.assertTenantEntity).toHaveBeenNthCalledWith(1, "coordinationSheet", sheet.id, sheet.organizationId);
    expect(mocks.assertOrganizationWorkspaceAccess).toHaveBeenCalledWith(sheet.organizationId);
    expect(mocks.assertTenantEntity).toHaveBeenNthCalledWith(2, "coordinationItem", 12, sheet.organizationId);
    expect(mocks.db.createCoordinationAttachment).toHaveBeenCalledOnce();
    expect(mocks.db.createCoordinationAttachment).toHaveBeenCalledWith(expect.objectContaining({
      itemId: 12,
      type: "image",
      fileName: "screenshot.png",
      fileData: originalBase64,
      mimeType: "image/png",
    }));
  });

  it("does not write when the existing tenant item check fails", async () => {
    mocks.assertTenantEntity.mockImplementation(async (entity: string) => {
      if (entity === "coordinationSheet") return sheet;
      throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
    });
    await expect(upload()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.db.createCoordinationAttachment).not.toHaveBeenCalled();
  });
});
