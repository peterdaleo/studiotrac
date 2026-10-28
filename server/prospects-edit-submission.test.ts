import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  record: {} as Record<string, any>,
  getDb: vi.fn(),
}));

vi.mock("./db", () => ({ getDb: mocks.getDb }));

import { buildProspectSubmissionPayload } from "../shared/prospectSubmission";
import { updateProspect } from "./prospects";

function formData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

beforeEach(() => {
  Object.assign(mocks.record, {
    id: 85,
    stage: "Won",
    closedAt: new Date("2026-10-01T00:00:00.000Z"),
    convertedProjectId: 940,
    referralSource: "Previous source",
  });
  mocks.getDb.mockResolvedValue({
    transaction: async (operation: (tx: any) => Promise<unknown>) => operation({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => ({ for: async () => [mocks.record] }),
          }),
        }),
      }),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: async () => Object.assign(mocks.record, patch),
        }),
      }),
    }),
  });
});

describe("converted prospect edit submission", () => {
  it("keeps referral-source edits and omits the disabled stage from an edit payload", async () => {
    // A disabled select is not included in the browser's FormData.
    const payload = buildProspectSubmissionPayload(formData({
      firm: "North Studio",
      opportunityName: "Library renovation",
      contact: "Alex Chen",
      referralSource: "Former client",
      ownerId: "",
      nextFollowUpDate: "",
      lastInteractionAt: "2026-10-27",
    }), "edit", "2026-10-27");

    expect(payload.referralSource).toBe("Former client");
    expect(payload).not.toHaveProperty("stage");

    await updateProspect(85, payload, 42);

    expect(mocks.record).toMatchObject({
      stage: "Won",
      convertedProjectId: 940,
      referralSource: "Former client",
      opportunityName: "Library renovation",
      firm: "North Studio",
      contact: "Alex Chen",
    });
  });

  it("preserves the New default when a new-prospect form has no stage value", () => {
    const payload = buildProspectSubmissionPayload(formData({
      opportunityName: "New lead",
      referralSource: "Website",
    }), "create", "2026-10-27");

    expect(payload.stage).toBe("New");
    expect(payload.referralSource).toBe("Website");
  });

  it("includes a submitted stage when the stage control is enabled", () => {
    const payload = buildProspectSubmissionPayload(formData({
      opportunityName: "Open lead",
      stage: "Proposal",
    }), "edit", "2026-10-27");

    expect(payload.stage).toBe("Proposal");
  });
});
