import { timingEntry } from "#/lib/template-timing.ts";
import type { Timing } from "#/lib/template-timing.ts";
import { eventTemplateButtons, isEventTemplate } from "#/lib/whatsapp-templates.ts";
import type { ownTemplateButtonKinds, TemplateButtons } from "#/lib/whatsapp-templates.ts";

// The template form's settings as it holds them (`-template-form.tsx`): the
// entry it starts from, the buttons the preview shows, and whether a save
// submits the template to Meta.

/** The name, timing and buttons of one of the organization's own templates. */
export interface TemplateSettings {
  name: string;
  timing: Timing;
  buttons: (typeof ownTemplateButtonKinds)[number];
}

/** The form's entry for `settings`: an event template's, which has none, starts as a new one's would. */
export function settingsEntry(settings: TemplateSettings | null) {
  return {
    name: settings?.name ?? "",
    timing: timingEntry(settings?.timing ?? { when: "before", hours: 24 }),
    buttons: settings?.buttons ?? "none",
  };
}

/** The buttons a template goes with: an event template's fixed ones, else the ones chosen. */
export function buttonsShown(templateId: string | null, chosen: TemplateButtons): TemplateButtons {
  return templateId !== null && isEventTemplate(templateId)
    ? eventTemplateButtons(templateId)
    : chosen;
}

/** Whether a save submits to Meta: the text or the buttons differ from the version sent, or none was. */
export function differsFromSent(
  sent: { body: string; buttons: TemplateButtons } | null,
  body: string,
  buttons: TemplateButtons,
) {
  return body.trim() !== sent?.body || buttons !== sent.buttons;
}
