# WhatsApp templates

The templates each organization submits to Meta from its own WhatsApp account
([ADR-0010](../adr/0010-whatsapp-cloud-api-number-per-organization.md)): its own,
which an admin creates, names and times, and the five fixed event templates. When
each is sent is in [messages.md](../domain/messages.md#to-patients).

- **Category**: utility, every one. Each is about one patient's appointment, with
  nothing promotional in it. Meta can move a template to marketing after approving
  it, which costs more than twice as much: that version no longer goes, its messages
  wait for an approved utility version, and the admins are warned
  ([messages.md](../domain/messages.md#when-meta-limits-the-number)).
- **Voice**: the organization's own, `vos` or `usted` (`Trato` in the communication
  rules), written into the text. A default draft never sent follows the `Trato`: a save
  of the rules rewords it to the text below in the `Trato` saved, audited as a change of
  the template. A template once sent to Meta, or a draft whose text is not one below,
  keeps its text whatever the `Trato`. The template's page says which. An organization can have several approved versions of one template;
  any approved one may go.
- **The name, not a sign-off.** A text names the organization with `{{organizacion}}`
  (`te escribimos de {{organizacion}}`), and carries no signature.
- **The assistant's fixed checks.** No opening `¿` or `¡`, and no emojis, as in the
  assistant's replies ([assistant.md](../domain/assistant.md#communication-rules)):
  the check before submitting refuses either and says why. A text greets with
  `Hola`, never by the time of day, and names the date, never `mañana`.
- **No buttons.** The patient answers in their own words, and the assistant reads
  the answer.
- **Variables** are named, lowercase with underscores, in double braces, and underthing
  fills each from the appointment. A template neither starts nor ends with a
  variable, and its body is at most 1,024 characters
  ([components](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components),
  [error 2388299](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes)).
- **Never a person's reply in a variable**: a reply after the window closed waits
  for the patient to answer `reabrir_conversacion`.

An admin writes and submits every template from the WhatsApp `Plantillas` page
([messages.md](../domain/messages.md#the-organizations-templates)). Each
submission of a text is a new version, numbered after the highest version stored
or already at Meta. Meta's name for a version stays
internal, never shown: for the organization's own templates it is built from the
template's id and the version, such as `t_<id>_v2`, so renaming one submits
nothing; an event template's is its name and the version, such as
`turno_movido_v2`.

`Plantillas` lists every template, each with its timing (or, for an event
template, its event) under its name; `Nueva plantilla` creates one of the
organization's own. A template's page edits its name and timing, which save on
their own, and its text, which a save submits to Meta when it differs from the
latest version's; a template never sent and picked by no medical service can be
deleted from it. Under `Texto`, the variables it may use, each a chip that writes
it in at the cursor, and the hint `No escribas cuándo se envía (mañana, en 2
horas): usá {{fecha}} y {{hora}}. Sin ¿ ni ¡ de apertura y sin emojis.` The page
also says whether changing `Trato` in the communication rules changes the text:
it does for a default draft never sent, and not once it is sent. The preview warns when the text says `mañana`, `hoy` or `en N horas`, and
fills `{{organizacion}}` with the organization's name.

Each new organization starts with the four drafts below, unsent, in `vos` (the
rules' starting value); each follows the `Trato` an admin then saves until it is
sent. A draft
sends nothing until an admin submits it, Meta approves it, and a medical service picks
it. There is no draft for care instructions: a medical service that sends them gets a
template of its own, written by an admin. The event templates' drafts follow the same
`Trato`.

| Variable           | Value                                                   |
| ------------------ | ------------------------------------------------------- |
| `{{paciente}}`     | The patient's first name, or chosen name                |
| `{{organizacion}}` | The organization's name                                 |
| `{{profesional}}`  | The practitioner, as the practitioner's rules name them |
| `{{fecha}}`        | The day, such as `jueves 12 de noviembre`               |
| `{{hora}}`         | The time, in the office's zone, such as `10:30`         |
| `{{sede}}`         | The office's name                                       |
| `{{direccion}}`    | The office's address                                    |

Meta's example for `{{organizacion}}` is the organization's name, as for the
others the sample appointment's.

Every template may use every variable, except `reabrir_conversacion`, which is
about a conversation and knows only `{{paciente}}` and `{{organizacion}}`.

## The organization's drafts

### Confirmación del turno

Sent when the appointment is booked.

> Hola {{paciente}}, te escribimos de {{organizacion}}: tu turno con {{profesional}} quedó reservado para el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Si necesitás cambiarlo, respondé este mensaje.

In `usted`:

> Hola {{paciente}}, le escribimos de {{organizacion}}: su turno con {{profesional}} quedó reservado para el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Si necesita cambiarlo, responda este mensaje.

### Recordatorio con confirmación

Sent 1 day before the appointment; it asks the patient to confirm, in words a reply answers.

> Hola {{paciente}}, te escribimos de {{organizacion}} para recordarte tu turno con {{profesional}} del {{fecha}} a las {{hora}} en {{sede}}. Respondé este mensaje para confirmar que venís, o si necesitás cancelarlo o cambiarlo.

In `usted`:

> Hola {{paciente}}, le escribimos de {{organizacion}} para recordarle su turno con {{profesional}} del {{fecha}} a las {{hora}} en {{sede}}. Responda este mensaje para confirmar que viene, o si necesita cancelarlo o cambiarlo.

### Recordatorio

Sent 2 hours before the appointment; it asks nothing.

> Hola {{paciente}}, te escribimos de {{organizacion}}: tu turno con {{profesional}} es el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Te esperamos.

In `usted`:

> Hola {{paciente}}, le escribimos de {{organizacion}}: su turno con {{profesional}} es el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Hasta pronto.

### Seguimiento

Sent 1 day after the appointment, once it is marked attended. Of the set, the one
most likely to be moved to marketing: it names the appointment so it stays about
it.

> Hola {{paciente}}, te escribimos de {{organizacion}} por tu turno del {{fecha}} con {{profesional}}. Contanos cómo te sentís respondiendo este mensaje.

In `usted`:

> Hola {{paciente}}, le escribimos de {{organizacion}} por su turno del {{fecha}} con {{profesional}}. Cuéntenos cómo se siente respondiendo este mensaje.

## Event templates

Fixed, sent on their event, and never picked by a medical service. Each but
`reabrir_conversacion` invites a reply, and the assistant offers times in the
conversation, except as `turno_cancelado` says.

### `turno_movido`

Sent when staff move an appointment.

> Hola {{paciente}}, te escribimos de {{organizacion}}: tuvimos que mover tu turno con {{profesional}}, que ahora es el {{fecha}} a las {{hora}} en {{sede}}. Si no te queda bien, respondé este mensaje y buscamos otro horario.

In `usted`:

> Hola {{paciente}}, le escribimos de {{organizacion}}: tuvimos que mover su turno con {{profesional}}, que ahora es el {{fecha}} a las {{hora}} en {{sede}}. Si no le queda bien, responda este mensaje y buscamos otro horario.

### `turno_cancelado`

Sent when staff cancel an appointment, by the business. Until booking arrives in
the second release, a reply asking for another time is handed off.

> Hola {{paciente}}, te escribimos de {{organizacion}}: tuvimos que cancelar tu turno con {{profesional}} del {{fecha}} a las {{hora}}. Disculpá las molestias. Respondé este mensaje y buscamos otro horario.

In `usted`:

> Hola {{paciente}}, le escribimos de {{organizacion}}: tuvimos que cancelar su turno con {{profesional}} del {{fecha}} a las {{hora}}. Disculpe las molestias. Responda este mensaje y buscamos otro horario.

### `turno_a_reprogramar`

Sent when time off, a closure or a schedule change leaves the appointment outside
working time, unless whoever entered the time off or the closure chose not to tell
the patients.

> Hola {{paciente}}, te escribimos de {{organizacion}}: tuvimos que mover tu turno del {{fecha}} con {{profesional}}. Respondé este mensaje y buscamos otro horario.

In `usted`:

> Hola {{paciente}}, le escribimos de {{organizacion}}: tuvimos que mover su turno del {{fecha}} con {{profesional}}. Responda este mensaje y buscamos otro horario.

### `solicitud_no_confirmada`

Sent when a request is rejected or expires. Requests come with booking, in the
second release.

> Hola {{paciente}}, te escribimos de {{organizacion}}: no pudimos confirmar el turno que pediste con {{profesional}} para el {{fecha}}. Respondé este mensaje y buscamos otro horario.

In `usted`:

> Hola {{paciente}}, le escribimos de {{organizacion}}: no pudimos confirmar el turno que pidió con {{profesional}} para el {{fecha}}. Responda este mensaje y buscamos otro horario.

### `reabrir_conversacion`

Sent when a person replies after the conversation window closed. Their reply is
delivered once the patient answers this
([assistant.md](../domain/assistant.md#handoff)).

> Hola {{paciente}}, te escribimos de {{organizacion}}: tenemos una respuesta para vos. Respondé este mensaje para verla.

In `usted`:

> Hola {{paciente}}, le escribimos de {{organizacion}}: tenemos una respuesta para usted. Responda este mensaje para verla.
