# Messages

## To patients

Messages go by WhatsApp to patients with WhatsApp consent, and by email otherwise.
A patient with neither gets none. The text comes from templates Meta approves, so
a medical service picks a template; it does not write free text. The templates
are in [whatsapp-templates.md](../operations/whatsapp-templates.md).

Each medical service sets:

- **The booking confirmation**, sent when the appointment is booked, or not at all.
- **Its reminders**: each one a time before the appointment (such as 48 h and
  2 h), and whether it asks the patient to confirm. A reminder whose send time has
  already passed when the appointment is booked is skipped, not sent late.
- **The reschedule cutoff**: how long before the appointment the patient can still
  reschedule it themselves.

A reminder that asks for confirmation offers three answers:

- **Confirm** sets the appointment to confirmed.
- **Cancel** cancels it, by the patient, and frees the time.
- **Reschedule** replies with the appointment's reschedule link.

## The reschedule link

A personal, signed link for one appointment, valid until the appointment starts.
Its page shows the free times of the same practitioner and medical service, at
any office where the practitioner works, over the next few weeks. On it the
patient can:

- **pick a new time**, which moves the appointment and frees the old time;
- **cancel** the appointment, when no time suits them;
- **ask to be contacted** (`Necesito que se comuniquen conmigo`), which gives
  reception a contact request.

Moving is allowed until the medical service's cutoff, and once per appointment. Later changes
go through reception. The cutoff leaves time to fill a freed slot; the once-only
rule stops a patient from pushing an appointment back forever. Cancelling and
asking for contact stay open until the appointment starts.

## To staff

Every event that staff act on is a notification in the app, read or unread:
confirmations, cancellations, reschedules, contact requests, and replies that look
like opt-outs. Reception sees all of them; a practitioner sees those about their
own appointments. The app holds the full record, so a failed external delivery
loses nothing.

A practitioner can link Telegram from their profile, through the bot's start link.
They then get a Telegram copy of every cancellation and reschedule of their
appointments, whoever made it: the patient, reception or a closure. They can mute
it, or limit it to appointments in the next few days. The copy carries only the
patient's name and the old and new times: Telegram is a third party, and a dental
appointment is health data (Ley 25.326), so it gets the minimum.

Every message, to patients or staff, is queued in the same transaction that
changes the appointment.
