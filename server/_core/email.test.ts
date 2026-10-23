import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  Resend: vi.fn(),
  logEmail: vi.fn(),
  ENV: { resendApiKey: "synthetic-test-key" },
}));

vi.mock("module", async importOriginal => {
  const actual = await importOriginal<typeof import("module")>();
  return {
    ...actual,
    createRequire: vi.fn(() => vi.fn(() => ({ Resend: mocks.Resend }))),
  };
});
vi.mock("./env", () => ({ ENV: mocks.ENV }));
vi.mock("../db", () => ({ logEmail: mocks.logEmail }));

import { sendFirmOwnerInviteEmail } from "./email";

const params = {
  to: "owner@example.test",
  firmName: '<Example & "Sons">',
  invitationUrl: "https://app.example.test/invite?firmInvite=synthetic-token&next=%22ok%22",
};

describe("sendFirmOwnerInviteEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ENV.resendApiKey = "synthetic-test-key";
    mocks.Resend.mockImplementation(() => ({ emails: { send: mocks.send } }));
    mocks.send.mockResolvedValue({ data: { id: "synthetic-message-id" }, error: null });
  });

  it("sends an escaped owner invite through the synthetic transport without logging its bearer link", async () => {
    const result = await sendFirmOwnerInviteEmail(params);

    expect(result).toEqual({ sent: true });
    expect(mocks.Resend).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledOnce();
    const message = mocks.send.mock.calls[0][0];
    expect(message.to).toEqual([params.to]);
    expect(message.from).toContain("invites@studiotrac.app");
    expect(message.html).toContain("&lt;Example &amp; &quot;Sons&quot;&gt;");
    expect(message.html).toContain("firmInvite=synthetic-token&amp;next=%22ok%22");
    expect(message.text).toContain("pending approval");
    expect(message.html).toContain("pending approval");
    expect(message.text).toContain(params.invitationUrl);
    expect(mocks.logEmail).not.toHaveBeenCalled();
  });

  it("explains the selected complimentary plan activates on acceptance without a trial or automatic charge", async () => {
    await sendFirmOwnerInviteEmail({ ...params, complimentaryPlan: "professional" });

    const message = mocks.send.mock.calls[0][0];
    expect(message.text).toContain("complimentary Professional plan");
    expect(message.html).toContain("complimentary Professional plan");
    expect(message.text).toContain("will activate when you accept this invitation");
    expect(message.html).toContain("will activate when you accept this invitation");
    expect(message.text).toContain("There is no trial and no automatic charge.");
    expect(message.html).toContain("There is no trial and no automatic charge.");
    expect(message.html).not.toContain('<Example & "Sons">');
  });

  it("returns only a sanitized delivery failure when the provider returns an error", async () => {
    mocks.send.mockResolvedValue({ error: { message: `sensitive ${params.invitationUrl} provider detail` } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendFirmOwnerInviteEmail(params)).resolves.toEqual({ sent: false, reason: "delivery_failed" });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(mocks.logEmail).not.toHaveBeenCalled();

    warn.mockRestore();
    error.mockRestore();
  });

  it("returns a sanitized failure when transport throws without exposing provider details", async () => {
    mocks.send.mockRejectedValue(new Error(`credential detail ${params.invitationUrl}`));
    await expect(sendFirmOwnerInviteEmail(params)).resolves.toEqual({ sent: false, reason: "delivery_failed" });
    expect(mocks.logEmail).not.toHaveBeenCalled();
  });

  it("skips delivery and reports missing_api_key without constructing the provider", async () => {
    mocks.ENV.resendApiKey = "";
    await expect(sendFirmOwnerInviteEmail(params)).resolves.toEqual({ sent: false, reason: "missing_api_key" });
    expect(mocks.Resend).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
