import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createSafeCoordinationNotice } from "./coordinationNotifications";

describe("coordination notification confidentiality", () => {
  const sheet = { projectId: 42, projectName: "Synthetic project", clientToken: "client-capability", token: "private-main-capability", privateItemContent: "private-synthetic-item" };
  it("sends generic notices with client-only and authenticated-team destinations", () => {
    const notice = createSafeCoordinationNotice(sheet, "https://example.invalid");
    const output = JSON.stringify(notice);
    expect(output).not.toContain(sheet.token);
    expect(output).not.toContain(sheet.privateItemContent);
    expect(notice.html).toContain("/coordination/client/client-capability");
    expect(notice.html).toContain("/projects/42");
    expect(notice.smsBody).toContain("/coordination/client/client-capability");
  });
  it("never falls back to an internal token if no client token exists", () => {
    const notice = createSafeCoordinationNotice({ ...sheet, clientToken: null }, "https://example.invalid");
    expect(JSON.stringify(notice)).not.toContain(sheet.token);
    expect(notice.smsBody).toContain("/projects/42");
    expect(notice.html).not.toContain("/coordination/");
  });
  it("escapes project text and encodes bearer capabilities in HTML", () => {
    const notice = createSafeCoordinationNotice({ ...sheet, projectName: '<script>private()</script>\r\nX: value', clientToken: 'client?&"' }, "https://example.invalid");
    expect(notice.html).not.toContain("<script>");
    expect(notice.html).toContain("&lt;script&gt;");
    expect(notice.html).toContain("client%3F%26%22");
    expect(notice.subject).not.toMatch(/[\r\n]/);
  });
  it.each(["server/routers.ts", "server/coordinationCron.ts"])("uses safe notice generation for %s", file => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("createSafeCoordinationNotice(sheet, baseUrl)");
    expect(source).not.toContain("/coordination/${sheet.token}");
  });
});
