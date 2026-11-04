# WhatsApp fixed texts

The fixed text of each message the organization starts. The assistant words these
messages itself, from the same facts; a fixed text goes out when its wording lacks
a fact or the model is unavailable
([messages.md](../domain/messages.md#to-patients)). The rules for when each is
sent are in the same file.

Nobody approves these texts: they are Rubens' own, sent through the organization's
number ([ADR-0006](../adr/0006-patient-assistant-on-whatsapp.md)). Communication
rules do not apply to them, so they are written plainly. None has buttons: the
patient answers in their own words, and the assistant reads the answer.

The code refers to a text by its name. Placeholders are in braces.

Status: drafts. The business owner may adjust the wording.

## `confirmacion_turno`

Sent when an appointment is booked, or a request approved, if its medical service
asks for it. It asks the patient to save the number.

> Hola {paciente}, tu turno con {profesional} quedó reservado para el {fecha} a las {hora} en {sede} ({direccion}). Agendá este número para recibir los recordatorios. Si necesitás cambiarlo, escribinos por acá.

## `recordatorio_turno`

A reminder that asks for confirmation.

> Hola {paciente}, te recordamos tu turno con {profesional} el {fecha} a las {hora} en {sede}. ¿Nos confirmás tu asistencia? Si necesitás cancelarlo o cambiarlo, respondé este mensaje.

## `recordatorio_turno_sin_confirmacion`

A reminder that asks nothing, such as one two hours before.

> Hola {paciente}, te esperamos hoy a las {hora} con {profesional} en {sede} ({direccion}).

## `turno_movido`

Sent when staff move an appointment.

> Hola {paciente}, tuvimos que mover tu turno con {profesional}: ahora es el {fecha} a las {hora} en {sede}. Si no te queda bien, respondé este mensaje y lo vemos.

## `turno_cancelado`

Sent when staff cancel an appointment, by the business.

> Hola {paciente}, tuvimos que cancelar tu turno con {profesional} del {fecha} a las {hora}. Disculpá las molestias. Si querés otro turno, respondé este mensaje.

## `turno_a_reprogramar`

Sent when time off or a closure leaves the appointment outside working time, if
whoever entered it chose to tell the patients.

> Hola {paciente}, {profesional} no va a poder atenderte el {fecha} a las {hora}. Podés elegir otro horario desde este enlace: {enlace}, o respondé este mensaje y te ayudamos.

## `solicitud_no_confirmada`

Sent when a request is rejected or expires.

> Hola {paciente}, no pudimos confirmar el turno que pediste con {profesional} para el {fecha}. Respondé este mensaje y te ayudamos a buscar otro horario.

## `indicaciones`

A medical service's care instructions, sent when the appointment is marked
attended. `{indicaciones}` is the medical service's text, sent whole; the
assistant does not reword it.

> Hola {paciente}, te dejamos las indicaciones de {profesional} para después de tu turno: {indicaciones}

## `seguimiento`

A medical service's follow-up.

> Hola {paciente}, ¿cómo te sentís después de tu turno con {profesional}? Contanos por acá.
