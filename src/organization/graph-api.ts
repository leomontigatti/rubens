// The organization's side of Meta's Graph API: the one small adapter over the
// WhatsApp Cloud API (ADR-0010). The object calls it; its tests fake Meta at
// `fetch`. It reads the number's settings on each call, and an access token
// never leaves this module: no result, error or log line carries it, the
// business token Embedded Signup returns included.

import { fromMediaHost } from "#/organization/graph-api-media.ts";
import type { MediaHostAnswer } from "#/organization/graph-api-media.ts";

const graphApiVersion = "v26.0";

/**
 * The number the object sends from: the organization's connection
 * (`src/organization/whatsapp-connection.ts`), or the Worker's configured test
 * number (`wrangler.jsonc`) for the organization it is configured for.
 */
export interface GraphApiSettings {
  /** A secret: the WhatsApp number's access token. */
  WHATSAPP_ACCESS_TOKEN?: string;
  /** The Cloud API's id of the number messages are sent from. */
  WHATSAPP_PHONE_NUMBER_ID?: string;
  /** The WhatsApp Business account the number belongs to, which owns the templates. */
  WHATSAPP_BUSINESS_ACCOUNT_ID?: string;
  /** The organization's connection is in error: Meta refused its token, or an admin disconnected it. */
  connectionFailed?: boolean;
}

/**
 * The Worker's test number, for the one organization `WHATSAPP_ORGANIZATION_ID`
 * names: until Embedded Signup it stood in for every organization's number, and
 * it stays for development.
 */
export function configuredWhatsappSettings(
  env: GraphApiSettings & { WHATSAPP_ORGANIZATION_ID?: string },
  organizationId: string | null,
): GraphApiSettings {
  if (!organizationId || env.WHATSAPP_ORGANIZATION_ID !== organizationId) {
    return {};
  }
  const { WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID } = env;
  return { WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_BUSINESS_ACCOUNT_ID };
}

/** Where the client reads its settings, and whom it tells that Meta refused the token. */
export interface CloudConnection {
  settings(): GraphApiSettings;
  /** Meta refused `token`, the access token a call was made with: it expired, or the business revoked it. */
  tokenRefused(error: MetaError, token: string): void;
}

export type MissingSetting = "connectionFailed" | "missingAccessToken" | "missingPhoneNumberId";

export type MissingTemplateSetting =
  | "connectionFailed"
  | "missingAccessToken"
  | "missingBusinessAccountId";

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

/** A message's media as Meta streams it, all of it or the byte range asked for. */
export type MediaStreamResult = ({ ok: true; mimeType: string } & MediaHostAnswer) | MetaRefusal;

export interface WhatsappCloud {
  /** The setting that keeps a send from being made, or `null` when none is missing. */
  missingSetting(): MissingSetting | null;
  /** Sends an approved template, with its variables' values; requires every setting. */
  sendTemplate(message: TemplateMessage): Promise<SendResult>;
  /**
   * Sends free-form text, which Meta accepts only inside the conversation
   * window (`src/lib/conversation-window.ts`); requires every setting.
   */
  sendText(message: { to: string; text: string }): Promise<SendResult>;
  /**
   * Marks the patient's message `messageId`, and every earlier one, read, and
   * shows them typing until the next message or 25 seconds; requires every setting.
   */
  showTyping(messageId: string): Promise<{ ok: true } | MetaRefusal>;
  /**
   * Streams the media `mediaId` of a patient's message, such as a voice note,
   * which Meta serves only with the number's token: the bytes pass through as
   * Meta sends them, all of them or the byte `range` (`bytes=0-1023`) a player
   * asks for. Requires every setting.
   */
  openMedia(mediaId: string, range: string | null): Promise<MediaStreamResult>;
  /** The setting that keeps templates from being submitted or read, or `null` when none is missing. */
  missingTemplateSetting(): MissingTemplateSetting | null;
  /** Meta's id for the business account the number belongs to, or `null` while none is known. */
  businessAccountId(): string | null;
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

interface MediaAnswer {
  url?: unknown;
  mime_type?: unknown;
}

interface TemplateAnswer {
  id?: unknown;
  status?: unknown;
  rejected_reason?: unknown;
}

/** Meta's codes for a token it no longer accepts: expired or invalidated (190), or a user who blocked the app (0). */
const refusedTokenCodes = new Set([0, 190]);

export function whatsappCloudFor(
  connection: CloudConnection,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): WhatsappCloud {
  /** Meta's answer to a call made with `token`, which is reported when Meta refused it. */
  async function answerOf(response: Response, token: string) {
    const answer = await metaAnswerOf(response);
    if (!answer.ok && refusedTokenCodes.has(answer.metaError.code ?? -1)) {
      connection.tokenRefused(answer.metaError, token);
    }
    return answer;
  }

  async function openMedia(mediaId: string, range: string | null): Promise<MediaStreamResult> {
    const token = connection.settings().WHATSAPP_ACCESS_TOKEN;
    if (!token) {
      throw new Error("The WhatsApp settings are incomplete: check missingSetting() first");
    }
    const authorization = `Bearer ${token}`;
    const described = await answerOf(
      await fetcher(
        `https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(mediaId)}`,
        {
          headers: { authorization },
        },
      ),
      token,
    );
    if (!described.ok) {
      return described;
    }
    const { url, mime_type: mimeType } = described.body as MediaAnswer;
    if (typeof url !== "string" || typeof mimeType !== "string") {
      throw new Error("The Graph API described a media without its link and type");
    }
    return { ok: true, mimeType, ...(await fromMediaHost(fetcher, url, authorization, range)) };
  }

  function missingSetting(): MissingSetting | null {
    const settings = connection.settings();
    if (settings.connectionFailed) {
      return "connectionFailed";
    }
    if (!settings.WHATSAPP_ACCESS_TOKEN) {
      return "missingAccessToken";
    }
    if (!settings.WHATSAPP_PHONE_NUMBER_ID) {
      return "missingPhoneNumberId";
    }
    return null;
  }

  function missingTemplateSetting(): MissingTemplateSetting | null {
    const settings = connection.settings();
    if (settings.connectionFailed) {
      return "connectionFailed";
    }
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
    const settings = connection.settings();
    const token = settings.WHATSAPP_ACCESS_TOKEN;
    const accountId = settings.WHATSAPP_BUSINESS_ACCOUNT_ID;
    if (!token || !accountId) {
      throw new Error("The WhatsApp settings are incomplete: check missingTemplateSetting() first");
    }
    return { token, accountId };
  }

  /** Posts `body` to the number's `/messages`, Meta's answer to it; requires every setting. */
  async function postToMessages(body: Record<string, unknown>) {
    const settings = connection.settings();
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
        body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
      },
    );
    return answerOf(response, token);
  }

  /** Sends `content` (a message's type and its body) to `to`; requires every setting. */
  async function sendMessage(to: string, content: Record<string, unknown>): Promise<SendResult> {
    const answer = await postToMessages({
      recipient_type: "individual",
      to: to.replace(/^\+/, ""),
      ...content,
    });
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
  }

  return {
    missingSetting,
    businessAccountId: () => connection.settings().WHATSAPP_BUSINESS_ACCOUNT_ID || null,
    sendTemplate({ to, templateName, languageCode, parameters = [] }) {
      return sendMessage(to, {
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
      });
    },
    sendText({ to, text }) {
      return sendMessage(to, { type: "text", text: { body: text, preview_url: false } });
    },
    async showTyping(messageId) {
      const answer = await postToMessages({
        status: "read",
        message_id: messageId,
        typing_indicator: { type: "text" },
      });
      return answer.ok ? { ok: true } : answer;
    },
    openMedia,
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
      const answer = await answerOf(response, token);
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
      const answer = await answerOf(response, token);
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
        const answer = await answerOf(response, token);
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

/** The Worker's Embedded Signup settings (`wrangler.jsonc`). */
export interface SignupSettings {
  META_APP_ID?: string;
  /** A secret: it also signs the webhook's calls. */
  META_APP_SECRET?: string;
  /** The Facebook Login for Business configuration that runs Embedded Signup v4. */
  WHATSAPP_SIGNUP_CONFIG_ID?: string;
}

/** A number Embedded Signup connected, as Meta describes it. */
export interface ConnectedNumber {
  /** As Meta formats it, such as `+54 9 351 555-0100`. */
  displayNumber: string;
  /** Meta's messaging limit, such as `TIER_250`; `null` when Meta gave none. */
  messagingLimit: string | null;
}

type MetaDone = { ok: true } | MetaRefusal;

/** Embedded Signup's calls, each made with the business token its code exchanges for. */
export interface MetaSignup {
  /** What the browser launches signup with, or `null` while a setting is missing. */
  launch(): { appId: string; configurationId: string } | null;
  /** The first setting `launch()` misses, for the Worker's log. */
  missingSetting(): keyof SignupSettings | null;
  /** The business token for the code the signup popup returned. */
  exchangeCode(code: string): Promise<{ ok: true; token: string } | MetaRefusal>;
  /** The number, or `null` when the account has no such number. */
  readNumber(
    token: string,
    businessAccountId: string,
    phoneNumberId: string,
  ): Promise<{ ok: true; number: ConnectedNumber | null } | MetaRefusal>;
  /** Registers the number for the Cloud API, with `pin` as its two-step verification PIN. */
  registerNumber(token: string, phoneNumberId: string, pin: string): Promise<MetaDone>;
  /** Subscribes underthing's app to the account's webhooks. */
  subscribeApp(token: string, businessAccountId: string): Promise<MetaDone>;
}

interface PhoneNumberAnswer {
  id?: unknown;
  display_phone_number?: unknown;
  whatsapp_business_manager_messaging_limit?: unknown;
}

export function metaSignupFor(
  settings: SignupSettings,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): MetaSignup {
  const graph = `https://graph.facebook.com/${graphApiVersion}`;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  async function post(url: string, token: string, body: unknown): Promise<MetaDone> {
    const response = await fetcher(url, {
      method: "POST",
      headers: { ...bearer(token), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const answer = await metaAnswerOf(response);
    return answer.ok ? { ok: true } : answer;
  }

  return {
    launch() {
      const { META_APP_ID: appId, WHATSAPP_SIGNUP_CONFIG_ID: configurationId } = settings;
      return appId && configurationId && settings.META_APP_SECRET
        ? { appId, configurationId }
        : null;
    },
    missingSetting() {
      const names = ["META_APP_ID", "META_APP_SECRET", "WHATSAPP_SIGNUP_CONFIG_ID"] as const;
      return names.find((name) => !settings[name]) ?? null;
    },
    async exchangeCode(code) {
      const { META_APP_ID: appId, META_APP_SECRET: appSecret } = settings;
      if (!appId || !appSecret) {
        throw new Error("The signup settings are incomplete: check launch() first");
      }
      const query = new URLSearchParams({ client_id: appId, client_secret: appSecret, code });
      const answer = await metaAnswerOf(await fetcher(`${graph}/oauth/access_token?${query}`));
      if (!answer.ok) {
        return answer;
      }
      const token = (answer.body as { access_token?: unknown }).access_token;
      if (typeof token !== "string") {
        throw new Error("The Graph API exchanged the code without returning a token");
      }
      return { ok: true, token };
    },
    async readNumber(token, businessAccountId, phoneNumberId) {
      // The account's own list, so a number of another account is not taken on the browser's word.
      const listed = await metaAnswerOf(
        await fetcher(
          `${graph}/${encodeURIComponent(businessAccountId)}/phone_numbers?fields=id,display_phone_number&limit=100`,
          { headers: bearer(token) },
        ),
      );
      if (!listed.ok) {
        return listed;
      }
      const numbers = (listed.body as { data?: PhoneNumberAnswer[] }).data ?? [];
      const listedNumber = numbers.find((number) => number.id === phoneNumberId);
      if (typeof listedNumber?.display_phone_number !== "string") {
        return { ok: true, number: null };
      }
      const read = await metaAnswerOf(
        await fetcher(
          `${graph}/${encodeURIComponent(phoneNumberId)}?fields=whatsapp_business_manager_messaging_limit`,
          { headers: bearer(token) },
        ),
      );
      if (!read.ok) {
        return read;
      }
      const limit = (read.body as PhoneNumberAnswer).whatsapp_business_manager_messaging_limit;
      return {
        ok: true,
        number: {
          displayNumber: listedNumber.display_phone_number,
          messagingLimit: typeof limit === "string" ? limit : null,
        },
      };
    },
    registerNumber(token, phoneNumberId, pin) {
      return post(`${graph}/${encodeURIComponent(phoneNumberId)}/register`, token, {
        messaging_product: "whatsapp",
        pin,
      });
    },
    subscribeApp(token, businessAccountId) {
      return post(`${graph}/${encodeURIComponent(businessAccountId)}/subscribed_apps`, token, {});
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
async function metaAnswerOf(
  response: Response,
): Promise<{ ok: true; body: unknown } | MetaRefusal> {
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
