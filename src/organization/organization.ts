import type {
  AppointmentIdInput,
  AppointmentUpdate,
  BookingInput,
  CalendarWeekQuery,
  CancellationInput,
  OverbookingInput,
  RescheduleInput,
  StatusChangeInput,
  WarningConfirmation,
} from "#/lib/appointments.ts";
import type { AvailabilityQuery } from "#/lib/availability.ts";
import type {
  CoverageId,
  CoverageInput,
  CoverageUpdate,
  InsurerActiveChange,
  InsurerInput,
  InsurerUpdate,
} from "#/lib/coverages.ts";
import type {
  GuardianId,
  GuardianInput,
  GuardianUpdate,
  MessageContactChange,
} from "#/lib/guardians.ts";
import type {
  MedicalServiceActiveChange,
  MedicalServiceInput,
  MedicalServiceUpdate,
} from "#/lib/medical-services.ts";
import type {
  ActiveChange,
  OfficeInput,
  OfficeUpdate,
  PlaceReference,
  RoomInput,
  RoomUpdate,
} from "#/lib/offices.ts";
import type {
  ScheduleChange,
  ScheduleDelete,
  ScheduleEnd,
  ScheduleInput,
} from "#/lib/schedules.ts";
import type {
  MemberActiveChange,
  MemberReference,
  MemberUpdate,
  StaffInput,
  StartingPasswordChange,
} from "#/lib/staff.ts";
import type {
  DuplicateConfirmation,
  PatientActiveChange,
  PatientInput,
  PatientReference,
  PatientUpdate,
  WhatsappConsentChange,
  OptOutDecision,
} from "#/lib/patients.ts";
import type { ConversationListOptions, ConversationReference } from "#/lib/whatsapp-messages.ts";
import type { NotificationReference } from "#/lib/notifications.ts";
import type {
  ClosureDelete,
  ClosureInput,
  ClosureUpdate,
  TimeOffDelete,
  TimeOffInput,
  TimeOffUpdate,
} from "#/lib/time-ranges.ts";

import {
  cancelAppointment,
  changeAppointmentStatus,
  getAppointment,
  rescheduleAppointment,
  undoAppointmentStatus,
  updateAppointment,
} from "#/organization/appointment-changes.ts";
import {
  bookAppointment,
  bookOverbooking,
  listPatientAppointments,
} from "#/organization/appointments.ts";
import { getAvailability, listAvailabilityPractitioners } from "#/organization/availability.ts";
import { getCalendarWeek } from "#/organization/calendar-week.ts";
import {
  createClosure,
  deleteClosure,
  listClosures,
  updateClosure,
} from "#/organization/closures.ts";
import {
  addCoverage,
  listCoverages,
  makeCoveragePrimary,
  removeCoverage,
  updateCoverage,
} from "#/organization/coverages.ts";
import {
  addGuardian,
  listGuardians,
  removeGuardian,
  setMessageContact,
  updateGuardian,
} from "#/organization/guardians.ts";
import {
  createInsurer,
  listInsurers,
  setInsurerActive,
  updateInsurer,
} from "#/organization/insurers.ts";
import type { InsurerListOptions } from "#/organization/insurers.ts";
import {
  createMedicalService,
  listMedicalServices,
  setMedicalServiceActive,
  updateMedicalService,
} from "#/organization/medical-services.ts";
import type { MedicalServiceListOptions } from "#/organization/medical-services.ts";
import {
  bookers,
  insertMember,
  listActiveMembers,
  medicalServiceEditors,
  patientEditors,
  setUpOrganization,
  viewerOf,
  workingTimeEditors,
} from "#/organization/members.ts";
import type { Caller, MemberInput } from "#/organization/members.ts";
import { OrganizationWhatsapp } from "#/organization/organization-whatsapp.ts";
import {
  createOffice,
  createRoom,
  getOffice,
  listOffices,
  setOfficeActive,
  setRoomActive,
  updateOffice,
  updateRoom,
} from "#/organization/offices.ts";
import type { ListOptions } from "#/organization/offices.ts";
import { getPatientHistory } from "#/organization/patient-history.ts";
import { searchPatients } from "#/organization/patient-search.ts";
import type { SearchOptions } from "#/organization/patient-search.ts";
import {
  getPatient,
  listPatients,
  registerPatient,
  setPatientActive,
  setWhatsappConsent,
  decideOptOut,
  updatePatient,
} from "#/organization/patients.ts";
import type { PatientListOptions } from "#/organization/patients.ts";
import { listSchedulePractitioners } from "#/organization/practitioners.ts";
import {
  changeSchedule,
  createSchedule,
  deleteSchedule,
  endSchedule,
  getPractitionerSchedules,
} from "#/organization/schedules.ts";
import {
  changeOwnPassword,
  createStaffMember,
  getStaffMember,
  listStaff,
  setMemberActive,
  setStartingPassword,
  setUpWithAccount,
  updateMember,
} from "#/organization/staff.ts";
import {
  createTimeOff,
  deleteTimeOff,
  listTimeOff,
  updateTimeOff,
} from "#/organization/time-off.ts";
import {
  countMemberUpcoming,
  countOfficeUpcoming,
  countPatientUpcoming,
  countRoomUpcoming,
  countToReschedule,
  listToReschedule,
} from "#/organization/to-reschedule.ts";
import { listConversations, readConversation } from "#/organization/inbox.ts";
import {
  countUnreadNotifications,
  listNotifications,
  markNotificationRead,
} from "#/organization/notifications.ts";

/**
 * One organization's data, in its own SQLite-backed Durable Object (ADR-0008):
 * the tenant boundary. The Worker reaches it only through the organization id
 * of a verified session (`src/server/caller.ts`), so nothing here can read or
 * write another organization's rows.
 *
 * One RPC method per operation the app performs. Each takes the caller and
 * the input, authorizes the caller against the member table, and returns a
 * result: a refusal is `{ ok: false, reason }`, never a throw. The logic lives
 * in one module per area beside this file; a method only names its
 * requirement and calls it. The object runs one event at a time, and a
 * module's checks and writes are synchronous, so a check holds until its write.
 * The WhatsApp methods are in `organization-whatsapp.ts`.
 */
export class Organization extends OrganizationWhatsapp {
  // Setup and sign-in: called by the Worker before any member is signed in,
  // never with input from the browser (`src/server/organization-setup.ts`,
  // `src/server/dev-sign-in.ts`).

  setUp(input: { organizationId: string; name: string; admin: Omit<MemberInput, "roles"> }) {
    return setUpOrganization(this.database, input);
  }

  /** Sets the organization up with its first admin's Clerk user: the setup script's call. */
  setUpWithAccount(input: Parameters<typeof setUpWithAccount>[3]) {
    return setUpWithAccount(this.database, this.accounts, this.emailsInFlight, input);
  }

  activeMembers() {
    return listActiveMembers(this.database);
  }

  // Members

  viewer(caller: Caller) {
    return this.as(caller, "signedIn", (acting) => ({
      ok: true as const,
      viewer: viewerOf(this.database, acting),
    }));
  }

  addMember(caller: Caller, input: MemberInput) {
    return this.as(caller, ["admin"], (acting) =>
      this.database.transaction((tx) => insertMember(tx, acting.userId, input)),
    );
  }

  // Offices and rooms

  listOffices(caller: Caller, input: ListOptions) {
    return this.as(caller, "any", () => listOffices(this.database, input));
  }

  getOffice(caller: Caller, input: { officeId: string } & ListOptions) {
    return this.as(caller, "any", () => getOffice(this.database, input));
  }

  // The first office's zone holds the handoff reminders to 08:00–21:00, so a
  // new or edited office sets the alarm again.
  createOffice(caller: Caller, input: OfficeInput) {
    return this.asThenArm(caller, ["admin"], (acting) =>
      createOffice(this.database, acting, input),
    );
  }

  updateOffice(caller: Caller, input: OfficeUpdate) {
    return this.asThenArm(caller, ["admin"], (acting) =>
      updateOffice(this.database, acting, input),
    );
  }

  setOfficeActive(caller: Caller, input: ActiveChange) {
    return this.as(caller, ["admin"], (acting) => setOfficeActive(this.database, acting, input));
  }

  createRoom(caller: Caller, input: RoomInput) {
    return this.as(caller, ["admin"], (acting) => createRoom(this.database, acting, input));
  }

  updateRoom(caller: Caller, input: RoomUpdate) {
    return this.as(caller, ["admin"], (acting) => updateRoom(this.database, acting, input));
  }

  setRoomActive(caller: Caller, input: ActiveChange) {
    return this.as(caller, ["admin"], (acting) => setRoomActive(this.database, acting, input));
  }

  // Medical services

  listSchedulePractitioners(caller: Caller) {
    return this.as(caller, "any", () => listSchedulePractitioners(this.database));
  }

  listMedicalServices(caller: Caller, input: MedicalServiceListOptions) {
    return this.as(caller, "any", (acting) => listMedicalServices(this.database, acting, input));
  }

  createMedicalService(caller: Caller, input: MedicalServiceInput) {
    return this.as(caller, medicalServiceEditors, (acting) =>
      createMedicalService(this.database, acting, input),
    );
  }

  /** A change to the templates it picks can queue messages. */
  updateMedicalService(caller: Caller, input: MedicalServiceUpdate) {
    return this.asThenArm(caller, medicalServiceEditors, (acting) =>
      updateMedicalService(this.database, acting, input),
    );
  }

  setMedicalServiceActive(caller: Caller, input: MedicalServiceActiveChange) {
    return this.as(caller, medicalServiceEditors, (acting) =>
      setMedicalServiceActive(this.database, acting, input),
    );
  }

  // Insurers

  listInsurers(caller: Caller, input: InsurerListOptions) {
    return this.as(caller, "any", () => listInsurers(this.database, input));
  }

  createInsurer(caller: Caller, input: InsurerInput) {
    return this.as(caller, ["admin"], (acting) => createInsurer(this.database, acting, input));
  }

  updateInsurer(caller: Caller, input: InsurerUpdate) {
    return this.as(caller, ["admin"], (acting) => updateInsurer(this.database, acting, input));
  }

  setInsurerActive(caller: Caller, input: InsurerActiveChange) {
    return this.as(caller, ["admin"], (acting) => setInsurerActive(this.database, acting, input));
  }

  // Staff

  listStaff(caller: Caller) {
    return this.as(caller, ["admin"], () => listStaff(this.database));
  }

  getStaffMember(caller: Caller, input: { memberId: string }) {
    return this.as(caller, ["admin"], () => getStaffMember(this.database, input));
  }

  async createStaffMember(caller: Caller, input: StaffInput) {
    return this.as(caller, ["admin"], (acting) =>
      createStaffMember(this.database, this.accounts, this.emailsInFlight, acting, input),
    );
  }

  async updateMember(caller: Caller, input: MemberUpdate) {
    return this.as(caller, ["admin"], (acting) =>
      updateMember(this.database, this.accounts, acting, input),
    );
  }

  async setMemberActive(caller: Caller, input: MemberActiveChange) {
    return this.as(caller, ["admin"], (acting) =>
      setMemberActive(this.database, this.accounts, acting, input),
    );
  }

  async setStartingPassword(caller: Caller, input: StartingPasswordChange) {
    return this.as(caller, ["admin"], () =>
      setStartingPassword(this.database, this.accounts, input),
    );
  }

  async changePassword(caller: Caller, input: { currentPassword: string; newPassword: string }) {
    return this.as(caller, "signedIn", (acting) =>
      changeOwnPassword(this.database, this.accounts, acting, input),
    );
  }

  // Patients

  listPatients(caller: Caller, input: PatientListOptions) {
    return this.as(caller, patientEditors, () => listPatients(this.database, input));
  }

  searchPatients(caller: Caller, input: SearchOptions) {
    return this.as(caller, patientEditors, () => searchPatients(this.database, input));
  }

  getPatient(caller: Caller, input: { patientId: string }) {
    return this.as(caller, patientEditors, () => getPatient(this.database, input));
  }

  getPatientHistory(caller: Caller, input: { patientId: string }) {
    return this.as(caller, ["admin"], () => getPatientHistory(this.database, input));
  }

  registerPatient(caller: Caller, input: PatientInput & DuplicateConfirmation) {
    return this.as(caller, patientEditors, (acting) =>
      registerPatient(this.database, acting, input),
    );
  }

  updatePatient(caller: Caller, input: PatientUpdate & DuplicateConfirmation) {
    return this.as(caller, patientEditors, (acting) => updatePatient(this.database, acting, input));
  }

  setWhatsappConsent(caller: Caller, input: WhatsappConsentChange) {
    return this.asThenArm(caller, patientEditors, (acting) =>
      setWhatsappConsent(this.database, acting, input),
    );
  }

  decideOptOut(caller: Caller, input: OptOutDecision) {
    return this.asThenArm(caller, patientEditors, (acting) =>
      decideOptOut(this.database, acting, input),
    );
  }

  setPatientActive(caller: Caller, input: PatientActiveChange) {
    return this.as(caller, ["admin"], (acting) => setPatientActive(this.database, acting, input));
  }

  listCoverages(caller: Caller, input: { patientId: string }) {
    return this.as(caller, patientEditors, () => listCoverages(this.database, input));
  }

  addCoverage(caller: Caller, input: CoverageInput) {
    return this.as(caller, patientEditors, (acting) => addCoverage(this.database, acting, input));
  }

  updateCoverage(caller: Caller, input: CoverageUpdate) {
    return this.as(caller, patientEditors, (acting) =>
      updateCoverage(this.database, acting, input),
    );
  }

  makeCoveragePrimary(caller: Caller, input: CoverageId) {
    return this.as(caller, patientEditors, (acting) =>
      makeCoveragePrimary(this.database, acting, input),
    );
  }

  removeCoverage(caller: Caller, input: CoverageId) {
    return this.as(caller, patientEditors, (acting) =>
      removeCoverage(this.database, acting, input),
    );
  }

  listGuardians(caller: Caller, input: { patientId: string }) {
    return this.as(caller, patientEditors, () => listGuardians(this.database, input));
  }

  addGuardian(caller: Caller, input: GuardianInput) {
    return this.as(caller, patientEditors, (acting) => addGuardian(this.database, acting, input));
  }

  updateGuardian(caller: Caller, input: GuardianUpdate) {
    return this.as(caller, patientEditors, (acting) =>
      updateGuardian(this.database, acting, input),
    );
  }

  removeGuardian(caller: Caller, input: GuardianId) {
    return this.as(caller, patientEditors, (acting) =>
      removeGuardian(this.database, acting, input),
    );
  }

  setMessageContact(caller: Caller, input: MessageContactChange) {
    return this.as(caller, patientEditors, (acting) =>
      setMessageContact(this.database, acting, input),
    );
  }

  // Schedules, time off, closures and availability

  getPractitionerSchedules(caller: Caller, input: { practitionerId: string }) {
    return this.as(caller, "any", (acting) =>
      getPractitionerSchedules(this.database, acting, input),
    );
  }

  createSchedule(caller: Caller, input: ScheduleInput) {
    return this.asThenArm(caller, workingTimeEditors, (acting) =>
      createSchedule(this.database, acting, input),
    );
  }

  changeSchedule(caller: Caller, input: ScheduleChange) {
    return this.asThenArm(caller, workingTimeEditors, (acting) =>
      changeSchedule(this.database, acting, input),
    );
  }

  endSchedule(caller: Caller, input: ScheduleEnd) {
    return this.asThenArm(caller, workingTimeEditors, (acting) =>
      endSchedule(this.database, acting, input),
    );
  }

  deleteSchedule(caller: Caller, input: ScheduleDelete) {
    return this.asThenArm(caller, workingTimeEditors, (acting) =>
      deleteSchedule(this.database, acting, input),
    );
  }

  listTimeOff(caller: Caller) {
    return this.as(caller, "any", (acting) => listTimeOff(this.database, acting));
  }

  createTimeOff(caller: Caller, input: TimeOffInput) {
    return this.asThenArm(caller, workingTimeEditors, (acting) =>
      createTimeOff(this.database, acting, input),
    );
  }

  updateTimeOff(caller: Caller, input: TimeOffUpdate) {
    return this.asThenArm(caller, workingTimeEditors, (acting) =>
      updateTimeOff(this.database, acting, input),
    );
  }

  deleteTimeOff(caller: Caller, input: TimeOffDelete) {
    return this.asThenArm(caller, workingTimeEditors, (acting) =>
      deleteTimeOff(this.database, acting, input),
    );
  }

  listClosures(caller: Caller) {
    return this.as(caller, "any", (acting) => listClosures(this.database, acting));
  }

  createClosure(caller: Caller, input: ClosureInput) {
    return this.asThenArm(caller, ["admin"], (acting) =>
      createClosure(this.database, acting, input),
    );
  }

  updateClosure(caller: Caller, input: ClosureUpdate) {
    return this.asThenArm(caller, ["admin"], (acting) =>
      updateClosure(this.database, acting, input),
    );
  }

  deleteClosure(caller: Caller, input: ClosureDelete) {
    return this.asThenArm(caller, ["admin"], (acting) =>
      deleteClosure(this.database, acting, input),
    );
  }

  listAvailabilityPractitioners(caller: Caller) {
    return this.as(caller, "any", (acting) => listAvailabilityPractitioners(this.database, acting));
  }

  getAvailability(caller: Caller, input: AvailabilityQuery) {
    return this.as(caller, "any", (acting) => getAvailability(this.database, acting, input));
  }

  // Appointments and the agenda

  getCalendarWeek(caller: Caller, input: CalendarWeekQuery) {
    return this.as(caller, bookers, (acting) => getCalendarWeek(this.database, acting, input));
  }

  bookAppointment(caller: Caller, input: BookingInput & WarningConfirmation) {
    return this.asThenArm(caller, bookers, (acting) =>
      bookAppointment(this.database, acting, input),
    );
  }

  bookOverbooking(caller: Caller, input: OverbookingInput & WarningConfirmation) {
    return this.asThenArm(caller, bookers, (acting) =>
      bookOverbooking(this.database, acting, input),
    );
  }

  getPatientAppointments(caller: Caller, input: { patientId: string }) {
    return this.as(caller, bookers, (acting) =>
      listPatientAppointments(this.database, acting, input),
    );
  }

  // Appointment changes and the to-reschedule list

  getAppointment(caller: Caller, input: AppointmentIdInput) {
    return this.as(caller, bookers, (acting) => getAppointment(this.database, acting, input));
  }

  updateAppointment(caller: Caller, input: AppointmentUpdate) {
    return this.as(caller, bookers, (acting) => updateAppointment(this.database, acting, input));
  }

  rescheduleAppointment(caller: Caller, input: RescheduleInput & WarningConfirmation) {
    return this.asThenArm(caller, bookers, (acting) =>
      rescheduleAppointment(this.database, acting, input),
    );
  }

  changeAppointmentStatus(caller: Caller, input: StatusChangeInput) {
    return this.asThenArm(caller, bookers, (acting) =>
      changeAppointmentStatus(this.database, acting, input),
    );
  }

  cancelAppointment(caller: Caller, input: CancellationInput) {
    return this.asThenArm(caller, bookers, (acting) =>
      cancelAppointment(this.database, acting, input),
    );
  }

  undoAppointmentStatus(caller: Caller, input: AppointmentIdInput) {
    return this.asThenArm(caller, bookers, (acting) =>
      undoAppointmentStatus(this.database, acting, input),
    );
  }

  listToReschedule(caller: Caller) {
    return this.as(caller, bookers, (acting) => listToReschedule(this.database, acting));
  }

  countToReschedule(caller: Caller) {
    return this.as(caller, bookers, (acting) => countToReschedule(this.database, acting));
  }

  // Each member reads and marks only their own notifications.

  listNotifications(caller: Caller) {
    return this.as(caller, "any", (acting) => listNotifications(this.database, acting));
  }

  countUnreadNotifications(caller: Caller) {
    return this.as(caller, "any", (acting) => countUnreadNotifications(this.database, acting));
  }

  markNotificationRead(caller: Caller, input: NotificationReference) {
    return this.as(caller, "any", (acting) => markNotificationRead(this.database, acting, input));
  }

  // Only admins deactivate, so only they ask what a deactivation would send to the list.

  countPatientUpcoming(caller: Caller, input: PatientReference) {
    return this.as(caller, ["admin"], (acting) =>
      countPatientUpcoming(this.database, acting, input),
    );
  }

  countMemberUpcoming(caller: Caller, input: MemberReference) {
    return this.as(caller, ["admin"], (acting) =>
      countMemberUpcoming(this.database, acting, input),
    );
  }

  countRoomUpcoming(caller: Caller, input: PlaceReference) {
    return this.as(caller, ["admin"], (acting) => countRoomUpcoming(this.database, acting, input));
  }

  countOfficeUpcoming(caller: Caller, input: PlaceReference) {
    return this.as(caller, ["admin"], (acting) =>
      countOfficeUpcoming(this.database, acting, input),
    );
  }

  // The inbox: every staff role reads it; which conversations, and which
  // messages' words, is the area's to decide (`src/organization/inbox.ts`).

  listConversations(caller: Caller, input: ConversationListOptions) {
    return this.as(caller, patientEditors, (acting) =>
      listConversations(this.database, acting, input),
    );
  }

  readConversation(caller: Caller, input: ConversationReference) {
    return this.as(caller, patientEditors, (acting) =>
      readConversation(this.database, acting, input),
    );
  }
}
