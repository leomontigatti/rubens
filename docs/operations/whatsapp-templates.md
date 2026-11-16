# WhatsApp templates

The templates each organization submits to Meta from its own WhatsApp account
([ADR-0010](../adr/0010-whatsapp-cloud-api-number-per-organization.md)): its own,
which an admin creates, names and times, and the four fixed event templates. When
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
- **The name, not a signature.** A text names the organization with `{{organizacion}}`
  (`te escribimos de {{organizacion}}`), and carries no signature such as `Equipo X`;
  a closing such as `Saludos` is not one.
- **The assistant's fixed checks.** No opening `¿` or `¡`, and no emojis, as in the
  assistant's replies ([assistant.md](../domain/assistant.md#communication-rules)):
  the check before submitting refuses either and says why. A text greets with
  `Hola`, never by the time of day, and names the date, never `mañana`.
- **Buttons** ([ADR-0014](../adr/0014-reply-buttons-on-the-happy-path.md)): quick
  replies, whose labels are underthing's, the same in either `Trato`. `Confirmar
  asistencia` (`Sí, voy` · `Necesito cambiarlo`) on one of the organization's own an
  admin gives it, and always on `turno_movido`; `Ver respuesta` always on
  `reabrir_conversacion`; none on the rest. A tap on `Sí, voy` confirms the
  appointment with no model call; every other answer, `Necesito cambiarlo` included,
  is the patient's words, which the assistant reads
  ([messages.md](../domain/messages.md#to-patients)). The text still invites a reply,
  since a button is a shortcut, never the only way.
- **Variables** are named, lowercase with underscores, in double braces, and underthing
  fills each from the appointment. A template neither starts nor ends with a
  variable, and its body is at most 1,024 characters
  ([components](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components),
  [error 2388299](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes)).
- **Never a person's reply in a variable**: a reply after the window closed waits
  for the patient to answer `reabrir_conversacion`.

An admin writes and submits every template from the WhatsApp `Plantillas` page
([messages.md](../domain/messages.md#the-organizations-templates)). Each
submission of a text, or of the same text with other buttons, is a new version,
numbered after the highest version stored or already at Meta. Meta's name for a version stays
internal, never shown: for the organization's own templates it is built from the
template's id and the version, such as `t_<id>_v2`, so renaming one submits
nothing; an event template's is its name and the version, such as
`turno_movido_v2`.

`Plantillas` lists every template, each with its timing (or, for an event
template, its event) under its name; `Nueva plantilla` creates one of the
organization's own. A template's page edits its name and timing, which save on
their own, and its text and its `Botones`, which a save submits to Meta when either
differs from the latest version's; a template never sent and picked by no medical service can be
deleted from it. Between `Texto` and its box, the variables it may use, each a
chip named in Spanish (`Paciente`, `Organización`) that writes it in at the
cursor; under the box, the hint `No escribas cuándo se envía (mañana, en 2
horas): usá {{fecha}} y {{hora}}. Sin ¿ ni ¡ de apertura y sin emojis.` The page
also says whether changing `Trato` in the communication rules changes the text:
it does for a default draft never sent, and not once it is sent. The preview shows
the buttons under the message, warns when the text says `mañana`, `hoy` or `en N
horas`, and fills `{{organizacion}}` with the organization's name.

Under the preview of a template's page, `Revisar` sends the text in the box,
saved or not, to the assistant's model with the `Trato`, the `Tono` and the
utility category's rules (`src/lib/template-review.ts`), and lists its notes as
`Observaciones`, or `Sin observaciones.` It only advises: the fixed checks above
still refuse on their own, and with no model key or a failed call it says so in a
plain line and the save works as before. The text goes with its variables
unfilled, so no patient's data does; the call counts in the assistant's usage
([assistant.md](../domain/assistant.md#costs)).

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
| `{{prestacion}}`   | The medical service's name, its first letter lowercased |

Meta's example for `{{organizacion}}` is the organization's name, as for the
others the sample appointment's.

`{{prestacion}}` is written after `tu` or `su` (`después de tu {{prestacion}}`), which
fits any medical service whatever its gender. It names the treatment to whoever
reads the phone, a guardian or a sibling on a shared number included: an admin
writes it only into a template whose treatments may be read so.

Every template may use every variable, except `reabrir_conversacion`, which is
about a conversation and knows only `{{paciente}}` and `{{organizacion}}`.

## The organization's drafts

### Confirmación del turno

Sent when the appointment is booked.

> Hola {{paciente}}! Te escribimos de {{organizacion}} para avisarte que tu turno con {{profesional}} del {{fecha}} a las {{hora}} quedó reservado. Escribinos por cualquier duda. Saludos!

In `usted`:

> Hola {{paciente}}! Le escribimos de {{organizacion}} para avisarle que su turno con {{profesional}} del {{fecha}} a las {{hora}} quedó reservado. Escríbanos por cualquier duda. Saludos!

### Recordatorio con confirmación

Sent 1 day before the appointment, with the buttons `Sí, voy` · `Necesito cambiarlo`.

> Hola {{paciente}}! Te escribimos de {{organizacion}} para recordarte tu turno con {{profesional}} del {{fecha}} a las {{hora}}. Por favor, confirmanos si venís o si necesitás cambiarlo.

In `usted`:

> Hola {{paciente}}! Le escribimos de {{organizacion}} para recordarle su turno con {{profesional}} del {{fecha}} a las {{hora}}. Por favor, confírmenos si viene o si necesita cambiarlo.

### Recordatorio

Sent 2 hours before the appointment; it asks nothing.

> Hola {{paciente}}! Te escribimos de {{organizacion}} para recordarte que tu turno con {{profesional}} es el {{fecha}} a las {{hora}}. Te esperamos!

In `usted`, which does not say `lo`/`la esperamos`, a guess at the patient's gender:

> Hola {{paciente}}! Le escribimos de {{organizacion}} para recordarle que su turno con {{profesional}} es el {{fecha}} a las {{hora}}. Hasta pronto!

### Seguimiento

Sent 1 day after the appointment, once it is marked attended. Of the set, the one
most likely to be moved to marketing: naming the medical service keeps it about one
appointment.

> Hola {{paciente}}! Te escribimos de {{organizacion}} para saber cómo te sentís después de tu {{prestacion}}.

In `usted`:

> Hola {{paciente}}! Le escribimos de {{organizacion}} para saber cómo se siente después de su {{prestacion}}.

## Event templates

Fixed, sent on their event, and never picked by a medical service. Each but
`reabrir_conversacion` invites a reply, and the assistant offers times in the
conversation, except for a cancelled appointment, as `turno_no_disponible` says.

### `turno_movido`

Sent when staff move an appointment, with the buttons `Sí, voy` · `Necesito cambiarlo`.

> Hola {{paciente}}! Te escribimos de {{organizacion}} para avisarte que tuvimos que mover tu turno con {{profesional}} al {{fecha}} a las {{hora}}. Por favor, confirmanos si venís o si necesitás cambiarlo.

In `usted`:

> Hola {{paciente}}! Le escribimos de {{organizacion}} para avisarle que tuvimos que mover su turno con {{profesional}} al {{fecha}} a las {{hora}}. Por favor, confírmenos si viene o si necesita cambiarlo.

### `turno_no_disponible`

Sent when staff cancel an appointment, by the business, and when time off, a closure
or a schedule change leaves it outside working time, unless whoever entered the time
off or the closure chose not to tell the patients. A reply is routed by the
appointment's state: for one on the "to reschedule" list the assistant offers times;
for a cancelled one, until booking arrives in the second release, a reply asking for
another time is handed off.

> Hola {{paciente}}! Te escribimos de {{organizacion}} para avisarte que lamentablemente {{profesional}} no va a poder atenderte el {{fecha}} a las {{hora}}. Por favor, escribinos si querés sacar un turno nuevo.

In `usted`:

> Hola {{paciente}}! Le escribimos de {{organizacion}} para avisarle que lamentablemente {{profesional}} no va a poder atender su turno del {{fecha}} a las {{hora}}. Por favor, escríbanos si quiere sacar un turno nuevo.

### `solicitud_no_confirmada`

Sent when a request is rejected or expires. Requests come with booking, in the
second release.

> Hola {{paciente}}! Te escribimos de {{organizacion}} para avisarte que lamentablemente no pudimos confirmar el turno que pediste con {{profesional}} para el {{fecha}}. Por favor, escribinos si querés buscar otro horario.

In `usted`:

> Hola {{paciente}}! Le escribimos de {{organizacion}} para avisarle que lamentablemente no pudimos confirmar el turno que pidió con {{profesional}} para el {{fecha}}. Por favor, escríbanos si quiere buscar otro horario.

### `reabrir_conversacion`

Sent when a person replies after the conversation window closed, with the button
`Ver respuesta`. Their reply is delivered once the patient answers this
([assistant.md](../domain/assistant.md#handoff)).

> Hola {{paciente}}! Te escribimos de {{organizacion}} porque tenemos una respuesta para vos. Respondé este mensaje para verla.

In `usted`:

> Hola {{paciente}}! Le escribimos de {{organizacion}} porque tenemos una respuesta para usted. Responda este mensaje para verla.
