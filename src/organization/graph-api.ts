// The organization's side of Meta's Graph API: the one small adapter over the
// WhatsApp Cloud API (ADR-0010). The object calls it; its tests fake Meta at
// `fetch`. It reads the Worker's settings on each call, and the access token
// never leaves this module: no result, error or log line carries it.

const graphApiVersion = "v26.0";

/** The Worker's WhatsApp settings (`wrangler.jsonc`). */
export interface GraphApiSettings {
  /** A secret: the WhatsApp number's access token. */
  WHATSAPP_ACCESS_TOKEN?: string;
  /** The Cloud API's id of the number messages are sent from. */
  WHATSAPP_PHONE_NUMBER_ID?: string;
  /** The WhatsApp Business account the number belongs to, which owns the templates. */
  WHATSAPP_BUSINESS_ACCOUNT_ID?: string;
}

export type MissingSetting = "missingAccessToken" | "missingPhoneNumberId";

export type MissingTemplateSetting = "missingAccessToken" | "missingBusinessAccountId";

export interface TemplateMessage {
  /** E.164. */
  to: string;
  templateName: string;
  languageCode: string;
  /** The value of each named variable the template's body uses; none for a body without them. */
  parameters?: { name: string; value: string }[];
}

/** Meta's error, as it explains a refusal. */
export interface MetaError {
  code: number | null;
  message: string;
}

type MetaRefusal = { ok: false; reason: "metaRefused"; metaError: MetaError };

/** Meta's id for the message, and its WhatsApp id for the recipient, the number its replies come from. */
export type SendResult = { ok: true; messageId: string; waId: string | null } | MetaRefusal;

/** A template body to submit for review, with Meta's example for each of its variables. */
export interface TemplateDraft {
  /** The name at Meta: lowercase letters, digits and underscores. */
  name: string;
  languageCode: string;
  body: string;
  examples: { param_name: string; example: string }[];
}

/** Meta's verdict on a template, in Meta's words: `PENDING`, `APPROVED`, `REJECTED`, … */
export interface TemplateReview {
  status: string;
  /** Meta's reason for a rejection; `null` when there is none. */
  rejectedReason: string | null;
}

export type TemplateCreateResult = { ok: true; templateId: string; status: string } | MetaRefusal;

export type TemplateReadResult = ({ ok: true } & TemplateReview) | MetaRefusal;

export type TemplateNamesResult = { ok: true; names: string[] } | MetaRefusal;

export interface WhatsappCloud {
  /** The setting that keeps a send from being made, or `null` when none is missing. */
  missingSetting(): MissingSetting | null;
  /** Sends an approved template, with its variables' values; requires every setting. */
  sendTemplate(message: TemplateMessage): Promise<SendResult>;
  /** The setting that keeps templates from being submitted or read, or `null` when none is missing. */
  missingTemplateSetting(): MissingTemplateSetting | null;
  /** Submits a utility template, with named variables and no buttons, for Meta's review. */
  createTemplate(draft: TemplateDraft): Promise<TemplateCreateResult>;
  /** Meta's current verdict on the template `templateId`. */
  readTemplate(templateId: string): Promise<TemplateReadResult>;
  /** The names of every template on the account at Meta, in every language. */
  templateNamesAtMeta(): Promise<TemplateNamesResult>;
}

interface GraphApiError {
  error?: { message?: unknown; code?: unknown };
}

interface MessagesAnswer {
  contacts?: { wa_id?: unknown }[];
  messages?: { id?: unknown }[];
}

interface TemplateListAnswer {
  data?: { name?: unknown }[];
  paging?: { next?: unknown };
}

interface TemplateAnswer {
  id?: unknown;
  status?: unknown;
  rejected_reason?: unknown;
}

export function whatsappCloudFor(
  settings: GraphApiSettings,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): WhatsappCloud {
  function missingSetting(): MissingSetting | null {
    if (!settings.WHATSAPP_ACCESS_TOKEN) {
      return "missingAccessToken";
    }
    if (!settings.WHATSAPP_PHONE_NUMBER_ID) {
      return "missingPhoneNumberId";
    }
    return null;
  }

  function missingTemplateSetting(): MissingTemplateSetting | null {
    if (!settings.WHATSAPP_ACCESS_TOKEN) {
      return "missingAccessToken";
    }
    if (!settings.WHATSAPP_BUSINESS_ACCOUNT_ID) {
      return "missingBusinessAccountId";
    }
    return null;
  }

  /** The token and the account, for a call `missingTemplateSetting()` has cleared. */
  function templateSettings() {
    const token = settings.WHATSAPP_ACCESS_TOKEN;
    const accountId = settings.WHATSAPP_BUSINESS_ACCOUNT_ID;
    if (!token || !accountId) {
      throw new Error("The WhatsApp settings are incomplete: check missingTemplateSetting() first");
    }
    return { token, accountId };
  }

  return {
    missingSetting,
    async sendTemplate({ to, templateName, languageCode, parameters = [] }) {
      const token = settings.WHATSAPP_ACCESS_TOKEN;
      const phoneNumberId = settings.WHATSAPP_PHONE_NUMBER_ID;
      if (!token || !phoneNumberId) {
        throw new Error("The WhatsApp settings are incomplete: check missingSetting() first");
      }
      const response = await fetcher(
        `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: to.replace(/^\+/, ""),
            type: "template",
            template: {
              name: templateName,
              language: { code: languageCode },
              ...(parameters.length > 0 && {
                components: [
                  {
                    type: "body",
                    parameters: parameters.map(({ name, value }) => ({
                      type: "text",
                      parameter_name: name,
                      text: value,
                    })),
                  },
                ],
              }),
            },
          }),
        },
      );
      const answer = await answerOf(response);
      if (!answer.ok) {
        return answer;
      }
      const { messages, contacts } = answer.body as MessagesAnswer;
      const messageId = messages?.[0]?.id;
      if (typeof messageId !== "string") {
        throw new Error("The Graph API accepted a message without returning its id");
      }
      const waId = contacts?.[0]?.wa_id;
      return { ok: true, messageId, waId: typeof waId === "string" ? waId : null };
    },
    missingTemplateSetting,
    async createTemplate({ name, languageCode, body, examples }) {
      const { token, accountId } = templateSettings();
      const response = await fetcher(
        `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(accountId)}/message_templates`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({
            name,
            language: languageCode,
            category: "UTILITY",
            parameter_format: "NAMED",
            components: [
              {
                type: "BODY",
                text: body,
                // Meta refuses an example for a body with no variables.
                ...(examples.length > 0 && { example: { body_text_named_params: examples } }),
              },
            ],
          }),
        },
      );
      const answer = await answerOf(response);
      if (!answer.ok) {
        return answer;
      }
      const { id, status } = answer.body as TemplateAnswer;
      if (typeof id !== "string" || typeof status !== "string") {
        throw new Error("The Graph API accepted a template without returning its id and status");
      }
      return { ok: true, templateId: id, status };
    },
    async readTemplate(templateId) {
      const { token } = templateSettings();
      const fields = new URLSearchParams({ fields: "status,rejected_reason" });
      const response = await fetcher(
        `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(templateId)}?${fields}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      const answer = await answerOf(response);
      if (!answer.ok) {
        return answer;
      }
      const { status, rejected_reason: reason } = answer.body as TemplateAnswer;
      if (typeof status !== "string") {
        throw new Error("The Graph API returned a template without its status");
      }
      const rejectedReason = typeof reason === "string" && reason !== "NONE" ? reason : null;
      return { ok: true, status, rejectedReason };
    },
    async templateNamesAtMeta() {
      const { token, accountId } = templateSettings();
      // Every name, not a `name` filter: Meta does not document how that one matches.
      const query = new URLSearchParams({ fields: "name", limit: "100" });
      let page: string | undefined =
        `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(accountId)}/message_templates?${query}`;
      const names: string[] = [];
      while (page) {
        const response = await fetcher(page, { headers: { authorization: `Bearer ${token}` } });
        const answer = await answerOf(response);
        if (!answer.ok) {
          return answer;
        }
        const { data, paging } = answer.body as TemplateListAnswer;
        if (!Array.isArray(data)) {
          throw new Error("The Graph API listed templates without their data");
        }
        for (const template of data) {
          if (typeof template.name === "string") {
            names.push(template.name);
          }
        }
        page = nextPage(paging?.next);
      }
      return { ok: true, names };
    },
  };
}

/** Meta's link to a list's next page; the token goes only to the Graph API's own host. */
function nextPage(next: unknown): string | undefined {
  if (typeof next !== "string") {
    return undefined;
  }
  if (new URL(next).origin !== "https://graph.facebook.com") {
    throw new Error("The Graph API linked a next page on another host");
  }
  return next;
}

/** Meta's answer: its JSON body when it accepted, or its error; a failure when it is neither. */
async function answerOf(response: Response): Promise<{ ok: true; body: unknown } | MetaRefusal> {
  const answer: unknown = await response.json().catch(() => null);
  if (response.ok) {
    return { ok: true, body: answer ?? {} };
  }
  const error = (answer as GraphApiError | null)?.error;
  if (typeof error?.message !== "string") {
    throw new Error(`The Graph API answered ${response.status} without an error`);
  }
  const code = typeof error.code === "number" ? error.code : null;
  return { ok: false, reason: "metaRefused", metaError: { code, message: error.message } };
}
