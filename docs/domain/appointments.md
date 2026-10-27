# Appointments

## Types

Each practitioner offers appointment types. A type sets the default duration, which
the booking can change, and the patient messages for its appointments
([messages.md](./messages.md)): the booking confirmation, the reminders, and how
late the patient may reschedule.

Appointments are booked one at a time. A series, such as monthly orthodontic
check-ups, is booked one appointment after the other.

## Statuses

```
booked ──► confirmed ──► checkedIn ──► attended
   │           │
   └───────────┴──► noShow | cancelled
```

- **Confirmed**: the patient confirmed, from a reminder or by phone to reception.
- **Checked in**: reception marked the patient as arrived.
- **No-show** is marked by hand; nothing marks it on its own.
- **Cancelled** records who cancelled: the patient or the business.

## Rescheduling

Rescheduling moves the same appointment to a new time, room or office. The audit
log keeps the previous values; it is not a cancellation plus a new appointment.

## Overlaps and overbooking

A practitioner cannot have two active appointments at the same time. The exception
is an overbooking, which only staff book, and only on purpose: on top of another
appointment or outside the practitioner's schedules. Argentine practices squeeze
patients in daily, and forbidding it would push reception back to paper.

An overbooking shows differently on the schedule and never appears to patients as
free time.
