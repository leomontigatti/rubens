# Rubens

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
every `practitioner`. A receptionist never reads clinical content.
_Avoid_: secretary, front desk, staff

**`practitioner`** — ui: "Profesional"
A health professional who works in exactly one `organization`. A practitioner who
keeps clinical records writes `clinicalNote`s; today every practitioner does.
_Avoid_: doctor, dentist, provider, staff, medic

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
or a check-up. It sets the default duration and colour of its `appointment`s and,
later, their patient messages.
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
Where an `appointment` stands: `booked` ("Reservado"), `confirmed` ("Confirmado"),
`checkedIn` ("En sala"), `attended` ("Atendido"), `noShow` ("Ausente") or
`cancelled` ("Cancelado").
_Avoid_: pending, done, missed, arrived

**`receptionNote`** — ui: "Nota de recepción"
A short practical note on an `appointment` for staff, such as `trae
radiografías`. Never clinical.
_Avoid_: comment, observation, reason, motivo

**`toReschedule`** — ui: "Turnos a reprogramar"
The `appointment`s a new `timeOff`, `closure` or `schedule` change left outside
working time, listed for reception to move. They are never cancelled on their own.
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
the patient's contact for messages and signs their `consentForm`s.
_Avoid_: tutor, parent, contact person

**`whatsappConsent`** — ui: "Acepta WhatsApp"
Whether a `patient` may be messaged by WhatsApp. It is on from registration and is
turned off only when the patient asks.
_Avoid_: opt-in, subscription

## Messages

**`reminder`** — ui: "Recordatorio"
A message to a `patient` some time before an `appointment`, as its
`medicalService` sets. A reminder can ask the patient to confirm.
_Avoid_: notification, alert

**`bookingConfirmation`** — ui: "Confirmación de turno"
The message a `patient` gets when an `appointment` is booked.
_Avoid_: receipt, booking notification

**`rescheduleLink`** — ui: "Reprogramar turno"
A personal link, sent from a `reminder`, where a `patient` can move or cancel one
`appointment` or ask to be contacted.
_Avoid_: magic link, booking page, portal

**`contactRequest`** — ui: "Necesito que se comuniquen conmigo"
A patient's request, made from a `rescheduleLink`, that reception call them.
_Avoid_: callback, call me

**`notification`** — ui: "Notificación"
An event shown to staff in the app, such as a cancellation. Telegram and WhatsApp
copies of it are extra deliveries of the same notification.
_Avoid_: alert, message, inbox item

## Clinical records

**`clinicalRecord`** — ui: "Historia clínica"
The clinical history of one `patient` in an `organization`: their signed
`clinicalNote`s, `addendum`s and `attachment`s, readable by every practitioner who
keeps clinical records.
_Avoid_: medical record, HC, ficha, chart

**`clinicalNote`** — ui: "Evolución"
One entry in a `clinicalRecord`, written by one `practitioner` and optionally tied
to an `appointment`. It is a draft until its author signs it, and never changes
after that.
_Avoid_: note, `nota`, progress note, entry

**`addendum`** — ui: "Adenda"
A signed correction or addition to a signed `clinicalNote`, shown next to it. The
original stays as it was.
_Avoid_: edit, version, amendment

**`medicalAlert`** — ui: "Alerta médica"
An allergy or condition a `practitioner` must know before treating a `patient`,
such as an allergy to penicillin, shown at the top of the `clinicalRecord`.
_Avoid_: allergy, warning, flag

**`attachment`** — ui: "Adjunto"
A file in a `clinicalRecord`, such as an X-ray, a photo or a scanned
`consentForm`.
_Avoid_: document, upload, file

**`consentForm`** — ui: "Consentimiento informado"
A signed informed-consent document, kept as an `attachment` with who signed it:
the `patient` or a `guardian`.
_Avoid_: consent, waiver

**`clinicalRecordCopy`** — ui: "Copia de historia clínica"
A PDF of a `clinicalRecord` handed to a `patient` who asks for it.
_Avoid_: export, report, printout
