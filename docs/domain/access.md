# Access

Three roles, and a member can hold any combination of them: admin, receptionist
and practitioner.

- **Staff accounts are created by an admin**, with a starting password the member
  must replace at their first sign-in; the first admin comes from the setup
  script. There are no invitations, now or later, and no public sign-up.
- **An admin changes roles, and deactivates a member** who left: deactivation
  ends their open sessions and refuses their sign-in, and deletes nothing. The
  last active admin can neither lose the role nor be deactivated.

| Who          | Schedules      | Appointments | Patients | Clinical records     |
| ------------ | -------------- | ------------ | -------- | -------------------- |
| Admin        | edit all       | all          | all      | copies, voided files |
| Receptionist | read           | all          | all      | no                   |
| Practitioner | edit their own | their own    | all      | see below            |

- **Clinical records** are readable by every practitioner who keeps clinical
  records, for every patient of the organization. Patients move between
  practitioners (a general dentist and an orthodontist), and Ley 26.529 makes the
  institution the custodian of the record. Every read is written to the audit log.
- **Receptionists never see clinical content.** The admin role alone grants no
  reading in the app either: an admin can only produce a patient's copy of their record
  ([clinical-records.md](./clinical-records.md#copies-for-the-patient)), which is
  audited, and delete a file a practitioner voided, seeing its name and the reason
  but not its content. A practitioner who is also the admin reads records as a practitioner.
- **A practitioner sees only their own appointments.** An appointment already says
  something about a patient's health, so the schedule shows no more than the work
  needs. The room view, open to all staff, shows who holds each room and when,
  without patient names.
- **Schedules** are edited by admins and by each practitioner for their own,
  so reception cannot change a practitioner's hours behind their back.
