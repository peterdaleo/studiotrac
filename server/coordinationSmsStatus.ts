import { createRequire } from "module";
import type { Request, Response } from "express";
import { createCoordinationSmsStatusCallbackUrl } from "./coordinationNotifications";

const require = createRequire(import.meta.url);
type TwilioParams = Record<string, unknown>;
type TwilioRequestValidator = (authToken: string, signature: string, url: string, params: TwilioParams) => boolean;
type StatusEvent = { messageSid: string; status: string; errorCode?: string };

type HandlerOptions = {
  getAuthToken?: () => string | undefined;
  getCallbackUrl?: () => string;
  validateRequest?: TwilioRequestValidator;
  logStatus?: (event: StatusEvent) => void;
};

function getTwilioValidator(): TwilioRequestValidator {
  return require("twilio").validateRequest;
}

export function createCoordinationSmsStatusCallbackHandler(options: HandlerOptions = {}) {
  const getAuthToken = options.getAuthToken ?? (() => process.env.TWILIO_AUTH_TOKEN);
  const getCallbackUrl = options.getCallbackUrl ?? (() =>
    createCoordinationSmsStatusCallbackUrl(process.env.APP_URL || "https://app.studiotrac.app")
  );
  const validateRequest: TwilioRequestValidator = options.validateRequest
    ?? ((authToken, signature, url, params) => getTwilioValidator()(authToken, signature, url, params));
  const logStatus = options.logStatus ?? (event => {
    console.info(`[CoordinationSmsStatus] ${JSON.stringify(event)}`);
  });

  return (req: Request, res: Response) => {
    const authToken = getAuthToken();
    if (!authToken) return res.sendStatus(503);

    const signature = req.get("X-Twilio-Signature") ?? "";
    const params = req.body && typeof req.body === "object" ? req.body as TwilioParams : {};
    let isValid = false;
    try {
      isValid = validateRequest(authToken, signature, getCallbackUrl(), params);
    } catch {
      isValid = false;
    }
    if (!isValid) return res.sendStatus(403);

    const messageSid = params.MessageSid;
    const status = params.MessageStatus;
    if (typeof messageSid !== "string" || typeof status !== "string") return res.sendStatus(400);

    const errorCode = params.ErrorCode;
    logStatus({
      messageSid,
      status,
      ...(typeof errorCode === "string" && errorCode ? { errorCode } : {}),
    });
    return res.sendStatus(204);
  };
}
