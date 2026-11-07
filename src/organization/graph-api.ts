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
}

export type MissingSetting = "missingAccessToken" | "missingPhoneNumberId";

export interface TemplateMessage {
  /** E.164. */
  to: string;
  templateName: string;
  languageCode: string;
}

/** Meta's error, as it explains a refusal. */
export interface MetaError {
  code: number | null;
  message: string;
}

export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: "metaRefused"; metaError: MetaError };

export interface WhatsappCloud {
  /** The setting that keeps a send from being made, or `null` when none is missing. */
  missingSetting(): MissingSetting | null;
  /** Sends an approved template with no variables; requires every setting. */
  sendTemplate(message: TemplateMessage): Promise<SendResult>;
}

interface GraphApiError {
  error?: { message?: unknown; code?: unknown };
}

interface MessagesAnswer {
  messages?: { id?: unknown }[];
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

  return {
    missingSetting,
    async sendTemplate({ to, templateName, languageCode }) {
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
            template: { name: templateName, language: { code: languageCode } },
          }),
        },
      );
      return sendResultOf(response);
    },
  };
}

/** Meta's answer to a send: its message id, or its error; a failure when it is neither. */
async function sendResultOf(response: Response): Promise<SendResult> {
  const answer: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const messageId = (answer as MessagesAnswer | null)?.messages?.[0]?.id;
    if (typeof messageId !== "string") {
      throw new Error("The Graph API accepted a message without returning its id");
    }
    return { ok: true, messageId };
  }
  const error = (answer as GraphApiError | null)?.error;
  if (typeof error?.message !== "string") {
    throw new Error(`The Graph API answered ${response.status} without an error`);
  }
  const code = typeof error.code === "number" ? error.code : null;
  return { ok: false, reason: "metaRefused", metaError: { code, message: error.message } };
}
