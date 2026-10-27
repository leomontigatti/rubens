# Scheduling

## Rooms

A room's capacity is how many practitioners can use it at the same moment, 1
unless set otherwise. "Shared" is not a kind of room: a room is shared by giving
several practitioners schedules in it at different times. A capacity above 1
covers the rare room two practitioners really use together.

## Schedules

A practitioner works in weekly schedules, each tied to one room of one office and
valid between two dates. Saving a schedule fails if, on any date it applies, the
room would hold more practitioners than its capacity. The room is settled when the
schedule is saved, not each time an appointment is booked.

An appointment takes the room of the schedule it falls in. Reception can move it
to another room that is free at that time.

## Time off and closures

Time off belongs to one practitioner; a closure to one office or the whole
organization. Admins enter both by hand, and so does a practitioner for their own
time off.

When time off, a closure, or a schedule change leaves booked appointments outside
working time, those appointments go on reception's "to reschedule" list. Nothing
is cancelled on its own: someone has to talk to each patient.

## Availability

Availability is computed, never entered: a practitioner's schedules expanded
inside a bounded window, minus their time off, closures, and the appointments
already booked. Overbookings are left out of it, so they never show as free.
