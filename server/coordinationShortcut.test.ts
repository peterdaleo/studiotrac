import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCoordinationShortcut,
  downloadCoordinationShortcut,
} from "../client/src/lib/coordinationShortcut";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("coordination desktop shortcuts", () => {
  it("uses the native shortcut extension for macOS and Windows/Linux", () => {
    const mac = buildCoordinationShortcut(
      "Sugar Bay USVI",
      "https://example.test/coordination/abc",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
    );
    const windows = buildCoordinationShortcut(
      "Sugar Bay USVI",
      "https://example.test/coordination/abc",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    const linux = buildCoordinationShortcut(
      "Sugar Bay USVI",
      "https://example.test/coordination/abc",
      "Mozilla/5.0 (X11; Linux x86_64)",
    );

    expect(mac.filename).toBe("Sugar Bay USVI.webloc");
    expect(mac.content).toContain("<key>URL</key>");
    expect(windows.filename).toBe("Sugar Bay USVI.url");
    expect(linux.filename).toBe("Sugar Bay USVI.url");
  });

  it("preserves the shortcut filename and delays object URL revocation", () => {
    vi.useFakeTimers();
    const anchor = {
      href: "",
      download: "",
      style: { display: "" },
      click: vi.fn(),
      remove: vi.fn(),
    } as unknown as HTMLAnchorElement;
    const appendChild = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn(() => anchor),
      body: { appendChild },
    });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shortcut-test");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    downloadCoordinationShortcut({
      filename: "Sugar Bay USVI.url",
      content: "[InternetShortcut]\nURL=https://example.test\n",
    });

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchor.download).toBe("Sugar Bay USVI.url");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(999);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:shortcut-test");
  });
});
