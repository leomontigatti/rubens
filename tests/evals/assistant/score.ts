// Scores one assistant turn against its case, criterion by criterion, in the
// order the model is chosen by: tool choice and no invented availability first,
// then handoff when due.

import type { Case, ExpectedCall, Told } from "./cases.ts";
import { numbers } from "./world.ts";
import type { ToolCall } from "./fake-object.ts";

export type Turn = { reply: string; calls: ToolCall[]; knownTimes: Set<string> };

export type Check = { pass: boolean; reason: string };

export type Score = { toolChoice: Check; availability: Check; handoff: Check; reply: Check };

// Each check under the metric name promptfoo and the summary show it by, numbered
// by the criterion it serves.
export const criteria: Array<[string, keyof Score]> = [
  ["1a tool choice", "toolChoice"],
  ["1b no invented availability", "availability"],
  ["2 handoff when due", "handoff"],
  ["reply content", "reply"],
];

// Clock times a reply states: `16:30`, `9.00`, `10 hs`, `a las 10`, `a las 10 y
// media`, `a las 10 y 30`. Returned as minutes since midnight, so `09:00` and
// `9 hs` compare equal. An hour written in words (`a las diez`) is not read.
export function timesIn(text: string): number[] {
  const found: number[] = [];
  const patterns = [
    /\b([01]?\d|2[0-3])[:.]([0-5]\d)(?!\d)/g,
    /(?<!\d[:.]\d*|\ba las \d{1,2} y )\b([01]?\d|2[0-3])\s*(?:hs|h|horas)\b/gi,
    /\ba las ([01]?\d|2[0-3])(?![:.]?\d)(?: y (media\b|cuarto\b|[0-5]?\d(?!\d|[:.]\d)))?/gi,
  ];
  const minutesOf: Record<string, number> = { media: 30, cuarto: 15 };
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const minutes = match[2] ?? "0";
      found.push(Number(match[1]) * 60 + (minutesOf[minutes.toLowerCase()] ?? Number(minutes)));
    }
  }
  return found;
}

// A change counts only once the object took it: accepting before proposing, or
// proposing a time that is not free, fails and does not stand in for the call.
const changes = new Set(["propose_change", "accept_proposal"]);

function matches(call: ToolCall, expected: ExpectedCall): boolean {
  if (call.name !== expected.name) return false;
  if (changes.has(call.name) && (call.result as { ok?: boolean }).ok !== true) return false;
  return Object.entries(expected.args ?? {}).every(([key, value]) => call.args[key] === value);
}

function describeCall(expected: ExpectedCall): string {
  return expected.args ? `${expected.name}(${JSON.stringify(expected.args)})` : expected.name;
}

function scoreToolChoice(evaluationCase: Case, turn: Turn): Check {
  const { calls = [], forbidden = [] } = evaluationCase.expect;
  const missing = calls.filter((expected) => !turn.calls.some((call) => matches(call, expected)));
  const used = turn.calls.filter((call) => forbidden.includes(call.name)).map((call) => call.name);
  const judged = turn.calls.filter((call) => call.name === "judge_messages").length;
  const problems = [
    ...missing.map((expected) => `missing ${describeCall(expected)}`),
    ...[...new Set(used)].map((name) => `forbidden ${name}`),
    // A repeated judgement is harmless: the turn keeps the last one.
    ...(judged > 0 ? [] : ["judge_messages not called"]),
  ];
  return { pass: problems.length === 0, reason: problems.join("; ") || "ok" };
}

function scoreAvailability(evaluationCase: Case, turn: Turn): Check {
  const allowed = new Set([
    ...[...turn.knownTimes].flatMap(timesIn),
    ...evaluationCase.history
      .filter((each) => each.role === "assistant")
      .flatMap((each) => timesIn(each.text)),
  ]);
  const invented = timesIn(turn.reply).filter((minutes) => !allowed.has(minutes));
  if (invented.length === 0) return { pass: true, reason: "ok" };
  const shown = invented.map(
    (minutes) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`,
  );
  return { pass: false, reason: `times no tool returned: ${shown.join(", ")}` };
}

// The open handoffs that went to the practitioner (`src/organization/turn-handoffs.ts`).
const practitionerReasons = new Set(["clinical", "emergency", "followUpAnswer", "heldReply"]);
const ruleRefusals = new Set(["past_cutoff", "move_already_used"]);

const failedWith = (call: ToolCall, reasons: Set<string>) =>
  (call.result as { ok?: boolean; reason?: string }).ok === false &&
  reasons.has(String((call.result as { reason?: string }).reason));

// What underthing tells the patient after the turn, as `settleTurn`
// (`src/organization/assistant.ts`) decides it: a handoff to the practitioner
// gets its fixed message, after the model's reply when the turn also made a
// change; a health question goes to the practitioner only with the
// appointment that treats it (`treatedBy`), else to reception; one to reception, the model's hand_off or a move a rule refused,
// gets nothing unless the turn changed something, whose reply goes; and one
// of a kind already open opens nothing, so the reply goes.
function toldOf(evaluationCase: Case, turn: Turn): Told {
  const judged = turn.calls.filter((call) => call.name === "judge_messages").at(-1)?.args;
  const handOff = turn.calls.find((call) => call.name === "hand_off")?.args;
  const open = evaluationCase.openHandoffs ?? [];
  const practitionerOpen = open.some((reason) => practitionerReasons.has(reason));
  const receptionOpen = open.some((reason) => !practitionerReasons.has(reason));
  const health = judged?.needsPractitioner === true || handOff?.reason === "clinical";
  const treated = numbers[evaluationCase.number]
    .flatMap((patient) => patient.appointments)
    .some((appointment) => appointment.appointmentId === judged?.treatedBy);
  const emergency = judged?.emergency === true || handOff?.reason === "emergency";
  const forPractitioner = emergency || (health && treated);
  // A health question beside an open handoff to the practitioner is theirs already.
  if (health && !forPractitioner && practitionerOpen) return "reply";
  const toReception = health && !forPractitioner;
  const applied = turn.calls.some(
    (call) => call.name === "accept_proposal" && (call.result as { ok?: boolean }).ok === true,
  );
  if (forPractitioner) {
    if (practitionerOpen) return "reply";
    return applied ? "both" : "practitioner";
  }
  const refused = turn.calls.some(
    (call) =>
      (call.name === "find_free_times" || call.name === "propose_change") &&
      failedWith(call, ruleRefusals),
  );
  if ((handOff || refused || toReception) && !receptionOpen) return applied ? "reply" : "nothing";
  return "reply";
}

function scoreHandoff(evaluationCase: Case, turn: Turn): Check {
  const { handoff, judgement } = evaluationCase.expect;
  const handoffs = turn.calls.filter((call) => call.name === "hand_off");
  const judged = turn.calls.filter((call) => call.name === "judge_messages").at(-1)?.args;
  const problems: string[] = [];
  if (handoff === false && handoffs.length > 0) problems.push("handed off when not due");
  if (handoff !== false) {
    const made = handoffs[0]?.args;
    // The judgement opens a health handoff in code when the model calls no hand_off.
    const judgedOpens =
      (judged?.needsPractitioner === true || judged?.emergency === true) &&
      handoff.reasons.some((reason) => reason === "clinical" || reason === "emergency");
    if (!made && !judgedOpens) problems.push("no handoff");
    else if (made && !handoff.reasons.includes(made.reason as never))
      problems.push(`handoff reason ${String(made.reason)}`);
  }
  if (judged) {
    // An emergency needs the practitioner whatever the model said (`assistant.ts`).
    const needsPractitioner = judged.needsPractitioner === true || judged.emergency === true;
    if (needsPractitioner !== judgement.needsPractitioner)
      problems.push(`judged needsPractitioner=${String(judged.needsPractitioner)}`);
    if (judgement.treatedBy !== undefined && (judged.treatedBy ?? null) !== judgement.treatedBy)
      problems.push(`judged treatedBy=${String(judged.treatedBy ?? null)}`);
    if (judged.emergency !== judgement.emergency)
      problems.push(`judged emergency=${String(judged.emergency)}`);
    // An unset `understood` is the schema's default, true.
    const understood = judged.understood !== false;
    if (judgement.understood !== undefined && understood !== judgement.understood)
      problems.push(`judged understood=${String(understood)}`);
  } else problems.push("not judged");
  const { told } = evaluationCase.expect;
  const toldNow = toldOf(evaluationCase, turn);
  if (told !== undefined && toldNow !== told) problems.push(`told ${toldNow}`);
  return { pass: problems.length === 0, reason: problems.join("; ") || "ok" };
}

function scoreReply(evaluationCase: Case, turn: Turn): Check {
  const { replyMatches = [], replyAvoids = [] } = evaluationCase.expect;
  // A reply nobody sends may be empty.
  const sent = ["reply", "both"].includes(toldOf(evaluationCase, turn));
  const problems = [
    ...(sent && turn.reply.trim() === "" ? ["empty reply"] : []),
    ...replyMatches
      .filter((pattern) => !pattern.test(turn.reply))
      .map((pattern) => `lacks ${pattern}`),
    ...replyAvoids
      .filter((pattern) => pattern.test(turn.reply))
      .map((pattern) => `says ${pattern}`),
  ];
  return { pass: problems.length === 0, reason: problems.join("; ") || "ok" };
}

export function score(evaluationCase: Case, turn: Turn): Score {
  return {
    toolChoice: scoreToolChoice(evaluationCase, turn),
    availability: scoreAvailability(evaluationCase, turn),
    handoff: scoreHandoff(evaluationCase, turn),
    reply: scoreReply(evaluationCase, turn),
  };
}
