import type { ProspectStage } from "./prospects";

export type ProspectSubmissionPayload = {
  firm: string | null;
  opportunityName: string;
  contact: string | null;
  referralSource: string | null;
  stage?: ProspectStage;
  ownerId: number | null;
  nextFollowUpDate: string | null;
  lastInteractionAt: string;
};

export function buildProspectSubmissionPayload(
  form: Pick<FormData, "get">,
  mode: "create" | "edit",
  defaultLastInteractionAt: string,
): ProspectSubmissionPayload {
  const stageValue = form.get("stage");
  const stage = stageValue === null
    ? mode === "create" ? { stage: "New" as const } : {}
    : { stage: String(stageValue) as ProspectStage };
  const ownerValue = String(form.get("ownerId") ?? "");

  return {
    firm: String(form.get("firm") ?? "").trim() || null,
    opportunityName: String(form.get("opportunityName") ?? "").trim(),
    contact: String(form.get("contact") ?? "").trim() || null,
    referralSource: String(form.get("referralSource") ?? "").trim() || null,
    ...stage,
    ownerId: ownerValue ? Number(ownerValue) : null,
    nextFollowUpDate: String(form.get("nextFollowUpDate") ?? "") || null,
    lastInteractionAt: String(form.get("lastInteractionAt") ?? "") || defaultLastInteractionAt,
  };
}
