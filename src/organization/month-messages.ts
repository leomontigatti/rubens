import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { today } from "#/lib/schedules.ts";
import { instantOf } from "#/lib/time-ranges.ts";
import type { TemplateCategory } from "#/lib/whatsapp-templates.ts";

import type { Writer } from "#/organization/database.ts";
import { organizationTimeZone } from "#/organization/offices.ts";
import { whatsappMessage } from "#/organization/whatsapp-schema.ts";

// The organization's WhatsApp messages Meta bills it for this month (#294),
// counts only: Meta bills the organization directly, and its prices change.
// Meta charges per delivered message (since July 2025, its pricing page):
// each template by its category, and each other message the organization
// sends, a service message, past the number's free ones of the month. A
// patient's message costs nothing, nor does a message Meta never delivered.
//
// A template counts as utility: the outbox sends only a version that is
// approved and utility (`approvedVersion`), so every one went out as utility,
// even from a version Meta has since moved to another category.

/** The first day of the month after `month` (`2099-12` → `2100-01-01`). */
function nextMonthStart(month: string) {
  const [year, number] = month.split("-").map(Number);
  return number === 12
    ? `${year! + 1}-01-01`
    : `${year}-${String(number! + 1).padStart(2, "0")}-01`;
}

/** This month's delivered messages, in the organization's zone: the templates by category, and the rest. */
export function monthMessages(database: Writer) {
  const timeZone = organizationTimeZone(database);
  const month = today(timeZone).slice(0, "yyyy-MM".length);
  const from = instantOf(`${month}-01`, "00:00", timeZone).getTime();
  const until = instantOf(nextMonthStart(month), "00:00", timeZone).getTime();
  const isTemplate = sql<number>`${whatsappMessage.type} = 'template'`.mapWith(Boolean);
  const counted = database
    .select({ isTemplate, delivered: count() })
    .from(whatsappMessage)
    .where(
      and(
        eq(whatsappMessage.direction, "outgoing"),
        inArray(whatsappMessage.status, ["delivered", "read"]),
        gte(whatsappMessage.sentAt, from),
        lt(whatsappMessage.sentAt, until),
      ),
    )
    .groupBy(isTemplate)
    .all();
  const delivered = (template: boolean) =>
    counted.find((row) => row.isTemplate === template)?.delivered ?? 0;
  const templates: Record<TemplateCategory, number> = {
    utility: delivered(true),
    marketing: 0,
    authentication: 0,
  };
  return { month, templates, serviceMessages: delivered(false) };
}
