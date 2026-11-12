import type { AssistantModel } from "#/organization/assistant-model.ts";

// The assistant's model answered inside the Worker, for checking the template
// review in a browser with no Anthropic key (#345): it reviews a template's
// text after a pause, finds a note in a text that offers a discount, fails on
// a text that says `falla`, and finds nothing in any other. It runs no
// assistant turn: a turn it is given fails, as the real model's would when
// unreachable. It records no usage, since no model ran.

/** Whether the Worker fakes the assistant's model: only with `ASSISTANT_FAKE_MODEL` and no Clerk secret, which every deployed Worker has. */
export function fakesModel(env: { ASSISTANT_FAKE_MODEL?: string; CLERK_SECRET_KEY?: string }) {
  return env.ASSISTANT_FAKE_MODEL === "true" && !env.CLERK_SECRET_KEY;
}

/** How long a fake review takes, so the page's running state shows. */
const reviewMs = 2_000;

export const fakeModel: AssistantModel = {
  missingSetting: () => null,
  runTurn: () => Promise.reject(new Error("The fake model runs no assistant turn")),
  checkReply: () => Promise.reject(new Error("The fake model runs no clinical check")),
  async reviewTemplate({ body }) {
    await new Promise((resolve) => setTimeout(resolve, reviewMs));
    if (/\bfalla\b/iu.test(body)) {
      throw new Error("The fake model failed, as the text asked");
    }
    return {
      notes: /descuento/iu.test(body)
        ? [
            "Ofrecer un descuento es promocional: Meta la pasaría a marketing. Sacá esa frase.",
            "Mencioná solo el turno del paciente, no otros servicios.",
          ]
        : [],
    };
  },
};
