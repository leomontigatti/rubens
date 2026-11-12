import { fakeMediaAnswer } from "#/dev/fake-meta-media.ts";

// Meta's Graph API answered inside the Worker, for the browser suite, which
// drives the production build with no Meta account (`playwright.config.ts`):
// a message sent is accepted with an id of its own, made-up media is served
// for the ids `fake-meta-media.ts` names, and anything else is refused as
// Meta refuses an unknown call. Nothing leaves the Worker, the access token
// included.

/** Whether the Worker answers Meta's calls itself: only with `WHATSAPP_FAKE_META` and no Clerk secret, which every deployed Worker has. */
export function fakesMeta(env: { WHATSAPP_FAKE_META?: string; CLERK_SECRET_KEY?: string }) {
  return env.WHATSAPP_FAKE_META === "true" && !env.CLERK_SECRET_KEY;
}

export const fakeMetaFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const media = await fakeMediaAnswer(request);
  if (media) {
    return media;
  }
  if (request.method === "POST" && new URL(request.url).pathname.endsWith("/messages")) {
    const { to } = (await request.json()) as { to?: string };
    return Response.json({
      messaging_product: "whatsapp",
      contacts: [{ input: to, wa_id: to }],
      messages: [{ id: `wamid.fake-${crypto.randomUUID()}` }],
    });
  }
  return Response.json(
    { error: { code: 100, message: "The fake Meta answers only messages and media" } },
    { status: 400 },
  );
};
