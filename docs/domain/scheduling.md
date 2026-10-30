# Scheduling

## Rooms

A room's capacity is how many practitioners can use it at the same moment, 1
unless set otherwise. "Shared" is not a kind of room: a room is shared by giving
several practitioners schedules in it at different times. A capacity above 1
covers the rare room two practitioners really use together.

## Schedules

A practitioner works in weekly schedules. A schedule is one or more weekdays, a
start and an end time, one room of one office, a first date and an optional last
date. A break is two schedules on the same day (9 to 13 and 14 to 18). The screen
is weekly only; alternate weeks can come later without a new model.

Offices have no opening hours of their own: schedules are the only working time,
and a closure covers a day an office is shut.

Saving a schedule fails if, on any date it applies, the
room would hold more practitioners than its capacity, counting the schedules in it
and the future appointments other practitioners have there (overbookings and room
moves place appointments outside schedules). The room is settled when the
schedule is saved, not each time an appointment is booked.

A change to a schedule takes effect from a date the user picks: the old schedule
ends the day before and a new one starts, so past weeks are never rewritten. A
schedule that has not started yet is edited in place.

An appointment takes the room of the schedule it falls in. Reception can move it
to another room that is free at that time.

## Time off and closures

Time off belongs to one practitioner; a closure to one office or the whole
organization. Both are ranges of time, with a whole-day shortcut for the usual
case, so "Friday from 14:00" is a closure too. Admins enter closures; time off is
entered by an admin or by the practitioner it belongs to.

When time off, a closure, or a schedule change leaves booked appointments outside
working time, those appointments go on reception's "to reschedule" list. Nothing
is cancelled on its own: someone has to talk to each patient.

## Availability

Availability is computed, never entered: a practitioner's schedules expanded
inside the window being viewed, minus their time off, closures, and the
appointments already booked. Overbookings are left out of it, so they never show
as free.

Free times start on a grid, every 30 minutes unless the practitioner's grid is set
otherwise, whatever the medical service's duration. The grid keeps start times
tidy and stable as appointments come and go; it does not limit an appointment's
length, and an overbooking may start off the grid.

Staff can book any date ahead. Only the patient's reschedule page shows a limited
window.
