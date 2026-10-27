import {
  COORDINATION_ATTACHMENT_ALLOWED_MIME_TYPES,
  COORDINATION_ATTACHMENT_MAX_BYTES,
  COORDINATION_ATTACHMENT_NOTICE,
  getCoordinationAttachmentMetadataError,
} from "../shared/coordinationAttachments";

export type CoordinationAttachmentValidation = {
  valid: true;
  mimeType: string;
  byteLength: number;
} | {
  valid: false;
  message: string;
};

const allowedMimeTypes = new Set<string>(COORDINATION_ATTACHMENT_ALLOWED_MIME_TYPES);
const sharpFormatByMimeType: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
  // Sharp reports AVIF's container format as HEIF and distinguishes it by mediaType.
  "image/avif": "heif",
};
const MAX_BASE64_CHARACTERS = Math.ceil(COORDINATION_ATTACHMENT_MAX_BYTES / 3) * 4;

function decodeStrictBase64(value: string): Buffer | null {
  if (value.length === 0 || value.length > MAX_BASE64_CHARACTERS || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return null;
  }

  const firstPadding = value.indexOf("=");
  const dataLength = firstPadding === -1 ? value.length : firstPadding;
  const paddingLength = value.length - dataLength;
  if (dataLength % 4 === 1 || (paddingLength > 0 && value.length % 4 !== 0)) return null;
  if (paddingLength === 1 && dataLength % 4 !== 3) return null;
  if (paddingLength === 2 && dataLength % 4 !== 2) return null;

  const decoded = Buffer.from(value, "base64");
  const normalizedInput = value.replace(/=+$/, "");
  const normalizedOutput = decoded.toString("base64").replace(/=+$/, "");
  return normalizedInput === normalizedOutput ? decoded : null;
}

function detectImageMimeType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (bytes.length >= 16 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const brands = [bytes.subarray(8, 12).toString("ascii")];
    for (let offset = 16; offset + 4 <= Math.min(bytes.length, 64); offset += 4) {
      brands.push(bytes.subarray(offset, offset + 4).toString("ascii"));
    }
    if (brands.some(brand => brand === "avif" || brand === "avis")) return "image/avif";
  }

  return null;
}

/** Validates metadata and decodes image pixels before a coordination attachment can be persisted. */
export async function validateCoordinationAttachmentUpload(
  fileName: string,
  mimeType: string | null | undefined,
  fileData: string,
): Promise<CoordinationAttachmentValidation> {
  const decoded = decodeStrictBase64(fileData);
  if (!decoded) return { valid: false, message: COORDINATION_ATTACHMENT_NOTICE };
  const metadataError = getCoordinationAttachmentMetadataError({ name: fileName, type: mimeType ?? "", size: decoded.byteLength });
  if (metadataError) return { valid: false, message: metadataError };

  if (decoded.includes(Buffer.from("%PDF-", "ascii"))) {
    return { valid: false, message: COORDINATION_ATTACHMENT_NOTICE };
  }

  const actualMimeType = detectImageMimeType(decoded);
  if (!actualMimeType || !allowedMimeTypes.has(actualMimeType)) {
    return { valid: false, message: COORDINATION_ATTACHMENT_NOTICE };
  }

  const declaredMimeType = mimeType?.split(";", 1)[0]?.trim().toLowerCase();
  if (declaredMimeType && declaredMimeType !== actualMimeType) {
    return { valid: false, message: COORDINATION_ATTACHMENT_NOTICE };
  }

  try {
    // Keep Sharp out of the eager startup path; decode pixels without transforming stored bytes.
    const { default: sharp } = await import("sharp");
    const image = sharp(decoded, { failOn: "warning", sequentialRead: true });
    const metadata = await image.metadata();
    if (metadata.format !== sharpFormatByMimeType[actualMimeType] || metadata.mediaType !== actualMimeType) {
      return { valid: false, message: COORDINATION_ATTACHMENT_NOTICE };
    }
    await image.stats();
  } catch {
    return { valid: false, message: COORDINATION_ATTACHMENT_NOTICE };
  }

  return { valid: true, mimeType: actualMimeType, byteLength: decoded.byteLength };
}
