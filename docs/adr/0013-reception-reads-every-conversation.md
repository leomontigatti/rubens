# ADR-0013: Reception reads every conversation; the clinical record stays with the practitioners

Date: 2026-11-11. Decided by the business owner (#290). Amends
[ADR-0007](./0007-patients-words-on-telegram.md)'s note on Telegram and the ruling in
#169 that judges a burst of messages together to hide it.

Until now a patient's WhatsApp message the assistant judged clinical, or had not judged
yet, was withheld from everyone who is not a practitioner who keeps clinical records: the
inbox showed reception and the admins that a clinical message existed, never its words,
and a clinical handoff reached only practitioners. `clinical` meant "mentions a symptom",
and #169 judged a burst as one, so `necesitaría un turno porque me duele una muela` hid a
plain appointment request from the people who book appointments.

That left reception unable to act on what it was shown. Patients write to the
organization, not to a practitioner. An opt-out among words reception could not read
needed a practitioner to report it (#249, #267); a receipt sent as a photo went to the
practitioner as a clinical detail; and an organization with no practitioner who keeps
clinical records sent a clinical handoff to nobody (#285).

We decided:

- **Reception and admins read every conversation**, in the app and on Telegram: the
  patient's messages whatever the model judged, a message not judged yet, a held reply
  and a practitioner's reply.
- **A practitioner reads only the conversations handed to them**, no longer every
  conversation of their patients (#156, #201): reception answers the rest, and a
  practitioner sees what someone sent them. The number's link to its patients still
  routes a handoff to the appointment's practitioner.
- **The clinical record stays practitioner-only.** It is what Ley 26.529 protects, and
  nothing about who reads it changes ([access.md](../domain/access.md)). Staff who read
  a conversation are bound by professional secrecy.
- **The judgement asks whether a message needs the practitioner**: advice or whether
  something is normal, a medicine or a treatment, how the patient is after a procedure.
  A symptom beside another request does not. That judgement now routes a handoff and
  hides nothing; the check on the assistant's own replies is unchanged.
- **Handoffs split by who answers**: what needs the practitioner goes to them, and the
  patient is told so; everything else, a photo and a message the model could not read
  included, goes to reception and tells the patient nothing about it. The assistant
  keeps answering while a handoff is open, the emergency reply always goes, and taking
  a conversation back sends nothing.
- **A health question goes to the practitioner who treats it** (2026-11-12, from the
  first run of the evaluation on this change). A clinic can have several specialties: a
  question goes to an upcoming appointment's practitioner only when it is about what
  they treat, judged by the appointment's medical service and the practitioner's
  specialty, which the model now reads. Any other health question, or one from a
  patient with nothing booked, goes to reception, which decides who sees it. The
  judgement opens the handoff in code when the model does not, and an emergency always
  counts as needing the practitioner.

## Considered

- **Keep the hiding and patch its gaps** (an opt-out report on the conversation, #267;
  admins as a last recipient, #285): each gap needed its own state and screens, and
  reception still could not read a receipt or tell a booking from a question.
- **Hide only what a practitioner wrote**: a practitioner's reply is part of the same
  conversation the patient keeps on their phone, and reception answers what follows it.

## Consequences

- It is a one-way door: once reception has read a conversation's words it cannot unread
  them, and patients get the new handoff messages (`Le paso tu consulta a …`).
- The opt-out report on a clinical handoff and its column are removed; reception decides
  opt-outs with the words in front of it, as for any other reply.
- On Telegram, ADR-0007 kept the patient's words to the handoff's recipients. The words
  reach Telegram the same way, but a recipient may now be reception: the exposure is
  still kept to handoffs, and Telegram's place in the privacy notice is still for counsel
  to confirm before go-live.
