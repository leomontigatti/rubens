# Appointments

## Medical services

Each practitioner offers medical services. A medical service sets the default duration, which
the booking can change, and the patient messages for its appointments
([messages.md](./messages.md)): the booking confirmation, the reminders, and how
late the patient may reschedule.

Admins, and each practitioner for their own, manage medical services: a name, a
default duration and the message settings. A medical service in use is
deactivated, never deleted.

Appointments are booked one at a time. A series, such as monthly orthodontic
check-ups, is booked one appointment after the other.

## Booking

Reception books from a free cell clicked on the calendar, which fills in the
time and room, and the practitioner when only one is free there (otherwise the
form asks which of those free), or from `Nuevo turno`: patient, practitioner and
medical service, then the free times for that service's duration. The service comes
before the time because its duration decides which times fit; the duration can
still be adjusted. The patient is found with the search box, or registered on
the spot with the quick registration.

An appointment takes the room of the schedule it falls in. Reception can move it
to another room only if that room has space at that time: its capacity, counted
against other practitioners' schedules and appointments there. An overbooking
outside the practitioner's schedules needs a room picked explicitly, under the
same rule. So a room never holds more practitioners than its capacity, for
appointments as for schedules.

Practitioners can share a room, but never at once: while one practitioner holds
an appointment there, no other practitioner can book, overbook or move an
appointment into that time, and their cells there turn grey. Only the
appointment's own practitioner can add an overbooking over it, or reception on
their behalf. The database enforces it (`appointment_room_overlap`), so two
bookings racing for a shared room's time cannot both win.

Booking warns, without blocking, when the patient already has an appointment that
overlaps, or one the same day with another practitioner: back-to-back visits with
two practitioners are legitimate; booking the same person twice is the mistake.

An appointment can carry a short reception note (`trae radiografías`), read by
every staff member who sees the appointment, and edited later by whoever can book
it. Clinical information goes in the
clinical record, and the form says so; without a note field, such notes end up in
the patient's name.

## Statuses

```
booked ──► confirmed ──► checkedIn ──► attended
   │           │
   └───────────┴──► noShow | cancelled
```

- **Confirmed**: the patient confirmed, from a reminder or by phone to reception.
- **Checked in**: reception marked the patient as arrived.
- **Attended**: marked by the practitioner or reception.
- **No-show** is marked by reception by hand, and only after the start time.
- **Cancelled** records who cancelled, the patient or the business, and an
  optional reason. Anyone who can book can cancel, and the time is free at once.

A status set by mistake can be undone the same day. The audit log keeps both
changes; a busy front desk will make mistakes, and forbidding the undo only
breeds workarounds. Undoing a cancellation or a no-show brings the appointment back
only if its time and its room still have space.

## Rescheduling

Rescheduling moves the same appointment to a new time, room or office. The audit
log keeps the previous values; it is not a cancellation plus a new appointment.
Staff reschedule through the free-times picker; there is no drag and drop in the
first version.

The "to reschedule" list is computed, never stored: every future booked or
confirmed appointment that now falls outside working time, outside the
practitioner's schedules or inside their time off or a closure. An appointment
leaves it when it is moved or cancelled. Overbookings are left out, being outside
working time on purpose. Reception sees the list with a count in the menu.

Deactivating a practitioner or a patient sends every future booked or confirmed
appointment of theirs to the list, overbookings included, and the admin is told how
many before confirming. Those appointments can only be cancelled from it: a
rescheduled one keeps its practitioner and patient, so it would be refused or stay
on the list. Reactivating the person takes them off it.

## Overlaps and overbooking

A practitioner cannot have two active appointments at the same time. The exception
is an overbooking, which only staff book, and only on purpose: on top of another
appointment or outside the practitioner's schedules. Argentine practices squeeze
patients in daily, and forbidding it would push reception back to paper.

An overbooking shows differently on the schedule and never appears to patients as
free time.

## Calendar

The calendar is one week of one room, Monday to Sunday, in the room's office's
zone, with the previous and next week and a date to jump to. It is filtered in
this order: the room, required, from the active rooms grouped by office and
opening on the first; then a practitioner, optional; then a medical service,
optional, from the chosen practitioner's active ones or all of them, which
implies its practitioner. The practitioners to filter by are those with a
schedule or an appointment in the room that week; a filter the room's week
cannot take (a deactivated medical service, a practitioner with nothing there)
is ignored, never refused. Its columns are the days; there are no columns per
practitioner, and no day or month view.

Each day is a stack of 30-minute cells, with the times on the left. A cell is
white when at least one practitioner who matches the filters and has a schedule
in the room is free for the whole cell, starting on their own grid; with a
medical service filtered, when its duration fits from that start. Every other
cell is grey. Clicking a white cell books there, with the medical service filled
in when it is filtered.

Appointments are cards that never overlap: those at the same time (a
practitioner's overbookings, cancelled or no-show ones when shown) sit side by side, and
beside a white cell they meet, so its click stays reachable. A medical service
filter narrows the cards to it. An appointment across midnight shows on both
days. A card
shows its practitioner's colour, which is what reception scans for and is chosen
in the practitioner's staff settings, the time, the patient, the medical service
and the status as an icon only. An overbooking is dashed and has its own mark.
A no-show or cancelled appointment leaves its time free and bookable for every
role: it is not drawn unless asked for, and then faded in its own lane, and
opening it allows an undo.

A practitioner sees their own appointments in full and books only for
themself. Other practitioners' appointments in the room show as grey
blocks across the day's width (two that overlap share it) with their time and practitioner (`09:30 Pablo
Ríos`), nothing about the patient, and
cut to the practitioner's own working hours in the room: the
server sends no others. A block covers its cells, white ones included.

## Patient history

A patient's page lists their past and upcoming appointments with statuses,
cancellations and no-shows included: "missed the last three" is what reception
needs to know when booking. A practitioner sees only the appointments with
themselves.
