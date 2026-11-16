# ADR-0014: Reply buttons on the happy path, read by code

**Status**: accepted. It supersedes the "no buttons" rule of
[ADR-0006](./0006-patient-assistant-on-whatsapp.md) ("That boundary is what allows
messages without buttons") and of
[ADR-0010](./0010-whatsapp-cloud-api-number-per-organization.md) (_Templates and the
window_, and quick-reply buttons under _Considered options_).

Date: 2026-11-16. Asked by the clinic, and decided by the business owner the same day:
the commonest replies should cost less and give the model less to read.

Until now no message carried buttons. The patient answered in their own words, and the
model read every answer, the plainest `sí` included. Since 2026-10-01 Meta charges every
message the organization sends, inside the window too, so the model's calls are the part
of a plain confirmation that can still be cut. Two of those calls are reading `sí` and
checking the reply to it.

We decided:

- **Only templates carry buttons, and only three kinds:**
  - a reminder that asks to confirm: `Sí, voy` · `Necesito cambiarlo`;
  - `turno_movido`, which asks the same about the new time: `Sí, voy` · `Necesito cambiarlo`;
  - `reabrir_conversacion`: `Ver respuesta`.

  The assistant's replies never carry buttons: inside the conversation it writes as a
  person does. Every other template goes without buttons until the audit of its flow
  says otherwise.

- **A button is a shortcut, never the only way.** The text still invites a reply in the
  patient's own words, and those words still go to the model.
- **Code reads only the button's id, never the patient's words.**
  - The id names what was offered and what it is about: the queued message, and through
    it the appointment, or the waiting reply. A tap answers that thing, not whatever came
    last.
  - A tap the code can still act on runs the change under the app's own rules, and
    starts no model turn.
  - A tap the code cannot act on goes to the model as the patient's words, the button's
    label, with the message it answers. For example, the appointment was moved or
    cancelled since.
  - A tap on a negative button goes to the model the same way, as the patient's words.
    `Necesito cambiarlo` needs a conversation.
- **The labels are underthing's, in the patient's voice, and the same in `vos` and
  `usted`.** An admin chooses whether one of the organization's own templates asks to
  confirm with buttons. The admin never writes a label or picks the change a button
  makes.
- **A tap is the patient's message.** It opens or restarts the window, shows in the inbox
  as their words, and stays in the history the model reads later.

## Why it still reads as human

ADR-0006 and ADR-0010 kept buttons out so that the first message would not read like a
system notice. That concern is answered by how few messages carry them, not by having
none. They go only on messages where the patient's answer is a single yes:

- a quick-reply label shows in the chat as the patient's own bubble (`Sí, voy`);
- the answer to it is a sentence, not a receipt;
- the words that do need reading (a health question, an emergency, an ambiguous `no
  puedo`) still go to the model.

## Considered options

- **Keep reading every answer with the model**: what we had. It works, and it pays two
  model calls to read `sí`. A 👍 or a `sí` on a shared number, or after a later message,
  also needed the prompt's rules to tell which reminder it answered; an id cannot be
  wrong about that.
- **Parse `sí` in code**: a second reader of the patient's words, which ADR-0010 ruled
  out. A button's id is not words, so code reads no words under this decision either.
- **Buttons on the assistant's proposals** (`Sí` · `No`): the commonest turn, and the
  cheapest to save. Rejected by the owner: inside the conversation a reply with buttons
  reads like a phone menu, and the assistant should read as a person.
- **Buttons on every template**: cheaper still, and every message would read like a
  system notice.
- **A cancel button on the reminder**: it frees a time with one tap, by mistake as easily
  as on purpose. A patient who wants to cancel writes it, and the assistant asks first.

## Consequences

- **Each template with buttons is a new version for Meta to approve.** The versions
  already approved keep going, without buttons, until it does. Changing a template's
  buttons changes what Meta approved, so it submits a new version, as a change of text
  does.
- **The organization's templates gain one setting**, whether they ask to confirm. Until
  now the model judged that from the reminder's words.
- **An incoming message now carries the message it answers.** Meta sends that as
  `context.id`, and this decision starts using it.
- **The 👍 rule stays**, read by the model as before, since a reaction carries no id
  beyond the message it reacts to. Accepting a proposal stays the model's, as before.
- **The reply to a tap costs a message, as any reply does.** Only the model's calls are
  saved.
