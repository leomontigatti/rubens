import { and, asc, eq, sql } from "drizzle-orm";

import { handoffContactsSchema } from "#/lib/handoff-contacts.ts";
import type { HandoffContactsInput } from "#/lib/handoff-contacts.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { Acting } from "#/organization/members.ts";
import { member, practitioner } from "#/organization/schema.ts";

// The organization's handoff contacts (assistant.md § Handoff): the members who
// receive the handoffs that concern no particular practitioner. At least one of
// them is an active practitioner who keeps clinical records, so a clinical
// handoff always has someone to go to. The last such contact is guarded like
// the last admin: the staff changes that would take them out of that set ask
// `isLastClinicalContact` (`src/organization/staff.ts`). Who may call each is
// the object's concern: an admin.

export interface HandoffContactCandidate {
  memberId: string;
  name: string;
  /** Holds the practitioner role and keeps clinical records. */
  keepsClinicalRecords: boolean;
  handoffContact: boolean;
}

// Whether a member row keeps clinical records: the practitioner role, and the
// setting on the practitioner row the role keeps after it is removed.
export const keepsRecords = sql<boolean>`(exists (select 1 from json_each(${member.roles}) where value = 'practitioner') and coalesce(${practitioner.keepsClinicalRecords}, 0) = 1)`;

/** The active members an admin picks from, by name, with who is a contact now. */
export function listHandoffContacts(database: Database) {
  const members = database
    .select({
      memberId: member.userId,
      name: member.name,
      keepsClinicalRecords: keepsRecords.mapWith(Boolean),
      handoffContact: member.handoffContact,
    })
    .from(member)
    .leftJoin(practitioner, eq(practitioner.memberId, member.userId))
    .where(eq(member.active, true))
    .orderBy(asc(member.name), asc(member.email))
    .all();
  return { ok: true as const, members };
}

/**
 * Replaces the handoff contacts with `input`'s members, as `acting`, and
 * audits each member who became or stopped being one. Refused when a member is
 * not active, or when none of them keeps clinical records; a refusal saves
 * nothing. A deactivated contact the save leaves out stops being one.
 */
export function replaceHandoffContacts(
  database: Database,
  acting: Acting,
  input: HandoffContactsInput,
) {
  const parsed = handoffContactsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, reason: "invalidInput" as const };
  }
  const picked = new Set(parsed.data.memberIds);
  return database.transaction((tx) => {
    const rows = tx
      .select({
        memberId: member.userId,
        active: member.active,
        keepsClinicalRecords: keepsRecords.mapWith(Boolean),
        handoffContact: member.handoffContact,
      })
      .from(member)
      .leftJoin(practitioner, eq(practitioner.memberId, member.userId))
      .all();
    const activeIds = new Set(rows.filter((row) => row.active).map((row) => row.memberId));
    if ([...picked].some((memberId) => !activeIds.has(memberId))) {
      return { ok: false as const, reason: "notFound" as const };
    }
    if (!rows.some((row) => picked.has(row.memberId) && row.keepsClinicalRecords)) {
      return { ok: false as const, reason: "noClinicalContact" as const };
    }
    for (const row of rows) {
      const handoffContact = picked.has(row.memberId);
      if (handoffContact === row.handoffContact) {
        continue;
      }
      tx.update(member).set({ handoffContact }).where(eq(member.userId, row.memberId)).run();
      recordAudit(tx, acting.userId, {
        action: "update",
        entityType: "member",
        entityId: row.memberId,
        patientId: null,
        before: { handoffContact: row.handoffContact },
        after: { handoffContact },
      });
    }
    return { ok: true as const };
  });
}

/**
 * Whether `memberId` is the only active handoff contact who keeps clinical
 * records, so they must stay one: active, a practitioner, and keeping records.
 */
export function isLastClinicalContact(writer: Writer, memberId: string): boolean {
  const contacts = writer
    .select({ memberId: member.userId })
    .from(member)
    .leftJoin(practitioner, eq(practitioner.memberId, member.userId))
    .where(and(eq(member.active, true), eq(member.handoffContact, true), keepsRecords))
    .all();
  return contacts.length === 1 && contacts[0]?.memberId === memberId;
}
