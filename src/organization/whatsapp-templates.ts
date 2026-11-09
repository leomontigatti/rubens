import { and, desc, eq, max, sql } from "drizzle-orm";

import type { WhatsappTemplateStatusUpdate } from "#/lib/whatsapp-messages.ts";
import {
  checkTemplateBody,
  metaTemplateName,
  templateExamples,
  templateLanguage,
  templateNames,
  templateStatusOf,
  templateSubmissionSchema,
  versionOf,
} from "#/lib/whatsapp-templates.ts";
import type { TemplateName, TemplateSubmission } from "#/lib/whatsapp-templates.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { MetaError, WhatsappCloud } from "#/organization/graph-api.ts";
import type { Acting } from "#/organization/members.ts";
import { whatsappTemplate } from "#/organization/whatsapp-schema.ts";

// The organization's WhatsApp templates (#154): an admin writes a body for a
// template of the set and submits it to Meta as a new version, and Meta's
// verdict arrives by the webhook or by a refresh from the settings. Until
// Embedded Signup (#159) they live on the Worker's configured account. Who may
// call each is the object's concern: an admin.

const invalidInput = { ok: false, reason: "invalidInput" } as const;

/**
 * The templates each object is submitting to Meta right now. The version is
 * chosen before Meta's call and stored after it, and other events run during
 * that `await`, so a second submission of the same template waits its turn.
 */
const submittingByObject = new WeakMap<Database, Set<TemplateName>>();

function submittingIn(database: Database) {
  let submitting = submittingByObject.get(database);
  if (!submitting) {
    submitting = new Set();
    submittingByObject.set(database, submitting);
  }
  return submitting;
}

const listedColumns = {
  id: whatsappTemplate.id,
  name: whatsappTemplate.name,
  version: whatsappTemplate.version,
  body: whatsappTemplate.body,
  metaId: whatsappTemplate.metaId,
  status: whatsappTemplate.status,
  rejectionReason: whatsappTemplate.rejectionReason,
  submittedAt: whatsappTemplate.createdAt,
};

/**
 * Every template of the set, in the doc's order, each with its submitted
 * versions newest first; and the setting that keeps templates from being
 * submitted, if any.
 */
export function listWhatsappTemplates(database: Database, cloud: WhatsappCloud) {
  const rows = database
    .select(listedColumns)
    .from(whatsappTemplate)
    .orderBy(desc(whatsappTemplate.version))
    .all();
  return {
    missing: cloud.missingTemplateSetting(),
    templates: templateNames.map((name) => ({
      name,
      versions: rows.filter((row) => row.name === name),
    })),
  };
}

/**
 * The version after the latest one stored or at Meta: Meta may hold a version
 * this object never stored (a submission whose answer was lost, another
 * Worker on the same account), and refuses a name it already has.
 */
function nextVersion(database: Database, name: TemplateName, namesAtMeta: string[]) {
  const stored = database
    .select({ version: max(whatsappTemplate.version) })
    .from(whatsappTemplate)
    .where(eq(whatsappTemplate.name, name))
    .get();
  const atMeta = namesAtMeta.map((metaName) => versionOf(name, metaName) ?? 0);
  return Math.max(stored?.version ?? 0, ...atMeta) + 1;
}

/**
 * Checks `input`'s body against Meta's rules and submits it to Meta as the
 * template's next version, as `acting`. What Meta accepts is stored with
 * Meta's id and verdict, and audited; a failing check or Meta's refusal
 * stores nothing.
 */
export async function submitWhatsappTemplate(
  database: Database,
  cloud: WhatsappCloud,
  acting: Acting,
  input: TemplateSubmission,
) {
  const parsed = templateSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { templateName: name } = parsed.data;
  const checked = checkTemplateBody(name, parsed.data.body);
  if (!checked.ok) {
    return { ok: false, reason: "invalidTemplate", problems: checked.problems } as const;
  }
  const missing = cloud.missingTemplateSetting();
  if (missing) {
    return { ok: false, reason: missing } as const;
  }
  const submitting = submittingIn(database);
  if (submitting.has(name)) {
    return { ok: false, reason: "alreadySubmitting" } as const;
  }
  submitting.add(name);
  try {
    return await createVersion(database, cloud, acting, name, checked.body);
  } finally {
    submitting.delete(name);
  }
}

/** Submits `body` to Meta as template `name`'s next version, and stores what Meta accepts. */
async function createVersion(
  database: Database,
  cloud: WhatsappCloud,
  acting: Acting,
  name: TemplateName,
  body: string,
) {
  const atMeta = await cloud.templateNamesAtMeta();
  if (!atMeta.ok) {
    return atMeta;
  }
  const version = nextVersion(database, name, atMeta.names);
  const created = await cloud.createTemplate({
    name: metaTemplateName(name, version),
    languageCode: templateLanguage,
    body,
    examples: templateExamples(body),
  });
  if (!created.ok) {
    return created;
  }
  const template = database.transaction((tx) => {
    const row = tx
      .insert(whatsappTemplate)
      .values({
        name,
        version,
        language: templateLanguage,
        body,
        metaId: created.templateId,
        status: templateStatusOf(created.status) ?? "pending",
        submittedBy: acting.userId,
      })
      .returning(listedColumns)
      .get();
    recordAudit(tx, acting.userId, {
      action: "create",
      entityType: "whatsappTemplate",
      entityId: row.id,
      patientId: null,
      before: null,
      after: {
        name,
        version,
        language: templateLanguage,
        body: row.body,
        metaId: row.metaId,
        status: row.status,
      },
    });
    return row;
  });
  return { ok: true, template } as const;
}

/** The columns a status writes: a rejection reason stays only while the template is rejected. */
function statusColumns({ status, reason }: Omit<WhatsappTemplateStatusUpdate, "metaId">) {
  return {
    status,
    rejectionReason: status === "rejected" ? reason : null,
    statusRevision: sql`${whatsappTemplate.statusRevision} + 1`,
  };
}

/** Puts `update` on the template with its Meta id. An id no template has is ignored. */
export function storeTemplateStatus(tx: Writer, update: WhatsappTemplateStatusUpdate) {
  const changed = tx
    .update(whatsappTemplate)
    .set(statusColumns(update))
    .where(eq(whatsappTemplate.metaId, update.metaId))
    .returning({ id: whatsappTemplate.id })
    .get();
  return { metaId: update.metaId, updated: Boolean(changed) };
}

/**
 * Reads every submitted template's verdict from Meta again and stores it: what
 * a webhook event missed. A template Meta cannot read keeps its status, and
 * Meta's refusal is returned.
 */
export async function refreshWhatsappTemplates(database: Database, cloud: WhatsappCloud) {
  const missing = cloud.missingTemplateSetting();
  if (missing) {
    return { ok: false, reason: missing } as const;
  }
  const stored = database
    .select({ metaId: whatsappTemplate.metaId, revision: whatsappTemplate.statusRevision })
    .from(whatsappTemplate)
    .all();
  const reviews = await Promise.all(
    stored.map(async (row) => ({ row, review: await cloud.readTemplate(row.metaId) })),
  );
  const failures: MetaError[] = [];
  database.transaction((tx) => {
    for (const { row, review } of reviews) {
      if (!review.ok) {
        failures.push(review.metaError);
        continue;
      }
      const status = templateStatusOf(review.status);
      if (!status) {
        continue;
      }
      // A webhook event that changed the row while Meta was being read is newer.
      tx.update(whatsappTemplate)
        .set(statusColumns({ status, reason: review.rejectedReason }))
        .where(
          and(
            eq(whatsappTemplate.metaId, row.metaId),
            eq(whatsappTemplate.statusRevision, row.revision),
          ),
        )
        .run();
    }
  });
  return { ok: true, failures } as const;
}
