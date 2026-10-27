import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { readCoordinationAttachmentFile } from "../client/src/lib/coordinationAttachmentUpload";
import {
  COORDINATION_ATTACHMENT_MAX_BYTES,
  COORDINATION_ATTACHMENT_NOTICE,
} from "../shared/coordinationAttachments";

class StubFileReader {
  static instances: StubFileReader[] = [];
  result: string | ArrayBuffer | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  readAsDataURL = vi.fn();
  constructor() { StubFileReader.instances.push(this); }
}

beforeEach(() => {
  StubFileReader.instances = [];
  vi.stubGlobal("FileReader", StubFileReader);
});
afterEach(() => vi.unstubAllGlobals());

const file = (overrides: Partial<File> = {}) => ({
  name: "screenshot.png", type: "image/png", size: 100, ...overrides,
}) as File;

describe("coordination uploader browser path", () => {
  it.each([
    ["PDF filename", { name: "drawing.PdF" }],
    ["PDF MIME", { type: "application/pdf" }],
    ["over-limit image", { size: COORDINATION_ATTACHMENT_MAX_BYTES + 1 }],
    ["non-image MIME", { type: "text/plain" }],
    ["empty image", { size: 0 }],
  ])("rejects %s before reading or invoking the upload callback", (_name, metadata) => {
    const upload = vi.fn();
    const error = vi.fn();
    readCoordinationAttachmentFile(file(metadata), upload, error);
    expect(StubFileReader.instances).toHaveLength(0);
    expect(upload).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(COORDINATION_ATTACHMENT_NOTICE);
  });

  it("reads an allowed screenshot and uploads only after a successful read", () => {
    const upload = vi.fn();
    const error = vi.fn();
    const screenshot = file({ size: COORDINATION_ATTACHMENT_MAX_BYTES });
    readCoordinationAttachmentFile(screenshot, upload, error);
    expect(StubFileReader.instances).toHaveLength(1);
    const reader = StubFileReader.instances[0]!;
    expect(reader.readAsDataURL).toHaveBeenCalledOnce();
    expect(reader.readAsDataURL).toHaveBeenCalledWith(screenshot);
    expect(upload).not.toHaveBeenCalled();
    reader.result = "data:image/png;base64,aW1hZ2U=";
    reader.onload!();
    expect(upload).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledWith({
      fileName: "screenshot.png", mimeType: "image/png", fileData: "aW1hZ2U=",
    });
    expect(error).not.toHaveBeenCalled();
  });

  it.each(["error", "abort", "empty read"])("does not upload after %s", failure => {
    const upload = vi.fn();
    const error = vi.fn();
    readCoordinationAttachmentFile(file(), upload, error);
    const reader = StubFileReader.instances[0]!;
    if (failure === "error") reader.onerror!();
    else if (failure === "abort") reader.onabort!();
    else reader.onload!();
    expect(upload).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]![0]).toContain("could not be read");
  });

  it("keeps the selection reset, supported picker types, and persistent notice in the coordination UI", () => {
    const source = readFileSync(new URL("../client/src/pages/CoordinationSheet.tsx", import.meta.url), "utf8");
    const handler = source.slice(source.indexOf("const handleFileUpload ="), source.indexOf("const handleAddLink ="));
    expect(handler.indexOf('e.target.value = ""')).toBeLessThan(handler.indexOf("readCoordinationAttachmentFile("));
    expect(handler).toContain("onUploadAttachment.mutate({ token, itemId: item.id, ...attachment })");
    expect(source).toContain('accept={COORDINATION_ATTACHMENT_ALLOWED_MIME_TYPES.join(",")}');
    expect(source).toContain('{COORDINATION_ATTACHMENT_NOTICE}');
  });
});
