import { createHash, randomBytes } from "node:crypto";

export type ComplimentaryPlan = "starter" | "professional" | "enterprise";
export type FirmInvitationGrant = {
  complimentaryPlan: ComplimentaryPlan | null;
  activation: "pending" | "active";
};

const PLAN_SET = new Set<ComplimentaryPlan>(["starter", "professional", "enterprise"]);
const TOKEN_BYTES = 32;
const ENTROPY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function isCanonical32ByteBase64Url(value: string) {
  if (!ENTROPY_PATTERN.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === TOKEN_BYTES && bytes.toString("base64url") === value;
}

export function createFirmInvitationToken(plan: ComplimentaryPlan): string {
  if (!PLAN_SET.has(plan)) throw new Error("INVALID_COMPLIMENTARY_PLAN");
  return `c1.${plan}.${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

/** Recognizes only the current version and the historical 32-byte token shape. */
export function isSupportedFirmInvitationToken(token: unknown): token is string {
  if (typeof token !== "string") return false;
  if (isCanonical32ByteBase64Url(token)) return true;
  const match = /^c1\.(starter|professional|enterprise)\.([A-Za-z0-9_-]{43})$/.exec(token);
  return !!match && isCanonical32ByteBase64Url(match[2]);
}

/** Call only after the full bearer token hash matched a valid stored invitation. */
export function decodeFirmInvitationGrant(token: string): FirmInvitationGrant | null {
  if (!isSupportedFirmInvitationToken(token)) return null;
  if (isCanonical32ByteBase64Url(token)) return { complimentaryPlan: null, activation: "pending" };
  const [, plan] = /^c1\.(starter|professional|enterprise)\./.exec(token)!;
  return { complimentaryPlan: plan as ComplimentaryPlan, activation: "active" };
}

/** The database stores only this digest, never the bearer token. */
export function hashFirmInvitationToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
