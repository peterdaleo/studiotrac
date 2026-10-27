import { getCoordinationAttachmentMetadataError } from "@shared/coordinationAttachments";

export type CoordinationAttachmentFile = {
  fileName: string;
  fileData: string;
  mimeType: string;
};

const READ_ERROR = "This image could not be read. Please try another screenshot.";

export function readCoordinationAttachmentFile(
  file: File,
  onRead: (attachment: CoordinationAttachmentFile) => void,
  onError: (message: string) => void,
): void {
  const metadataError = getCoordinationAttachmentMetadataError(file);
  if (metadataError) {
    onError(metadataError);
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => onError(READ_ERROR);
  reader.onabort = () => onError(READ_ERROR);
  reader.onload = () => {
    const base64 = typeof reader.result === "string" ? reader.result.split(",")[1] : undefined;
    if (!base64) {
      onError(READ_ERROR);
      return;
    }
    onRead({ fileName: file.name, fileData: base64, mimeType: file.type });
  };
  reader.readAsDataURL(file);
}
