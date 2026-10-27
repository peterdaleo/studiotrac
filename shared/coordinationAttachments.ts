export const COORDINATION_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const COORDINATION_ATTACHMENT_NOTICE =
  "Only PNG, JPG, GIF, WebP, or AVIF images up to 10 MB can be attached here. Upload PDFs or larger files to the shared project folder, or attach a screenshot instead.";

export const COORDINATION_ATTACHMENT_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;

const allowedMimeTypes = new Set<string>(COORDINATION_ATTACHMENT_ALLOWED_MIME_TYPES);

/** Returns the shared user-facing notice for disallowed metadata, or null when the file is acceptable to inspect. */
export function getCoordinationAttachmentMetadataError(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (
    /\.pdf\s*$/i.test(file.name.trim()) ||
    !Number.isFinite(file.size) ||
    file.size <= 0 ||
    file.size > COORDINATION_ATTACHMENT_MAX_BYTES
  ) {
    return COORDINATION_ATTACHMENT_NOTICE;
  }

  if (file.type.trim() !== "") {
    const normalizedMimeType = file.type.split(";", 1)[0]!.trim().toLowerCase();
    if (normalizedMimeType === "application/pdf" || !allowedMimeTypes.has(normalizedMimeType)) {
      return COORDINATION_ATTACHMENT_NOTICE;
    }
  }

  return null;
}
