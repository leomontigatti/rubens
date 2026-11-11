import { and, desc, eq, max, sql } from "drizzle-orm";

import type { NotificationKind } from "#/lib/notifications.ts";
import type {
  WhatsappTemplateCategoryUpdate,
  WhatsappTemplateStatusUpdate,
} from "#/lib/whatsapp-messages.ts";
import {
  metaTemplateName,
  templateExamples,
  templateLanguage,
  templateCategoryOf,
  templateStatusOf,
  versionOf,
} from "#/lib/whatsapp-templates.ts";
import type { TemplateCategory, TemplateStatus } from "#/lib/whatsapp-templates.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { MetaError, WhatsappCloud } from "#/organization/graph-api.ts";
import { organizationName } from "#/organization/members.ts";
import type { Acting } from "#/organization/members.ts";
import { notifyAdmins } from "#/organization/notifications.ts";
import { rebuildTemplate } from "#/organization/template-messages.ts";
import { waitingCount } from "#/organization/whatsapp-limits.ts";
import { template, whatsappTemplate } from "#/organization/whatsapp-schema.ts";

// The versions of the organization's WhatsApp templates (#154): a checked body
// goes to Meta as a template's new version (`templates.ts` decides when), and
// Meta's verdict arrives by the webhook or by a refresh from the settings. A
// version Meta approves rebuilds its template's messages still ahead
// (`template-messages.ts`); one Meta stops, by either way, warns every admin
// (`whatsapp-limits.ts` counts what waits). Who may call each is the object's
// concern: an admin.

/**
 * The templates each object is submitting to Meta right now. The version is
 * chosen before Meta's call and stored after it, and other events run during
 * that `await`, so a second submission of the same template waits its turn.
 */
const submittingByObject = new WeakMap<Database, Set<string>>();

export function submittingIn(database: Database) {
  let submitting = submittingByObject.get(database);
  if (!submitting) {
    submitting = new Set();
    submittingByObject.set(database, submitting);
  }
  return submitting;
}

const listedColumns = {
  id: whatsappTemplate.id,
  templateId: whatsappTemplate.templateId,
  version: whatsappTemplate.version,
  body: whatsappTemplate.body,
  metaId: whatsappTemplate.metaId,
  status: whatsappTemplate.status,
  rejectionReason: whatsappTemplate.rejectionReason,
  category: whatsappTemplate.category,
  submittedAt: whatsappTemplate.createdAt,
};

/**
 * Every submitted version of the organization's templates, by template, each
 * newest first with the one in use marked (`approvedVersion`'s).
 */
export function versionsByTemplate(database: Database) {
  const rows = database
    .select(listedColumns)
    .from(whatsappTemplate)
    .orderBy(desc(whatsappTemplate.version))
    .all();
  const byTemplate = new Map<string, ((typeof rows)[number] & { inUse: boolean })[]>();
  for (const row of rows) {
    const versions = byTemplate.get(row.templateId) ?? [];
    const inUse =
      row.status === "approved" && row.category === "utility" && !versions.some((one) => one.inUse);
    versions.push({ ...row, inUse });
    byTemplate.set(row.templateId, versions);
  }
  return byTemplate;
}

/**
 * The version after the latest one stored or at Meta: Meta may hold a version
 * this object never stored (a submission whose answer was lost, another
 * Worker on the same account), and refuses a name it already has.
 */
function nextVersion(database: Database, templateId: string, namesAtMeta: string[]) {
  const stored = database
    .select({ version: max(whatsappTemplate.version) })
    .from(whatsappTemplate)
    .where(eq(whatsappTemplate.templateId, templateId))
    .get();
  const atMeta = namesAtMeta.map((metaName) => versionOf(templateId, metaName) ?? 0);
  return Math.max(stored?.version ?? 0, ...atMeta) + 1;
}

/** The draft template `templateId` started from, as the text its first version replaces; `null` for none. */
function draftOf(tx: Writer, templateId: string) {
  const draft = tx
    .select({ draft: template.draft })
    .from(template)
    .where(eq(template.id, templateId))
    .get()?.draft;
  return draft ? { version: 0, body: draft } : null;
}

/**
 * Submits `body`, already checked, to Meta as template `templateId`'s next
 * version. What Meta accepts is written by `store`, in the transaction that
 * stores the version and its audit entry; Meta's refusal stores nothing. The
 * caller holds the template in `submittingIn` meanwhile.
 */
export async function submitVersion(
  database: Database,
  cloud: WhatsappCloud,
  acting: Acting,
  submission: { templateId: string; body: string },
  store: (tx: Writer) => void,
) {
  const { templateId, body } = submission;
  const atMeta = await cloud.templateNamesAtMeta();
  if (!atMeta.ok) {
    return atMeta;
  }
  const version = nextVersion(database, templateId, atMeta.names);
  const created = await cloud.createTemplate({
    name: metaTemplateName(templateId, version),
    languageCode: templateLanguage,
    body,
    examples: templateExamples(body, organizationName(database)),
  });
  if (!created.ok) {
    return created;
  }
  database.transaction((tx) => {
    store(tx);
    // The text it replaces, for the audit entry: the latest version before it, else the draft.
    const previous =
      tx
        .select({ version: whatsappTemplate.version, body: whatsappTemplate.body })
        .from(whatsappTemplate)
        .where(eq(whatsappTemplate.templateId, templateId))
        .orderBy(desc(whatsappTemplate.version))
        .get() ?? draftOf(tx, templateId);
    const row = tx
      .insert(whatsappTemplate)
      .values({
        templateId,
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
      before: previous ?? null,
      after: {
        templateId,
        version,
        language: templateLanguage,
        body: row.body,
        metaId: row.metaId,
        status: row.status,
      },
    });
    if (row.status === "approved") {
      rebuildTemplate(tx, templateId);
    }
  });
  return { ok: true } as const;
}

/**
 * The latest approved utility version of template `templateId`, the one that goes;
 * `null` while none is. A version Meta moved to another category waits, like
 * one paused (docs/domain/messages.md § When Meta limits the number).
 */
export function approvedVersion(database: Writer, templateId: string) {
  return (
    database
      .select({
        version: whatsappTemplate.version,
        language: whatsappTemplate.language,
        body: whatsappTemplate.body,
      })
      .from(whatsappTemplate)
      .where(
        and(
          eq(whatsappTemplate.templateId, templateId),
          eq(whatsappTemplate.status, "approved"),
          eq(whatsappTemplate.category, "utility"),
        ),
      )
      .orderBy(desc(whatsappTemplate.version))
      .get() ?? null
  );
}

/** The columns a status writes: a rejection reason stays only while the template is rejected. */
function statusColumns({ status, reason }: Omit<WhatsappTemplateStatusUpdate, "metaId">) {
  return {
    status,
    rejectionReason: status === "rejected" ? reason : null,
    statusRevision: sql`${whatsappTemplate.statusRevision} + 1`,
  };
}

/**
 * Rebuilds the messages still ahead of a template whose version Meta just
 * approved: its first approval is what lets them queue (`template-messages.ts`).
 */
function rebuildOnApproval(
  tx: Writer,
  changed: { templateId: string; status: TemplateStatus },
  status: TemplateStatus,
) {
  if (status === "approved" && changed.status !== "approved") {
    rebuildTemplate(tx, changed.templateId);
  }
}

/** The template version with Meta's id `metaId`, as a change to it reports it. */
function versionWithMetaId(tx: Writer, metaId: string) {
  return tx
    .select({
      templateId: whatsappTemplate.templateId,
      version: whatsappTemplate.version,
      status: whatsappTemplate.status,
      category: whatsappTemplate.category,
    })
    .from(whatsappTemplate)
    .where(eq(whatsappTemplate.metaId, metaId))
    .get();
}

/**
 * Puts `update` on the template with its Meta id, and returns the version it
 * changed, with the status it had before. An id no template has is ignored.
 */
export function storeTemplateStatus(tx: Writer, update: WhatsappTemplateStatusUpdate) {
  const before = versionWithMetaId(tx, update.metaId);
  if (!before) {
    return { metaId: update.metaId, updated: false, changed: null };
  }
  tx.update(whatsappTemplate)
    .set(statusColumns(update))
    .where(eq(whatsappTemplate.metaId, update.metaId))
    .run();
  rebuildOnApproval(tx, before, update.status);
  return { metaId: update.metaId, updated: true, changed: before };
}

/**
 * Puts the category Meta moved a template to on its version, and returns the
 * version with the category it had before. An id no template has, or a
 * category underthing does not know, is ignored.
 */
export function storeTemplateCategory(tx: Writer, update: WhatsappTemplateCategoryUpdate) {
  const category = templateCategoryOf(update.category);
  const before = versionWithMetaId(tx, update.metaId);
  if (!before || !category) {
    return null;
  }
  tx.update(whatsappTemplate)
    .set({ category })
    .where(eq(whatsappTemplate.metaId, update.metaId))
    .run();
  return { ...before, category, previousCategory: before.category };
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
    .select({
      metaId: whatsappTemplate.metaId,
      revision: whatsappTemplate.statusRevision,
      templateId: whatsappTemplate.templateId,
      version: whatsappTemplate.version,
      status: whatsappTemplate.status,
    })
    .from(whatsappTemplate)
    .all();
  const reviews = await Promise.all(
    stored.map(async (row) => ({ row, review: await cloud.readTemplate(row.metaId) })),
  );
  const failures: MetaError[] = [];
  database.transaction((tx) => {
    const written: {
      row: (typeof stored)[number];
      update: { status: TemplateStatus; reason: string | null };
    }[] = [];
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
      const update = { status, reason: review.rejectedReason };
      const changed = tx
        .update(whatsappTemplate)
        .set(statusColumns(update))
        .where(
          and(
            eq(whatsappTemplate.metaId, row.metaId),
            eq(whatsappTemplate.statusRevision, row.revision),
          ),
        )
        .returning({ id: whatsappTemplate.id })
        .get();
      if (changed) {
        written.push({ row, update });
        rebuildOnApproval(tx, row, status);
      }
    }
    // Once every version is written: what waits depends on the others' verdicts.
    for (const { row, update } of written) {
      warnOfStoppedTemplate(tx, row, update);
    }
  });
  return { ok: true, failures } as const;
}

const stoppedKinds: Partial<Record<TemplateStatus, NotificationKind>> = {
  rejected: "templateRejected",
  paused: "templatePaused",
  disabled: "templateDisabled",
};

/**
 * Warns the admins when a template version's status moved to one that does
 * not go, with Meta's reason and how many of its messages wait for another
 * approved version.
 */
export function warnOfStoppedTemplate(
  tx: Writer,
  changed: { templateId: string; version: number; status: TemplateStatus },
  update: { status: TemplateStatus; reason: string | null },
) {
  const kind = stoppedKinds[update.status];
  if (!kind || changed.status === update.status) {
    return;
  }
  notifyAdmins(tx, {
    kind,
    templateId: changed.templateId,
    templateVersion: changed.version,
    detail: update.reason,
    waiting: approvedVersion(tx, changed.templateId)
      ? 0
      : waitingCount(tx, { templateId: changed.templateId }),
  });
}

/** Warns the admins when Meta moved a template version out of utility, which no longer goes. */
export function warnOfRecategorizedTemplate(
  tx: Writer,
  changed: {
    templateId: string;
    version: number;
    category: TemplateCategory;
    previousCategory: TemplateCategory;
  },
) {
  if (changed.category === "utility" || changed.previousCategory === changed.category) {
    return;
  }
  notifyAdmins(tx, {
    kind: "templateRecategorized",
    templateId: changed.templateId,
    templateVersion: changed.version,
    detail: changed.category.toUpperCase(),
    waiting: approvedVersion(tx, changed.templateId)
      ? 0
      : waitingCount(tx, { templateId: changed.templateId }),
  });
}
