import { describe, expect, it } from "vite-plus/test";

import { initialSaveState, saveReducer } from "#/components/patient-save.ts";
import type { SaveEvent, SaveState } from "#/components/patient-save.ts";
import type { Patient } from "#/server/patients.ts";

type Input = { firstName: string };

const holder = { id: "holder" } as Patient;
const candidate = { patient: { id: "candidate" } as Patient, matches: [] };

function run(...events: SaveEvent<Input>[]): SaveState<Input> {
  return events.reduce(saveReducer<Input>, initialSaveState<Input>());
}

describe("saveReducer", () => {
  it("is pending from sending until the answer, and keeps the input sent", () => {
    const sent = run({ type: "sent", input: { firstName: "Ana" } });
    expect(sent).toMatchObject({ pending: true, input: { firstName: "Ana" } });

    expect(saveReducer(sent, { type: "settled" }).pending).toBe(false);
  });

  it("shows likely duplicates, and the confirmation sends the same input again", () => {
    const warned = run(
      { type: "sent", input: { firstName: "Ana" } },
      { type: "settled" },
      {
        type: "refused",
        result: { ok: false, reason: "possibleDuplicates", candidates: [candidate] },
      },
    );
    expect(warned).toMatchObject({ candidates: [candidate], holder: null, error: null });

    const confirmed = saveReducer(warned, { type: "sent", input: warned.input! });
    expect(confirmed).toMatchObject({ pending: true, candidates: [], input: { firstName: "Ana" } });
  });

  it("names the patient who holds the document", () => {
    const state = run(
      { type: "sent", input: { firstName: "Ana" } },
      { type: "settled" },
      { type: "refused", result: { ok: false, reason: "documentTaken", patient: holder } },
    );
    expect(state).toMatchObject({ holder, candidates: [], error: null });
  });

  it("shows a refusal's copy", () => {
    const state = run(
      { type: "sent", input: { firstName: "Ana" } },
      { type: "settled" },
      { type: "refused", result: { ok: false, reason: "notFound" } },
    );
    expect(state.error).toBe("No encontramos ese paciente.");
  });

  it("dismissing the warning clears it and keeps the input", () => {
    const state = run(
      { type: "sent", input: { firstName: "Ana" } },
      { type: "settled" },
      {
        type: "refused",
        result: { ok: false, reason: "possibleDuplicates", candidates: [candidate] },
      },
      { type: "dismissed" },
    );
    expect(state).toMatchObject({ candidates: [], input: { firstName: "Ana" } });
  });

  it("a field's problem replaces whatever was shown", () => {
    const state = run(
      { type: "sent", input: { firstName: "Ana" } },
      { type: "settled" },
      { type: "refused", result: { ok: false, reason: "documentTaken", patient: holder } },
      { type: "invalid", message: "Ingresá el apellido." },
    );
    expect(state).toMatchObject({ holder: null, error: "Ingresá el apellido." });
  });
});
