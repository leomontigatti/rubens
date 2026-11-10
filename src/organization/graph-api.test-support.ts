import type { GraphApiSettings, SignupSettings } from "#/organization/graph-api.ts";

// Meta's Graph API faked at its HTTP boundary, for the organization object's
// tests (`docs/agents/tdd-db.md`); `organization.test-support.ts` re-exports it.

/** The access token the fake Meta expects: a test looks for it in what the object returns. */
export const metaAccessToken = "test-access-token-never-shown";
export const metaPhoneNumberId = "123456789012345";
export const metaBusinessAccountId = "102290129340398";

/** The business token Embedded Signup's code exchanges for: a test looks for it where it must not be. */
export const metaBusinessToken = "test-business-token-never-shown";

/** Embedded Signup's calls, each of which a test can have Meta refuse. */
type SignupStep = "exchange" | "numbers" | "number" | "register" | "subscribe";

function signupStepOf(request: Request): SignupStep | null {
  const { pathname } = new URL(request.url);
  if (pathname.endsWith("/oauth/access_token")) {
    return "exchange";
  }
  if (pathname.endsWith("/phone_numbers")) {
    return "numbers";
  }
  if (pathname.endsWith("/register")) {
    return "register";
  }
  if (pathname.endsWith("/subscribed_apps")) {
    return "subscribe";
  }
  const fields = new URL(request.url).searchParams.get("fields") ?? "";
  return fields.includes("messaging_limit") ? "number" : null;
}

/** Digits no other test uses, for a number's or an account's id at Meta. */
function freshMetaId() {
  return String(crypto.getRandomValues(new Uint32Array(2)).join("")).slice(0, 15);
}

/** The body of a call to a number's `/messages`: a message, or a read receipt with typing. */
interface MessageBody {
  to?: string;
  type?: string;
  text?: { body: string };
  status?: string;
  message_id?: string;
}

/** A request the object made to Meta's Graph API, as the fake received it. */
interface MetaRequest {
  method: string;
  url: string;
  authorization: string | null;
  body: unknown;
}

/**
 * Meta's Graph API at its HTTP boundary: the object's real Graph API client
 * (`src/organization/graph-api.ts`) sends to `fetch` here, so a test reads the
 * requests it made and chooses Meta's answer.
 */
class FakeMeta {
  settings: GraphApiSettings = {};
  requests: MetaRequest[] = [];
  #answer = { status: 200, body: {} as unknown };
  // Meta's own answer to a send, until a test sets another: each message gets
  // an id of its own, the first `wamid.test-message`.
  #answersSends = true;
  #sends = 0;
  #nextAnswers: { status: number; body: unknown }[] = [];
  #hold: Promise<void> | null = null;
  #heldStep: { step: SignupStep; until: Promise<void> } | null = null;
  /** The template names Meta already has on the account, which it lists page by page. */
  templatesAtMeta: string[] = [];
  /** The typing pauses the assistant waited, in milliseconds, in order (`typing-pause.test-support.ts`). */
  typingPauses: number[] = [];
  #heldPause: { index: number; until: Promise<void> } | null = null;
  /** How many templates Meta lists per page. */
  templatesPerPage = 100;
  /** The Worker's Embedded Signup settings. */
  signupSettings: SignupSettings = {};
  /** The number Embedded Signup connects, as Meta lists it in its account. */
  signupNumber = { phoneNumberId: "", businessAccountId: "", display: "", limit: "" };
  /** The business token the next signup's code exchanges for. */
  businessToken = metaBusinessToken;
  /** Meta's refusal at a step of Embedded Signup, by step. */
  signupRefusals: Partial<Record<SignupStep, { status: number; body: unknown }>> = {};

  reset() {
    this.settings = {
      WHATSAPP_ACCESS_TOKEN: metaAccessToken,
      WHATSAPP_PHONE_NUMBER_ID: metaPhoneNumberId,
      WHATSAPP_BUSINESS_ACCOUNT_ID: metaBusinessAccountId,
    };
    this.requests = [];
    this.typingPauses = [];
    this.#heldPause = null;
    this.#nextAnswers = [];
    this.#hold = null;
    this.#heldStep = null;
    this.templatesAtMeta = [];
    this.templatesPerPage = 100;
    this.signupSettings = {
      META_APP_ID: "1234567890",
      META_APP_SECRET: "test-app-secret-never-shown",
      WHATSAPP_SIGNUP_CONFIG_ID: "987654321",
    };
    this.signupNumber = {
      phoneNumberId: freshMetaId(),
      businessAccountId: freshMetaId(),
      display: "+54 9 351 555-0100",
      limit: "TIER_250",
    };
    this.signupRefusals = {};
    this.businessToken = metaBusinessToken;
    this.answerWith(200, {});
    this.#answersSends = true;
    this.#sends = 0;
  }

  #sendAnswer() {
    this.#sends += 1;
    const id = this.#sends === 1 ? "wamid.test-message" : `wamid.test-message-${this.#sends}`;
    return {
      messaging_product: "whatsapp",
      contacts: [{ input: "5491155550000", wa_id: "5491155550000" }],
      messages: [{ id }],
    };
  }

  /** Meta's next answers: `body` as JSON with `status`. */
  answerWith(status: number, body: unknown) {
    this.#answer = { status, body };
    this.#answersSends = false;
  }

  /**
   * Makes the next request wait, after it is recorded, until the returned
   * function is called: Meta answering slowly.
   */
  holdNext() {
    let release!: () => void;
    this.#hold = new Promise((resolve) => {
      release = resolve;
    });
    return release;
  }

  /**
   * Makes the request of signup's `step` wait, after it is recorded, until
   * the returned function is called.
   */
  holdSignupStep(step: SignupStep) {
    let release!: () => void;
    const until = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#heldStep = { step, until };
    return release;
  }

  /**
   * Makes the assistant's typing pause number `index` (from 0) last until the
   * returned function is called: the patient watching it type.
   */
  holdTypingPause(index: number) {
    let release!: () => void;
    const until = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#heldPause = { index, until };
    return release;
  }

  /** The assistant's typing pause of `ms`, as the object's tests run it. */
  async typingPause(ms: number) {
    this.typingPauses.push(ms);
    if (this.#heldPause?.index === this.typingPauses.length - 1) {
      await this.#heldPause.until;
    }
  }

  /** Resolves once the assistant has started `count` typing pauses. */
  async typingPaused(count: number) {
    while (this.typingPauses.length < count) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }

  /** Resolves once Meta has received `count` requests. */
  async received(count: number) {
    while (this.requests.length < count) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }

  /** The free-form texts the object sent through Meta, to whom, in order. */
  textsSent() {
    return this.requests
      .filter((request) => request.url.endsWith("/messages"))
      .map((request) => request.body as { to: string; type: string; text?: { body: string } })
      .filter((body) => body.type === "text")
      .map((body) => ({ to: body.to, text: body.text?.body }));
  }

  /**
   * What the object sent the patients, in order: each text, and each typing
   * indicator, which also marks read the patient's message it names.
   */
  sendsInOrder() {
    return this.requests
      .filter((request) => request.url.endsWith("/messages"))
      .map((request) => request.body as MessageBody)
      .map((body) =>
        body.status === "read"
          ? { typingAfter: body.message_id }
          : { to: body.to, type: body.type, text: body.text?.body },
      );
  }

  /** Meta's answer to the next request only, before those `answerWith` set; queued in order. */
  answerNextWith(status: number, body: unknown) {
    this.#nextAnswers.push({ status, body });
  }

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const body: unknown = request.method === "GET" ? null : await request.json();
    this.requests.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.get("authorization"),
      body,
    });
    const held = this.#hold;
    this.#hold = null;
    await held;
    const step = signupStepOf(request);
    if (step && this.#heldStep?.step === step) {
      await this.#heldStep.until;
    }
    if (step) {
      return this.#signupAnswer(step);
    }
    if (request.method === "GET" && new URL(request.url).pathname.endsWith("/message_templates")) {
      const url = new URL(request.url);
      const from = Number(url.searchParams.get("after") ?? 0);
      const matching = this.templatesAtMeta;
      const data = matching
        .slice(from, from + this.templatesPerPage)
        .map((name, index) => ({ name, id: `${from + index + 1}` }));
      const next = from + this.templatesPerPage;
      if (next >= matching.length) {
        return Response.json({ data });
      }
      url.searchParams.set("after", String(next));
      return Response.json({ data, paging: { cursors: { after: String(next) }, next: url.href } });
    }
    // A typing indicator always succeeds: the answers a test sets are for sends.
    if ((body as MessageBody | null)?.status === "read") {
      return Response.json({ success: true });
    }
    const answer = this.#nextAnswers.shift() ?? this.#answer;
    if (answer === this.#answer && this.#answersSends && request.url.endsWith("/messages")) {
      return Response.json(this.#sendAnswer(), { status: 200 });
    }
    return Response.json(answer.body, { status: answer.status });
  };

  #signupAnswer(step: SignupStep) {
    const refusal = this.signupRefusals[step];
    if (refusal) {
      return Response.json(refusal.body, { status: refusal.status });
    }
    const { phoneNumberId, display, limit } = this.signupNumber;
    switch (step) {
      case "exchange":
        return Response.json({ access_token: this.businessToken, token_type: "bearer" });
      case "numbers":
        return Response.json({ data: [{ id: phoneNumberId, display_phone_number: display }] });
      case "number":
        return Response.json({
          id: phoneNumberId,
          whatsapp_business_manager_messaging_limit: limit,
        });
      case "register":
      case "subscribe":
        return Response.json({ success: true });
    }
  }
}

/**
 * The Graph API a test installs, with `vi.mock(import("#/organization/graph-api.ts"), …)`
 * passing its `fetch` to the real clients, its `signupSettings` to `metaSignupFor`,
 * and its `settings` in place of the Worker's configured test number. A test
 * changes a signup setting in place: the object reads the same settings object.
 */
export const fakeMeta = new FakeMeta();
