import { and, eq, ne, sql } from "drizzle-orm";

import { changedFields } from "#/lib/audit-fields.ts";
import { timingColumns, timingOf, timingRank } from "#/lib/template-timing.ts";
import type { Timing } from "#/lib/template-timing.ts";
import {
  checkTemplateBody,
  eventTemplateIds,
  isEventTemplate,
  templateCreateSchema,
  templateDeleteSchema,
  templateEditSchema,
  templateVariables,
} from "#/lib/whatsapp-templates.ts";
import type { TemplateCreate, TemplateDelete, TemplateEdit } from "#/lib/whatsapp-templates.ts";

import { recordAudit } from "#/organization/audit.ts";
import type { Database, Writer } from "#/organization/database.ts";
import type { WhatsappCloud } from "#/organization/graph-api.ts";
import type { Acting } from "#/organization/members.ts";
import { rebuildTemplate } from "#/organization/template-messages.ts";
import {
  medicalServiceTemplate,
  template,
  whatsappTemplate,
} from "#/organization/whatsapp-schema.ts";
import {
  submittingIn,
  submitVersion,
  versionsByTemplate,
} from "#/organization/whatsapp-templates.ts";

// The organization's templates as an admin manages them
// (docs/domain/messages.md § The organization's templates): its own, which an
// admin creates, names, times and deletes while never sent, and the five
// event templates, whose text alone the admin writes. A save sends the text
// to Meta as a new version when it differs from the latest version's
// (`whatsapp-templates.ts`); a name or a timing is underthing's alone, and
// a new timing rebuilds the template's messages still ahead. Who may call
// each is the object's concern: an admin.

const invalidInput = { ok: false, reason: "invalidInput" } as const;
const notFound = { ok: false, reason: "notFound" } as const;
const nameTaken = { ok: false, reason: "nameTaken" } as const;
const alreadySubmitting = { ok: false, reason: "alreadySubmitting" } as const;

const templateColumns = {
  id: template.id,
  name: template.name,
  timing: template.timing,
  timingHours: template.timingHours,
  draft: template.draft,
};

/** Whether another template than `exceptId` is named `name`, read without case. */
function nameInUse(tx: Writer, name: string, exceptId: string | null) {
  return Boolean(
    tx
      .select({ id: template.id })
      .from(template)
      .where(
        and(
          sql`lower(${template.name}) = lower(${name})`,
          exceptId ? ne(template.id, exceptId) : undefined,
        ),
      )
      .get(),
  );
}

/** The organization's own templates by timing, then name; the event templates after them, in their order. */
function byListOrder(
  a: { id: string; name: string; timing: Timing | null },
  b: { id: string; name: string; timing: Timing | null },
) {
  const [x, y] = [timingRank(a.timing), timingRank(b.timing)];
  const events = eventTemplateIds as readonly string[];
  return (
    x[0] - y[0] ||
    x[1] - y[1] ||
    events.indexOf(a.id) - events.indexOf(b.id) ||
    a.name.localeCompare(b.name, "es")
  );
}

/**
 * Every template of the organization, its own first in the order their
 * messages go, then the event templates, each with its versions newest first;
 * and the setting that keeps templates from being submitted, if any.
 */
export function listTemplates(database: Database, cloud: WhatsappCloud) {
  const versions = versionsByTemplate(database);
  const picked = new Set(
    database
      .selectDistinct({ id: medicalServiceTemplate.templateId })
      .from(medicalServiceTemplate)
      .all()
      .map((row) => row.id),
  );
  const templates = database
    .select(templateColumns)
    .from(template)
    .all()
    .map(({ timing, timingHours, ...row }) => ({
      ...row,
      event: isEventTemplate(row.id),
      timing: timingOf({ timing, timingHours }),
      versions: versions.get(row.id) ?? [],
      picked: picked.has(row.id),
    }))
    .sort(byListOrder);
  return { missing: cloud.missingTemplateSetting(), templates };
}

/** The text of the latest version of template `templateId` submitted, whatever Meta said of it. */
function latestBody(database: Writer, templateId: string) {
  return database
    .select({ body: whatsappTemplate.body })
    .from(whatsappTemplate)
    .where(eq(whatsappTemplate.templateId, templateId))
    .orderBy(sql`${whatsappTemplate.version} desc`)
    .get()?.body;
}

/** Runs `submit` while template `templateId` is held against a second submission of it. */
async function holding<T>(
  database: Database,
  templateId: string,
  submit: () => Promise<T>,
): Promise<T | typeof alreadySubmitting> {
  const submitting = submittingIn(database);
  if (submitting.has(templateId)) {
    return alreadySubmitting;
  }
  submitting.add(templateId);
  try {
    return await submit();
  } finally {
    submitting.delete(templateId);
  }
}

/**
 * Creates one of the organization's own templates, as `acting`, and submits
 * its text to Meta as its first version: nothing is created unless Meta takes it.
 */
export async function createTemplate(
  database: Database,
  cloud: WhatsappCloud,
  acting: Acting,
  input: TemplateCreate,
) {
  const parsed = templateCreateSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { name, timing } = parsed.data;
  const checked = checkTemplateBody(templateVariables(null), parsed.data.body);
  if (!checked.ok) {
    return { ok: false, reason: "invalidTemplate", problems: checked.problems } as const;
  }
  if (nameInUse(database, name, null)) {
    return nameTaken;
  }
  const missing = cloud.missingTemplateSetting();
  if (missing) {
    return { ok: false, reason: missing } as const;
  }
  const templateId = crypto.randomUUID();
  const created = await holding(database, templateId, () =>
    submitVersion(database, cloud, acting, { templateId, body: checked.body }, (tx) => {
      tx.insert(template)
        .values({ id: templateId, name, ...timingColumns(timing) })
        .run();
      recordAudit(tx, acting.userId, {
        action: "create",
        entityType: "template",
        entityId: templateId,
        patientId: null,
        before: null,
        after: { name, ...timingColumns(timing) },
      });
    }),
  );
  if (!created.ok) {
    return created;
  }
  return { ok: true, templateId } as const;
}

/** Writes `settings` on the organization's template `current`, audited, rebuilding its messages when its timing changed. */
function saveSettings(
  tx: Writer,
  acting: Acting,
  current: { id: string; name: string; timing: Timing | null },
  settings: { name: string; timing: Timing } | null,
) {
  if (!settings) {
    return;
  }
  const before = { name: current.name, ...timingColumns(current.timing ?? settings.timing) };
  const after = { name: settings.name, ...timingColumns(settings.timing) };
  const changed = changedFields(before, after);
  if (!changed) {
    return;
  }
  tx.update(template).set(after).where(eq(template.id, current.id)).run();
  recordAudit(tx, acting.userId, {
    action: "update",
    entityType: "template",
    entityId: current.id,
    patientId: null,
    ...changed,
  });
  if (before.timing !== after.timing || before.timingHours !== after.timingHours) {
    rebuildTemplate(tx, current.id);
  }
}

/**
 * Saves template `input.templateId` as `acting`: its name and timing, for one
 * of the organization's own, at once; its text by submitting it to Meta when
 * it differs from the latest version's, and then nothing is saved unless
 * Meta takes it.
 */
export async function editTemplate(
  database: Database,
  cloud: WhatsappCloud,
  acting: Acting,
  input: TemplateEdit,
) {
  const parsed = templateEditSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { templateId, settings } = parsed.data;
  const found = database
    .select(templateColumns)
    .from(template)
    .where(eq(template.id, templateId))
    .get();
  if (!found) {
    return notFound;
  }
  // An event template has no name or timing to save, and the organization's own always has both.
  if (isEventTemplate(templateId) !== (settings === null)) {
    return invalidInput;
  }
  if (settings && nameInUse(database, settings.name, templateId)) {
    return nameTaken;
  }
  const current = { ...found, timing: timingOf(found) };
  const body = parsed.data.body.trim();
  if (body === latestBody(database, templateId)) {
    database.transaction((tx) => saveSettings(tx, acting, current, settings));
    return { ok: true, submitted: false } as const;
  }
  const checked = checkTemplateBody(templateVariables(templateId), body);
  if (!checked.ok) {
    return { ok: false, reason: "invalidTemplate", problems: checked.problems } as const;
  }
  const missing = cloud.missingTemplateSetting();
  if (missing) {
    return { ok: false, reason: missing } as const;
  }
  const submitted = await holding(database, templateId, () =>
    submitVersion(database, cloud, acting, { templateId, body: checked.body }, (tx) =>
      saveSettings(tx, acting, current, settings),
    ),
  );
  return submitted.ok ? ({ ok: true, submitted: true } as const) : submitted;
}

/**
 * Deletes one of the organization's own templates, as `acting`: only one
 * never sent to Meta and picked by no medical service, so no message was
 * ever queued for it.
 */
export function deleteTemplate(database: Database, acting: Acting, input: TemplateDelete) {
  const parsed = templateDeleteSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput;
  }
  const { templateId } = parsed.data;
  return database.transaction((tx) => {
    const found = tx
      .select(templateColumns)
      .from(template)
      .where(eq(template.id, templateId))
      .get();
    if (!found) {
      return notFound;
    }
    if (latestBody(tx, templateId) !== undefined) {
      return { ok: false, reason: "submitted" } as const;
    }
    const pickedBy = tx
      .select({ id: medicalServiceTemplate.medicalServiceId })
      .from(medicalServiceTemplate)
      .where(eq(medicalServiceTemplate.templateId, templateId))
      .get();
    if (pickedBy) {
      return { ok: false, reason: "picked" } as const;
    }
    tx.delete(template).where(eq(template.id, templateId)).run();
    recordAudit(tx, acting.userId, {
      action: "delete",
      entityType: "template",
      entityId: templateId,
      patientId: null,
      before: { name: found.name, timing: found.timing, timingHours: found.timingHours },
      after: null,
    });
    return { ok: true } as const;
  });
}
