# Appointments

## Medical services

Each practitioner offers medical services. A medical service sets the default duration, which
the booking can change, and the patient messages for its appointments
([messages.md](./messages.md)): the booking confirmation, the reminders, and how
late the patient may reschedule.

Admins, and each practitioner for their own, manage medical services: a name, a
default duration, a colour, and the message settings. A medical service in use is
deactivated, never deleted.

Appointments are booked one at a time. A series, such as monthly orthodontic
check-ups, is booked one appointment after the other.

## Booking

Reception books from a free time clicked on the calendar, which fills in the
practitioner, time and room, or from `Nuevo turno`: patient, practitioner and
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

## Overlaps and overbooking

A practitioner cannot have two active appointments at the same time. The exception
is an overbooking, which only staff book, and only on purpose: on top of another
appointment or outside the practitioner's schedules. Argentine practices squeeze
patients in daily, and forbidding it would push reception back to paper.

An overbooking shows differently on the schedule and never appears to patients as
free time.

## Calendar

Reception's main screen is a day view of one office, one column per practitioner.
A week view of one practitioner answers "when can she come next week". A
practitioner gets the same two views limited to their own appointments. There is
no month view: at 30-minute granularity it is unreadable.

Each column is a stack of 30-minute cells, with the times on the left axis. A cell
wholly free (inside a schedule, clear of appointments, time off and closures) is
white, and clicking it books at its start; every other cell is grey, a cell only
partly free included. Appointments are cards drawn over the cells at their time,
side by side when they overlap.

An appointment card is coloured by its medical service, which is what reception
scans for. Its status is an icon and a style: booked outlined, confirmed solid,
checked in highlighted, attended dimmed. A no-show or cancelled appointment leaves
its time free: it is not drawn unless asked for, and then only faded, never hiding
or blocking the white cell under it. An overbooking has its own mark.

## Patient history

A patient's page lists their past and upcoming appointments with statuses,
cancellations and no-shows included: "missed the last three" is what reception
needs to know when booking. A practitioner sees only the appointments with
themselves.
