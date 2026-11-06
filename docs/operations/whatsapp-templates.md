# WhatsApp templates

The templates each organization submits to Meta from its own WhatsApp account, one
for each message Rubens starts
([ADR-0010](../adr/0010-whatsapp-cloud-api-number-per-organization.md)). When each
is sent is in [messages.md](../domain/messages.md#to-patients).

- **Category**: utility, every one. Each is about one patient's appointment, with
  nothing promotional in it. Meta can move a template to marketing after approving
  it, which costs more than twice as much; the admins are warned
  ([messages.md](../domain/messages.md#when-meta-limits-the-number)).
- **Voice**: the organization's own, `vos` or `usted` and its sign-off, written into
  the text when it is submitted. Communication rules do not change an approved
  template. An organization can have several approved versions of one template;
  any approved one may go.
- **No buttons.** The patient answers in their own words, and the assistant reads
  the answer.
- **Variables** are named, lowercase with underscores, in double braces, and Rubens
  fills each from the appointment. A template neither starts nor ends with a
  variable, and its body is at most 1,024 characters
  ([components](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components),
  [error 2388299](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes)).
- **Never a person's reply in a variable**: a reply after the window closed waits
  for the patient to answer `reabrir_conversacion`.

The code refers to a template by its name. The texts below are drafts in `vos`,
with `[firma]` standing for the organization's sign-off, fixed text and not a
variable; the business
owner adjusts them before the first organization submits them.

| Variable           | Value                                                   |
| ------------------ | ------------------------------------------------------- |
| `{{paciente}}`     | The patient's first name, or chosen name                |
| `{{profesional}}`  | The practitioner, as the practitioner's rules name them |
| `{{fecha}}`        | The day, such as `jueves 12 de noviembre`               |
| `{{hora}}`         | The time, in the office's zone, such as `10:30`         |
| `{{sede}}`         | The office's name                                       |
| `{{direccion}}`    | The office's address                                    |
| `{{indicaciones}}` | The medical service's care instructions                 |

## `confirmacion_turno`

Sent when an appointment is booked, or a request approved, if its medical service
asks for it.

> Hola {{paciente}}, tu turno con {{profesional}} quedó reservado para el {{fecha}} a las {{hora}} en {{sede}} ({{direccion}}). Si necesitás cambiarlo, respondé este mensaje. [firma]

## `recordatorio_turno`

A reminder that asks for confirmation.

> Hola {{paciente}}, te recordamos tu turno con {{profesional}} el {{fecha}} a las {{hora}} en {{sede}}. ¿Nos confirmás tu asistencia? Si necesitás cancelarlo o cambiarlo, respondé este mensaje. [firma]

## `recordatorio_turno_sin_confirmacion`

A reminder that asks nothing, such as one two hours before.

> Hola {{paciente}}, te esperamos el {{fecha}} a las {{hora}} con {{profesional}} en {{sede}} ({{direccion}}). [firma]

## `indicaciones`

A medical service's care instructions, sent when the appointment is marked
attended. The medical service's text goes whole, and must fit the
body's limit. Whether Meta accepts line breaks in a value is to be tested before
it is built; care instructions are often a list.

> Hola {{paciente}}, te dejamos las indicaciones de {{profesional}} para después de tu turno: {{indicaciones}}. Cualquier duda, respondé este mensaje. [firma]

## `seguimiento`

A medical service's follow-up. Of the set, the one most likely to be moved to
marketing: it names the appointment so it stays about it.

> Hola {{paciente}}, ¿cómo te sentís después de tu turno del {{fecha}} con {{profesional}}? Contanos respondiendo este mensaje. [firma]

## Appointments the organization changed

Each invites a reply, and the assistant offers times in the conversation.

### `turno_movido`

Sent when staff move an appointment.

> Hola {{paciente}}, tuvimos que mover tu turno con {{profesional}}: ahora es el {{fecha}} a las {{hora}} en {{sede}}. Si no te queda bien, respondé este mensaje y buscamos otro horario. [firma]

### `turno_cancelado`

Sent when staff cancel an appointment, by the business. Until booking arrives in
the second release, a reply asking for another time is handed off.

> Hola {{paciente}}, tuvimos que cancelar tu turno con {{profesional}} del {{fecha}} a las {{hora}}. Disculpá las molestias. Respondé este mensaje y buscamos otro horario. [firma]

### `turno_a_reprogramar`

Sent when time off or a closure leaves the appointment outside working time,
unless whoever entered it chose not to tell the patients.

> Hola {{paciente}}, tuvimos que mover tu turno del {{fecha}} con {{profesional}}. Respondé este mensaje y buscamos otro horario. [firma]

### `solicitud_no_confirmada`

Sent when a request is rejected or expires. Requests come with booking, in the
second release.

> Hola {{paciente}}, no pudimos confirmar el turno que pediste con {{profesional}} para el {{fecha}}. Respondé este mensaje y buscamos otro horario. [firma]

## `reabrir_conversacion`

Sent when a person replies after the conversation window closed. Their reply is
delivered once the patient answers this
([assistant.md](../domain/assistant.md#handoff)).

> Hola {{paciente}}, tenemos una respuesta para vos. Respondé este mensaje para verla. [firma]
