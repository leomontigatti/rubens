# WhatsApp templates

The message templates submitted to Meta for approval, in the business's WhatsApp
Business account. All are in the `utility` category, language `es_AR`. The code
refers to a template by its name, so a name never changes once approved; new
wording under the same purpose is a new template. The rules for when each is
sent are in [docs/domain/messages.md](../domain/messages.md).

Status: drafts, not yet submitted. The business owner may adjust the wording
before submitting.

## `confirmacion_turno`

Sent when an appointment is booked, if its type asks for it.

> Hola {{1}}, tu turno con {{2}} quedó reservado para el {{3}} a las {{4}} en {{5}} ({{6}}). Si necesitás cambiarlo, comunicate con nosotros.

`{{1}}` patient's first name, `{{2}}` practitioner, `{{3}}` date, `{{4}}` time,
`{{5}}` office, `{{6}}` address.

## `recordatorio_turno`

A reminder that asks for confirmation. Three quick-reply buttons.

> Hola {{1}}, te recordamos tu turno con {{2}} el {{3}} a las {{4}} en {{5}}. ¿Nos confirmás tu asistencia?
>
> [Confirmo] [Cancelar turno] [Reprogramar]

## `recordatorio_turno_sin_confirmacion`

A reminder that asks nothing, such as one two hours before.

> Hola {{1}}, te esperamos hoy a las {{2}} con {{3}} en {{4}} ({{5}}).

## `reprogramar_turno`

The reschedule link, sent when the patient taps "Reprogramar". It is a template
rather than a free-form reply so it can also be sent outside the 24-hour window
that opens when the patient writes.

> Podés elegir un nuevo horario para tu turno con {{1}} desde el siguiente enlace. Es personal y vence al comienzo del turno.
>
> [Elegir nuevo horario] → `https://<domain>/r/{{1}}`

The button's base URL is fixed at approval, so the production domain must be
chosen before this one is submitted.
