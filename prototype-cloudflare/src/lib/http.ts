/** Reads a JSON or form body into a plain object. */
export async function readBody(
  request: Request,
): Promise<Record<string, string | number | boolean | undefined>> {
  if (request.headers.get("content-type")?.includes("application/json")) return request.json();
  return Object.fromEntries((await request.formData()).entries()) as Record<string, string>;
}

/** JSON for scripts, a redirect back with the result for the plain HTML forms. */
export function answer(
  request: Request,
  back: unknown,
  result: { ok: boolean; reason?: string },
  status = 200,
) {
  if (typeof back === "string" && back.startsWith("/")) {
    const url = new URL(back, request.url);
    url.searchParams.set("result", result.ok ? "ok" : (result.reason ?? "error"));
    return new Response(null, { status: 303, headers: { location: url.pathname + url.search } });
  }
  return Response.json(result, {
    status: result.ok ? status : result.reason === "timeTaken" ? 409 : 403,
  });
}

export const unauthenticated = () =>
  Response.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
