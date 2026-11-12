# underthing

The domain vocabulary of a booking app for a health care business: offices, rooms,
practitioners, receptionists, patients and their appointments. Each entry is the
canonical English identifier, the name to use in code, followed by `ui:`, the
Spanish term the user sees. How to read it is in
[docs/agents/coding-standards.md](docs/agents/coding-standards.md#code-language).
The detailed rules live in [docs/domain/](docs/domain/).

## People

**`organization`** — ui: "Organización"
The business that owns everything in the app. Every tenant-owned row carries its
organization, and row-level security enforces the boundary.
_Avoid_: tenant, account, clinic

**`admin`** — ui: "Administrador"
A member who configures the `organization`: its `office`s, `room`s, staff and
`medicalService`s. The first admin is the owner; there is no separate owner role.
_Avoid_: owner, manager, superuser

**`receptionist`** — ui: "Recepcionista"
A member who books and moves `appointment`s and keeps the `patient` registry for
every `practitioner`. A receptionist reads every WhatsApp conversation, and never a
`clinicalRecord`.
_Avoid_: secretary, front desk, staff

**`practitioner`** — ui: "Profesional"
A health professional who works in exactly one `organization`. A practitioner who
keeps clinical records writes `clinicalNote`s; today every practitioner does. Their
`appointment`s are drawn in their own colour on the calendar.
_Avoid_: doctor, dentist, provider, staff, medic

**`licenseNumber`** — ui: "Matrícula"
A `practitioner`'s professional licence number, shown next to their name on their
`clinicalNote`s.
_Avoid_: registration, MP, MN

A member can hold several of these roles at once, such as a practitioner who is
also the admin.

## Places

**`office`** — ui: "Sede"
A physical location of the business, with its own IANA time zone. Its times are
derived from that zone; instants are stored in UTC.
_Avoid_: branch, clinic, site

**`room`** — ui: "Consultorio"
A room inside an `office` where a `practitioner` sees a `patient`. Its capacity is
how many practitioners can use it at the same moment, 1 unless set otherwise.
_Avoid_: box, cubicle, chair, shared room, exclusive room

## Scheduling

**`schedule`** — ui: "Horario"
A practitioner's weekly hold on one `room` of one `office`, such as Monday 9 to
13 in room 2, valid between two dates. A room is shared by giving several
practitioners schedules in it at different times.
_Avoid_: room block, calendar, timetable, agenda

**`timeOff`** — ui: "Licencia"
A one-off range when a `practitioner` does not work, such as a vacation or an
illness, overriding their `schedule`s.
_Avoid_: absence, leave, exception, vacation

**`closure`** — ui: "Cierre"
A one-off range when an `office`, or the whole `organization`, is closed, such as a
national holiday.
_Avoid_: holiday, exception, blackout

**`availability`** — ui: "Disponibilidad"
The concrete free times that can still be booked: `schedule`s expanded inside a
bounded window, minus `timeOff`, `closure`s and booked `appointment`s.
_Avoid_: free time, open slots, vacancies

## Booking

**`medicalService`** — ui: "Prestación"
The kind of visit or practice a `practitioner` offers, such as a first consultation
or a check-up. It sets the default duration and the price of its `appointment`s,
and picks the `template`s they get.
_Avoid_: service, visit type, event type, appointment type

**`appointment`** — ui: "Turno"
A `patient`'s booked time with one `practitioner`, in one `room`, of one
`medicalService`. Rescheduling moves the same appointment.
_Avoid_: booking, cita, reservation, event

**`overbooking`** — ui: "Sobreturno"
An `appointment` booked on purpose over another of the same `practitioner`, or
outside their `schedule`s. Only staff book one, and patients never see one.
_Avoid_: double booking, extra appointment

**`appointmentStatus`** — ui: "Estado"
Where an `appointment` stands: `requested` ("Solicitado"), `booked` ("Reservado"), `confirmed` ("Confirmado"),
`checkedIn` ("En sala"), `attended` ("Atendido"), `noShow` ("Ausente") or
`cancelled` ("Cancelado").
_Avoid_: pending, done, missed, arrived

**`receptionNote`** — ui: "Nota de recepción"
A short practical note on an `appointment` for staff, such as `trae
radiografías`. Never clinical.
_Avoid_: comment, observation, reason, motivo

**`toReschedule`** — ui: "Turnos a reprogramar"
The `appointment`s a new `timeOff`, `closure` or `schedule` change left outside
working time, those of a deactivated `practitioner` or `patient`, and those in a
deactivated `room` or `office`, listed for reception to move or cancel. They are
never cancelled on their own.
_Avoid_: conflicts, affected appointments

## Patients

**`patient`** — ui: "Paciente"
A person the `practitioner`s of an `organization` see, in one registry shared by
the whole organization. A patient is deactivated, never deleted.
_Avoid_: client, customer, cliente, user

**`chosenName`** — ui: "Nombre autopercibido"
The name a `patient` chooses to be called by, shown in place of the legal name
wherever the app names them.
_Avoid_: nickname, alias, preferred name

**`incompletePatient`** — ui: "Datos incompletos"
A `patient` registered with only a name and a phone, missing at least their birth
date, to be completed at the first visit.
_Avoid_: draft patient, pending patient, quick patient

**`coverage`** — ui: "Cobertura"
A `patient`'s membership of an `insurer`: the insurer, a plan and a member number.
A patient with none is private ("Particular").
_Avoid_: insurance, `obra social`, `prepaga`, plan

**`insurer`** — ui: "Obra social / prepaga"
An `obra social` or `prepaga` on the `organization`'s list, which an admin keeps.
_Avoid_: insurance company, payer, provider

**`guardian`** — ui: "Responsable"
An adult responsible for a `patient`, usually a minor's parent. A guardian can be
the patient's contact for messages and signs a minor's `consentForm`s.
_Avoid_: tutor, parent, contact person

**`whatsappConsent`** — ui: "Acepta WhatsApp"
Whether a `patient` may be messaged by WhatsApp. It is on from registration and is
turned off only when the patient asks.
_Avoid_: opt-in, subscription

## Messages

**`template`** — ui: "Plantilla"
A message the `organization` starts, approved by Meta for its WhatsApp number and
filled with an `appointment`'s facts. An admin creates and names the organization's
own, each with its `templateTiming`, and a `medicalService` picks the ones its
appointments get; the five `eventTemplate`s are fixed.
_Avoid_: fixed text, canned message, HSM, message type

**`templateTiming`** — ui: "Cuándo se envía"
When a `template` goes: when its `appointment` is booked, when it is marked
attended, or a number of hours or days before or after it.
_Avoid_: schedule, delay, trigger

**`eventTemplate`** — no UI term (the list shows its event as its timing)
One of the five fixed `template`s sent when something happens to an `appointment`
or a conversation, such as staff moving the appointment. No `medicalService` picks it.
_Avoid_: system message, automatic template

**`reminder`** — ui: "Recordatorio"
A `template` timed before an `appointment`.
_Avoid_: notification, alert

**`bookingConfirmation`** — ui: "Confirmación de turno"
A `template` timed for when an `appointment` is booked.
_Avoid_: receipt, booking notification

**`rescheduleLink`** _(retired term)_ — no code identifier
A personal page to move or cancel one `appointment`, dropped on 2026-11-06: a
`patient` moves or cancels in the conversation with the `assistant`.

**`contactRequest`** _(retired term)_ — no code identifier
A patient's request to be called, made from the `rescheduleLink`; asking to be
contacted is now a `handoff`.

**`notification`** — ui: "Notificación"
An event shown to staff in the app, such as a cancellation. Telegram and WhatsApp
copies of it are extra deliveries of the same notification.
_Avoid_: alert, message, inbox item

**`careInstructions`** — ui: "Indicaciones"
What a `patient` should do before or after an `appointment`, written into the text
of the `template` that carries it.
_Avoid_: aftercare, post-op message

**`followUp`** — ui: "Seguimiento"
A `template` timed after an `appointment`, asking the `patient` how they feel.
_Avoid_: check-in, survey

## Assistant

**`assistant`** — ui: "Asistente"
The bot that answers `patient`s on the `organization`'s WhatsApp and
`practitioner`s on Telegram, acting only through accepted `proposal`s.
_Avoid_: chatbot, agent, AI

**`whatsappConnection`** — ui: "Conexión de WhatsApp"
The `organization`'s WhatsApp number on Meta's Cloud API, owned by the
`organization` and used only through underthing, through which the `assistant` and the
`organization`'s `template`s reach `patient`s.
_Avoid_: WhatsApp account, instance, session, channel

**`conversationWindow`** — ui: "Ventana de conversación"
The 24 hours after a `patient`'s last message, inside which the `assistant` and staff
write freely; outside it only a `template` can be sent. Meta calls it the customer
service window.
_Avoid_: session, 24-hour window

**`inbox`** — ui: "Conversaciones"
Every WhatsApp conversation of the `organization` in the app, where staff read them by
role and take one over from the `assistant`.
_Avoid_: chat, messages, handoff view

**`proposal`** — ui: "Propuesta"
A change the `assistant` states in full and a person accepts before it is made,
such as a new time for an `appointment`.
_Avoid_: suggestion, draft, pending action

**`handoff`** — ui: "Derivación"
A conversation the `assistant` passes to a person: to the `practitioner` for a
health question about what they treat, or an emergency (marked ui: `Clínica`);
otherwise to reception, which directs any other health question and can pass a
handoff to the practitioner (ui: `Pasar al profesional`). The assistant leaves its topic to that
person and keeps answering the rest. It is open until a person's reply reaches the
patient or a person closes it.
_Avoid_: escalation, transfer, takeover

**`heldReply`** — ui: "Respuesta retenida"
A reply of the `assistant` that the clinical check kept from the patient, because it
says something clinical or about another `patient`. It waits on a `handoff` to the
`practitioner`: a practitioner sends it or fixes it, and anyone who reads the
conversation drops it.
_Avoid_: draft, blocked message, pending reply

**`lateReply`** — ui: "Respuesta en espera"
A person's reply to a patient written after the conversation window closed. It waits
while the patient is asked, by a template, to answer, and goes as written once they
do; if they never do, its writer is told it was not delivered. Until the patient
answers, its writer may withdraw it (ui: "Retirar"), and it never goes.
_Avoid_: queued reply, heldReply, deferred message

**`handoffContact`** — ui: "Contacto de derivación"
A member an admin picks to receive the `handoff`s that concern no particular
`practitioner`.
_Avoid_: fallback agent, on-call

**`communicationRule`** — ui: "Regla de comunicación"
An instruction on how the `assistant` writes, set by an admin for the
`organization` or by a `practitioner` for their own conversations.
_Avoid_: prompt, instruction, style guide, training

**`replyExample`** — ui: "Ejemplo de respuesta"
A reply of the `assistant` that staff corrected or marked as good, which it
imitates.
_Avoid_: training data, sample, few-shot

## Clinical records

**`clinicalRecord`** — ui: "Historia clínica"
The clinical history of one `patient` in an `organization`: their `clinicalNote`s,
`attachment`s and `medicalAlert`s, readable by every practitioner who keeps
clinical records.
_Avoid_: medical record, HC, ficha, chart

**`clinicalNote`** — ui: "Evolución"
One entry in a `clinicalRecord`, written by one `practitioner` and optionally tied
to an `appointment`. Only its author edits it, and every earlier version stays in
the record.
_Avoid_: note, `nota`, progress note, entry, draft, addendum, `adenda`

**`medicalAlert`** — ui: "Alerta médica"
An allergy or condition a `practitioner` must know before treating a `patient`,
such as an allergy to penicillin, shown at the top of the `clinicalRecord`.
_Avoid_: allergy, warning, flag

**`attachment`** — ui: "Adjunto"
A file on a `clinicalNote`, such as an X-ray, a photo or a scanned `consentForm`.
_Avoid_: document, upload, file

**`consentForm`** — ui: "Consentimiento informado"
An informed-consent form signed on paper by the `patient` or a `guardian`, scanned
as an `attachment`. The practice keeps the paper.
_Avoid_: consent, waiver

**`clinicalRecordCopy`** — ui: "Copia de historia clínica"
A `clinicalRecord` handed to a `patient` who asks for it: a PDF of its notes with
the files attached to them.
_Avoid_: export, report, printout
