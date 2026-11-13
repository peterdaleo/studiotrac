import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import {
  createCoordinationNotice,
  createCoordinationSmsStatusCallbackUrl,
} from "./coordinationNotifications";
import { createCoordinationSmsStatusCallbackHandler } from "./coordinationSmsStatus";

const sheet = {
  projectId: 42,
  projectName: "Synthetic project",
  clientToken: "client-capability",
  collaboratorToken: "collaborator-capability",
};

describe("coordination SMS URL and delivery-status policy", () => {
  it.each(["client", "collaborator", "team"] as const)("keeps links in email but not %s SMS", audience => {
    const notice = createCoordinationNotice(sheet, audience, "https://example.test/base");
    expect(notice).not.toBeNull();
    expect(notice!.smsBody).not.toContain("https://");
    expect(notice!.smsBody).not.toContain("/coordination/");
    expect(notice!.smsBody).not.toContain("/projects/");
    expect(notice!.smsBody).toMatch(/Reply STOP to unsubscribe$/);
    expect(notice!.html).toContain('href="https://example.test/');
  });

  it("builds the exact public callback URL from the configured app origin", () => {
    expect(createCoordinationSmsStatusCallbackUrl("https://app.example.test/a/path"))
      .toBe("https://app.example.test/api/twilio/coordination-sms-status");
  });

  it("validates the Twilio signature and records delivery status and provider error code", () => {
    const validateRequest = vi.fn().mockReturnValue(true);
    const logStatus = vi.fn();
    const handler = createCoordinationSmsStatusCallbackHandler({
      getAuthToken: () => "test-auth-token",
      getCallbackUrl: () => "https://app.example.test/api/twilio/coordination-sms-status",
      validateRequest,
      logStatus,
    });
    const req = {
      get: vi.fn().mockReturnValue("test-signature"),
      body: { MessageSid: "SM123", MessageStatus: "undelivered", ErrorCode: "30007" },
    } as unknown as Request;
    const res = { sendStatus: vi.fn() } as unknown as Response;

    handler(req, res);

    expect(validateRequest).toHaveBeenCalledWith(
      "test-auth-token",
      "test-signature",
      "https://app.example.test/api/twilio/coordination-sms-status",
      req.body,
    );
    expect(logStatus).toHaveBeenCalledWith({ messageSid: "SM123", status: "undelivered", errorCode: "30007" });
    expect(res.sendStatus).toHaveBeenCalledWith(204);
  });

  it("rejects callbacks with an invalid signature without recording them", () => {
    const logStatus = vi.fn();
    const handler = createCoordinationSmsStatusCallbackHandler({
      getAuthToken: () => "test-auth-token",
      getCallbackUrl: () => "https://app.example.test/api/twilio/coordination-sms-status",
      validateRequest: () => false,
      logStatus,
    });
    const req = {
      get: vi.fn().mockReturnValue("bad-signature"),
      body: { MessageSid: "SM123", MessageStatus: "delivered" },
    } as unknown as Request;
    const res = { sendStatus: vi.fn() } as unknown as Response;

    handler(req, res);

    expect(logStatus).not.toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(403);
  });
});
