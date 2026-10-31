import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createCoordinationNotice } from "./coordinationNotifications";

describe("coordination notification audience isolation", () => {
  const sheet = {
    projectId: 42,
    projectName: "Synthetic project",
    clientToken: "client-capability",
    collaboratorToken: "collaborator-capability",
    token: "private-main-capability",
    privateItemContent: "private-synthetic-item",
  };

  it("sends clients only their existing client-filtered view link", () => {
    const notice = createCoordinationNotice(sheet, "client", "https://example.invalid/base/path");
    expect(notice).not.toBeNull();
    const output = JSON.stringify(notice);
    expect(output).toContain("/coordination/client/client-capability");
    expect(output).not.toContain("collaborator-capability");
    expect(output).not.toContain("private-main-capability");
    expect(output).not.toContain("/coordination/collaborator/");
    expect(output).not.toContain("/projects/42");
    expect(output).not.toContain(sheet.privateItemContent);
    expect(notice!.subject).toContain("Client coordination update");
    expect(notice!.smsBody).toContain("Client-visible view");
  });

  it("sends external collaborators only the no-login filtered coordination link", () => {
    const notice = createCoordinationNotice(sheet, "collaborator", "https://example.invalid");
    expect(notice).not.toBeNull();
    const output = JSON.stringify(notice);
    expect(output).toContain("/coordination/collaborator/collaborator-capability");
    expect(output).toContain("no-login");
    expect(output).toContain("only items marked visible to collaborators");
    expect(output).not.toContain("client-capability");
    expect(output).not.toContain("private-main-capability");
    expect(output).not.toContain("/coordination/client/");
    expect(output).not.toContain("/projects/42");
    expect(output).not.toContain(sheet.privateItemContent);
    expect(notice!.subject).toContain("External collaborator coordination update");
  });

  it("sends firm members only the signed-in team project destination", () => {
    const notice = createCoordinationNotice(sheet, "team", "https://example.invalid");
    const output = JSON.stringify(notice);
    expect(output).toContain("/projects/42");
    expect(output).toContain("sign-in required");
    expect(output).not.toContain("/coordination/");
    expect(output).not.toContain("client-capability");
    expect(output).not.toContain("collaborator-capability");
    expect(output).not.toContain("private-main-capability");
    expect(notice!.subject).toContain("Firm team coordination update");
    expect(createCoordinationNotice({ ...sheet, clientToken: null, collaboratorToken: null }, "team", "https://example.invalid")).not.toBeNull();
  });

  it("does not manufacture a client or collaborator notice when its capability is absent", () => {
    expect(createCoordinationNotice({ ...sheet, clientToken: null }, "client", "https://example.invalid")).toBeNull();
    expect(createCoordinationNotice({ ...sheet, collaboratorToken: null }, "collaborator", "https://example.invalid")).toBeNull();
  });

  it("escapes project text, encodes the bearer capability, and removes subject line breaks", () => {
    const notice = createCoordinationNotice({
      ...sheet,
      projectName: '<script>private()</script>\r\nX: value',
      collaboratorToken: 'collab?&"',
    }, "collaborator", "https://example.invalid");
    expect(notice).not.toBeNull();
    expect(notice!.html).not.toContain("<script>");
    expect(notice!.html).toContain("&lt;script&gt;");
    expect(notice!.html).toContain("collab%3F%26%22");
    expect(notice!.subject).not.toMatch(/[\r\n]/);
  });

  it.each(["server/routers.ts", "server/coordinationCron.ts"])("uses audience-specific notice generation in %s", file => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("createCoordinationNotice(");
    expect(source).toContain("resolveCoordinationSubscriberAudience(");
    expect(source).not.toContain("createSafeCoordinationNotice");
  });
});
