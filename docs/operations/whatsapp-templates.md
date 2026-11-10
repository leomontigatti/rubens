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
- **Voice**: the organization's own, `vos` or `usted` and its sign-off, written into
  the text when it is submitted. Communication rules do not change an approved
  template. An organization can have several approved versions of one template;
  any approved one may go.
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
or already at Meta; the check before it refuses `[firma]` left in place. Meta's name for a version stays
internal, never shown: for the organization's own templates it is built from the
template's id and the version, such as `t_<id>_v2`, so renaming one submits
nothing; an event template's is its name and the version, such as
`turno_movido_v2`.

`Plantillas` lists every template, each with its timing (or, for an event
template, its event) under its name; `Nueva plantilla` creates one of the
organization's own. A template's page edits its name and timing, which save on
their own, and its text, which a save submits to Meta when it differs from the
latest version's. Under `Texto`: `No escribas cuándo se envía (mañana, en 2
horas): usá {{fecha}} y {{hora}}.` The preview warns when the text says `mañana`,
`hoy` or `en N horas`.

Each new organization starts with the four drafts below, unsent, in `vos`, with
`[firma]` standing for its sign-off, fixed text and not a variable. A draft sends
nothing until the admin writes in their sign-off, submits it and Meta approves
it, and a medical service picks it. There is no draft for care instructions: a
medical service that sends them gets a template of its own, written by an admin.

| Variable          | Value                                                   |
| ----------------- | ------------------------------------------------------- |
| `{{paciente}}`    | The patient's first name, or chosen name                |
| `{{profesional}}` | The practitioner, as the practitioner's rules name them |
| `{{fecha}}`       | The day, such as `jueves 12 de noviembre`               |
| `{{hora}}`        | The time, in the office's zone, such as `10:30`         |
| `{{sede}}`        | The office's name                                       |
| `{{direccion}}`   | The office's address                                    |

Every template may use every variable, except `reabrir_conversacion`, which is
about a conversation and knows only `{{paciente}}`.

## The organization's drafts

### Confirmación del turno

Sent when the appointment is booked.

> Hola {{paciente}}, tu turno con {{profesional}} quedó reservado para el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Si necesitás cambiarlo, respondé este mensaje. [firma]

### Recordatorio con confirmación

Sent 1 day before the appointment; it asks the patient to confirm.

> Hola {{paciente}}, te recordamos tu turno con {{profesional}} el {{fecha}} a las {{hora}} en {{sede}}. ¿Nos confirmás tu asistencia? Si necesitás cancelarlo o cambiarlo, respondé este mensaje. [firma]

### Recordatorio

Sent 2 hours before the appointment; it asks nothing.

> Hola {{paciente}}, te esperamos el {{fecha}} a las {{hora}} con {{profesional}} en {{sede}} ({{direccion}}). [firma]

### Seguimiento

Sent 1 day after the appointment, once it is marked attended. Of the set, the one
most likely to be moved to marketing: it names the appointment so it stays about
it.

> Hola {{paciente}}, ¿cómo te sentís después de tu turno del {{fecha}} con {{profesional}}? Contanos respondiendo este mensaje. [firma]

## Event templates

Fixed, sent on their event, and never picked by a medical service. Each but
`reabrir_conversacion` invites a reply, and the assistant offers times in the
conversation, except as `turno_cancelado` says.

### `turno_movido`

Sent when staff move an appointment.

> Hola {{paciente}}, tuvimos que mover tu turno con {{profesional}}: ahora es el {{fecha}} a las {{hora}} en {{sede}}. Si no te queda bien, respondé este mensaje y buscamos otro horario. [firma]

### `turno_cancelado`

Sent when staff cancel an appointment, by the business. Until booking arrives in
the second release, a reply asking for another time is handed off.

> Hola {{paciente}}, tuvimos que cancelar tu turno con {{profesional}} del {{fecha}} a las {{hora}}. Disculpá las molestias. Respondé este mensaje y buscamos otro horario. [firma]

### `turno_a_reprogramar`

Sent when time off, a closure or a schedule change leaves the appointment outside
working time, unless whoever entered the time off or the closure chose not to tell
the patients.

> Hola {{paciente}}, tuvimos que mover tu turno del {{fecha}} con {{profesional}}. Respondé este mensaje y buscamos otro horario. [firma]

### `solicitud_no_confirmada`

Sent when a request is rejected or expires. Requests come with booking, in the
second release.

> Hola {{paciente}}, no pudimos confirmar el turno que pediste con {{profesional}} para el {{fecha}}. Respondé este mensaje y buscamos otro horario. [firma]

### `reabrir_conversacion`

Sent when a person replies after the conversation window closed. Their reply is
delivered once the patient answers this
([assistant.md](../domain/assistant.md#handoff)).

> Hola {{paciente}}, tenemos una respuesta para vos. Respondé este mensaje para verla. [firma]
