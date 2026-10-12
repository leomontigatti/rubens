# Rubens

The domain vocabulary of a booking app for a health care business: offices, rooms,
practitioners, receptionists, patients and their appointments. Each entry is the
canonical English identifier, the name to use in code, followed by `ui:`, the
Spanish term the user sees. How to read it is in
[docs/agents/coding-standards.md](docs/agents/coding-standards.md#code-language).
The detailed rules live in [docs/domain/](docs/domain/).

## Tenancy

**`organization`** — ui: "Organización"
The business that owns everything in the app. Every tenant-owned row carries its
organization, and row-level security enforces the boundary.
_Avoid_: tenant, account, clinic

**`practitioner`** — ui: "Profesional"
A health professional who works in exactly one `organization`. Some practitioners
keep a `clinicalRecord` for their patients, depending on their specialty.
_Avoid_: doctor, provider, staff, medic

**`receptionist`** — ui: "Recepcionista"
A person who books and moves `appointment`s for the practitioners of an
`organization`. A receptionist cannot read `clinicalNote`s.
_Avoid_: secretary, front desk, staff

## Places

**`office`** — ui: "Sede"
A physical location of the business, with its own IANA time zone. Its times are
derived from that zone; instants are stored in UTC.
_Avoid_: branch, clinic, site

**`room`** — ui: "Consultorio"
A room inside an `office` where a `practitioner` sees a `patient`. A room is
shared or exclusive. A shared room has a capacity.
_Avoid_: box, cubicle, chair

**`roomBlock`** — ui: "Bloque de consultorio"
A practitioner's hold on a `room` for a time range, such as "room 2, Monday 9 to
13". `appointment`s fall inside a block. Blocks are what keep a shared room from
being double-booked.
_Avoid_: reservation, room booking, slot

## Booking

**`appointment`** — ui: "Turno"
A `patient`'s booked time with one `practitioner`, in one `room`. Its time is a
`tstzrange`, and a practitioner cannot have two overlapping active appointments.
_Avoid_: booking, cita, reservation, event

**`patient`** — ui: "Paciente"
The person a `practitioner` sees. A patient is an identity inside one `organization`,
with contact details kept as personal data.
_Avoid_: client, customer, cliente, user

**`schedule`** — ui: "Agenda"
A recurring working time of a `practitioner` or a `room` in an `office`, written as
an RRULE plus exceptions. It is the source of `availability`, not a list of bookings.
_Avoid_: calendar, timetable

**`availability`** — ui: "Disponibilidad"
The concrete slots that can still be booked, expanded from `schedule`s inside a
bounded window and net of `appointment`s and `roomBlock`s.
_Avoid_: free time, open slots, vacancies

## Clinical records

**`clinicalRecord`** — ui: "Historia clínica"
The clinical history of one `patient` kept by one `practitioner`, for practitioners
whose specialty keeps one. Its notes are the record.
_Avoid_: medical record, HC, ficha, chart

**`clinicalNote`** — ui: "Evolución"
One entry in a `clinicalRecord`. A note is never updated or deleted: a correction
is a new version that supersedes the old one, and the old one stays in the record.
_Avoid_: note, nota, progress note, entry
