import { describe, expect, it } from "vite-plus/test";
import { and, eq } from "drizzle-orm";

import type { Role } from "#/lib/access.ts";

import {
  answerersOf,
  keepsRecords,
  mayAnswer,
  mayUseHeldReply,
  readerOf,
} from "#/organization/conversation-access.ts";
import type { Reader } from "#/organization/conversation-access.ts";
import type { Database } from "#/organization/database.ts";
import { listNotifications } from "#/organization/notifications.ts";
import {
  addMember,
  addStaff,
  adminCaller,
  expectOk,
  inStorage,
  setUpTestOrganization,
} from "#/organization/organization.test-support.ts";
import type { OrganizationStub } from "#/organization/organization.test-support.ts";
import { member, notification, practitioner } from "#/organization/schema.ts";
import { conversation, handoff, handoffRecipient } from "#/organization/whatsapp-schema.ts";

// Conversation access (ADR-0013), asked through the module on the object's own
// SQLite: who reads a conversation, who answers its handoffs, and who may use
// a held reply, for each role against each way a handoff can reach them.

type Who = "admin" | "receptionist" | "keepsRecords" | "keepsNone" | "practitionerAdmin";
/** How the member stands to the conversation: nobody handed it to them, another handoff in it went to them, or the handoff asked about did. */
type Standing = "notHanded" | "handedOther" | "recipient";
type Kind = "reception" | "practitioner";

const rolesOf: Record<Who, Role[]> = {
  admin: ["admin"],
  receptionist: ["receptionist"],
  keepsRecords: ["practitioner"],
  keepsNone: ["practitioner"],
  practitionerAdmin: ["practitioner", "admin"],
};

let phones = 0;

/** A conversation with an open handoff of `kind` going to `recipients`; another one first when `othersTo` names members. */
function addHandoff(database: Database, kind: Kind, recipients: string[], othersTo: string[] = []) {
  phones += 1;
  const conversationId = database
    .insert(conversation)
    .values({ phone: `+54911${String(phones).padStart(8, "0")}` })
    .returning({ id: conversation.id })
    .get().id;
  const open = (forPractitioner: boolean, to: string[]) => {
    const id = database
      .insert(handoff)
      .values({ conversationId, reason: "patientAsked", forPractitioner })
      .returning({ id: handoff.id })
      .get().id;
    for (const memberId of to) {
      database.insert(handoffRecipient).values({ handoffId: id, memberId }).run();
    }
    return id;
  };
  if (othersTo.length > 0) {
    open(false, othersTo);
  }
  const id = open(kind === "practitioner", recipients);
  return { id, conversationId, forPractitioner: kind === "practitioner" };
}

/** An organization with one member of each kind, besides its first admin. */
async function staffed(organization: OrganizationStub) {
  const members = {
    admin: (await addMember(organization, rolesOf.admin)).userId,
    receptionist: (await addMember(organization, rolesOf.receptionist)).userId,
    keepsRecords: (await addStaff(organization, "Juan")).caller.userId,
    keepsNone: (await addStaff(organization, "Lucía")).caller.userId,
    practitionerAdmin: (await addStaff(organization, "Pedro", rolesOf.practitionerAdmin)).caller
      .userId,
  };
  await inStorage(organization, (database) =>
    database
      .update(practitioner)
      .set({ keepsClinicalRecords: false })
      .where(eq(practitioner.memberId, members.keepsNone))
      .run(),
  );
  return members;
}

/** Whether `reader` finds the conversation `conversationId`. */
function reads(database: Database, reader: Reader, conversationId: string) {
  const found = database
    .select({ id: conversation.id })
    .from(conversation)
    .where(and(eq(conversation.id, conversationId), reader.visible))
    .get();
  return found !== undefined;
}

interface Row {
  who: Who;
  standing: Standing;
  kind: Kind;
  /** Whether they read the conversation; when not, nothing else is asked. */
  reads: boolean;
  answers?: boolean;
  usesHeldReply?: boolean;
  /** The bug the row catches. */
  catches: string;
}

const matrix: Row[] = [
  {
    who: "admin",
    standing: "notHanded",
    kind: "reception",
    reads: true,
    answers: true,
    usesHeldReply: true,
    catches: "an admin is kept from a conversation nobody handed them",
  },
  {
    who: "admin",
    standing: "notHanded",
    kind: "practitioner",
    reads: true,
    answers: false,
    usesHeldReply: false,
    catches: "an admin who keeps no records answers a clinical handoff while someone does",
  },
  {
    who: "admin",
    standing: "recipient",
    kind: "practitioner",
    reads: true,
    answers: true,
    usesHeldReply: false,
    catches:
      "an admin a clinical handoff went to because nobody keeps records cannot answer it (#285)",
  },
  {
    who: "receptionist",
    standing: "notHanded",
    kind: "reception",
    reads: true,
    answers: true,
    usesHeldReply: true,
    catches: "reception cannot answer or use the held reply of a handoff to reception",
  },
  {
    who: "receptionist",
    standing: "handedOther",
    kind: "practitioner",
    reads: true,
    answers: false,
    usesHeldReply: false,
    catches: "a receptionist answers a clinical handoff while someone keeps records",
  },
  {
    who: "receptionist",
    standing: "recipient",
    kind: "practitioner",
    reads: true,
    answers: true,
    usesHeldReply: false,
    catches: "a receptionist a clinical handoff went to cannot answer it, or uses its held reply",
  },
  {
    who: "keepsRecords",
    standing: "notHanded",
    kind: "reception",
    reads: false,
    catches: "a practitioner reads a conversation nobody handed them",
  },
  {
    who: "keepsRecords",
    standing: "notHanded",
    kind: "practitioner",
    reads: false,
    catches: "a practitioner reads a clinical conversation nobody handed them",
  },
  {
    who: "keepsRecords",
    standing: "handedOther",
    kind: "reception",
    reads: true,
    answers: true,
    usesHeldReply: true,
    catches: "a practitioner handed the conversation cannot answer its other handoffs to reception",
  },
  {
    who: "keepsRecords",
    standing: "handedOther",
    kind: "practitioner",
    reads: true,
    answers: true,
    usesHeldReply: true,
    catches:
      "a practitioner who keeps records cannot answer a clinical handoff in a conversation they read",
  },
  {
    who: "keepsRecords",
    standing: "recipient",
    kind: "practitioner",
    reads: true,
    answers: true,
    usesHeldReply: true,
    catches: "a practitioner a clinical handoff went to cannot answer it or use its held reply",
  },
  {
    who: "keepsNone",
    standing: "notHanded",
    kind: "practitioner",
    reads: false,
    catches: "a practitioner who keeps no records reads a conversation nobody handed them",
  },
  {
    who: "keepsNone",
    standing: "handedOther",
    kind: "reception",
    reads: true,
    answers: true,
    usesHeldReply: true,
    catches: "a practitioner who keeps no records cannot answer a handoff to reception they read",
  },
  {
    who: "keepsNone",
    standing: "handedOther",
    kind: "practitioner",
    reads: true,
    answers: false,
    usesHeldReply: false,
    catches:
      "a practitioner who keeps no records answers a clinical handoff that went to someone else",
  },
  {
    who: "keepsNone",
    standing: "recipient",
    kind: "practitioner",
    reads: true,
    answers: true,
    usesHeldReply: false,
    catches:
      "a practitioner who keeps no records uses a clinical held reply, or cannot answer the handoff that went to them",
  },
  {
    who: "practitionerAdmin",
    standing: "notHanded",
    kind: "reception",
    reads: true,
    answers: true,
    usesHeldReply: true,
    catches: "a practitioner who is also an admin reads only what was handed to them",
  },
  {
    who: "practitionerAdmin",
    standing: "notHanded",
    kind: "practitioner",
    reads: true,
    answers: true,
    usesHeldReply: true,
    catches:
      "a practitioner admin who keeps records cannot answer a clinical handoff nobody sent them",
  },
];

describe("conversation access", () => {
  it.each(matrix)("$who, $standing, a handoff to $kind: $catches", async (row) => {
    const { organization } = await setUpTestOrganization();
    const members = await staffed(organization);
    const memberId = members[row.who];
    await inStorage(organization, (database) => {
      const one = addHandoff(
        database,
        row.kind,
        row.standing === "recipient" ? [memberId] : [],
        row.standing === "handedOther" ? [memberId] : [],
      );
      const reader = readerOf(database, { userId: memberId, roles: rolesOf[row.who] });
      expect(reads(database, reader, one.conversationId)).toBe(row.reads);
      if (row.reads) {
        expect(mayAnswer(database, one, reader.answerer)).toBe(row.answers);
        expect(mayUseHeldReply(database, one, reader.answerer)).toBe(row.usesHeldReply);
      }
    });
  });

  it("asks who may answer each handoff the same way it asks each member", async () => {
    const { organization } = await setUpTestOrganization();
    const members = await staffed(organization);
    const gone = (await addStaff(organization, "Rosa")).caller.userId;
    await inStorage(organization, (database) => {
      database.update(member).set({ active: false }).where(eq(member.userId, gone)).run();
      const { admin, keepsNone, keepsRecords: juan, practitionerAdmin } = members;
      const handoffs = [
        addHandoff(database, "reception", []),
        addHandoff(database, "reception", [juan, gone]),
        addHandoff(database, "practitioner", [juan]),
        addHandoff(database, "practitioner", [keepsNone], [juan]),
        addHandoff(database, "practitioner", [admin, gone]),
        addHandoff(database, "practitioner", [], [keepsNone, practitionerAdmin]),
      ];
      const everyone = database
        .select({ userId: member.userId, roles: member.roles, active: member.active })
        .from(member)
        .all();
      expect(everyone.some((one) => one.userId === adminCaller.userId)).toBe(true);
      for (const one of handoffs) {
        const forward = everyone
          .filter((acting) => {
            const reader = readerOf(database, acting);
            return (
              acting.active &&
              reads(database, reader, one.conversationId) &&
              mayAnswer(database, one, reader.answerer)
            );
          })
          .map((acting) => acting.userId);
        expect(new Set(answerersOf(database, one))).toEqual(new Set(forward));
      }
    });
  });

  it("counts a member whose practitioner role was removed as keeping no records everywhere", async () => {
    const { organization } = await setUpTestOrganization();
    const rosa = (await addStaff(organization, "Rosa")).caller.userId;
    const conversationId = await inStorage(organization, (database) => {
      database
        .update(member)
        .set({ roles: ["admin"] })
        .where(eq(member.userId, rosa))
        .run();
      const one = addHandoff(database, "practitioner", [rosa]);
      database
        .insert(notification)
        .values({ kind: "handoff", handoffId: one.id, recipientId: rosa })
        .run();
      return one.conversationId;
    });
    const contacts = expectOk(await organization.handoffContacts(adminCaller));
    expect(contacts.members.find((one) => one.memberId === rosa)?.keepsClinicalRecords).toBe(false);
    await inStorage(organization, (database) => {
      const acting = { userId: rosa, roles: ["admin"] as const };
      const routed = database
        .select({ keeps: keepsRecords.mapWith(Boolean) })
        .from(member)
        .leftJoin(practitioner, eq(practitioner.memberId, member.userId))
        .where(eq(member.userId, rosa))
        .get();
      expect(routed?.keeps).toBe(false);
      expect(readerOf(database, acting).answerer.keepsRecords).toBe(false);
      const listed = listNotifications(database, acting);
      const told = listed.notifications.find(
        (one) => one.handoff?.conversationId === conversationId,
      );
      expect(told?.handoff?.noPractitioner).toBe(true);
    });
  });
});
