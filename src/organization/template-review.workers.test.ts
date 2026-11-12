import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { assistantModelId } from "#/lib/assistant.ts";

import {
  addMember,
  adminCaller,
  expectOk,
  inStorage,
  scriptedModel,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";
import { modelUsage } from "#/organization/whatsapp-schema.ts";

// The assistant's review of a template's text (#345): an admin sends the text
// being written, unsaved edits included, and the assistant's model reads it
// against the Trato, the Tono and Meta's utility category, and answers with
// notes. It advises: nothing is saved and nothing reaches Meta. The model is
// scripted at its port.

vi.mock(import("#/organization/assistant-model.ts"), async (original) => ({
  ...(await original()),
  assistantModelFor: () => scriptedModel,
}));

let organization: OrganizationStub;

const body = "Hola {{paciente}}, te recordamos tu turno del {{fecha}} a las {{hora}}.";

beforeEach(async () => {
  scriptedModel.reset();
  ({ organization } = await setUpTestOrganization());
});

describe("reviewing a template's text", () => {
  it("returns the model's notes on the text, read under the organization's Trato and Tono", async () => {
    expectOk(
      await organization.saveCommunicationRules(adminCaller, {
        formOfAddress: "usted",
        tone: "Cordial y breve.",
        phone: "",
      }),
    );
    scriptedModel.scriptReview({ notes: ["Trata al paciente de vos: el trato es usted."] });

    const reviewed = expectOk(await organization.reviewTemplate(adminCaller, { body }));

    expect(reviewed.notes).toEqual(["Trata al paciente de vos: el trato es usted."]);
    expect(scriptedModel.reviews).toEqual([
      expect.objectContaining({ body, formOfAddress: "usted", tone: "Cordial y breve." }),
    ]);
  });

  it("returns no notes when the model finds nothing", async () => {
    const reviewed = expectOk(await organization.reviewTemplate(adminCaller, { body }));

    expect(reviewed.notes).toEqual([]);
  });

  it("says the review failed when the model does", async () => {
    scriptedModel.scriptReview("fails");

    expect(await organization.reviewTemplate(adminCaller, { body })).toEqual({
      ok: false,
      reason: "reviewFailed",
    });
  });

  it("refuses without calling the model when the Worker has no model key", async () => {
    scriptedModel.hasApiKey = false;

    expect(await organization.reviewTemplate(adminCaller, { body })).toEqual({
      ok: false,
      reason: "missingApiKey",
    });
    expect(scriptedModel.reviews).toEqual([]);
  });

  it("refuses a blank text without calling the model", async () => {
    expect(await organization.reviewTemplate(adminCaller, { body: "  \n" })).toEqual({
      ok: false,
      reason: "invalidInput",
    });
    expect(scriptedModel.reviews).toEqual([]);
  });

  it("records the review's tokens in the assistant's usage, apart from the sandbox's", async () => {
    scriptedModel.reviewUses({ inputTokens: 900, outputTokens: 70 });

    expectOk(await organization.reviewTemplate(adminCaller, { body }));

    const { usage } = expectOk(await organization.whatsappSettings(adminCaller));
    expect(usage.models).toEqual([
      { model: assistantModelId, sandbox: false, inputTokens: 900, outputTokens: 70 },
    ]);
    const purposes = await inStorage(organization, (database) =>
      database.select({ purpose: modelUsage.purpose }).from(modelUsage).all(),
    );
    expect(purposes).toEqual([{ purpose: "templateReview" }]);
  });

  it("refuses a member who is not an admin, without calling the model", async () => {
    const receptionist = await addMember(organization, ["receptionist"]);

    expect(await organization.reviewTemplate(receptionist, { body })).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(scriptedModel.reviews).toEqual([]);
  });
});
