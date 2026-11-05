import { createFileRoute } from "@tanstack/react-router";

import { getAuth } from "../../../lib/auth";

function summary(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return {
    n: sorted.length,
    medianMs: +median.toFixed(2),
    minMs: +sorted[0]!.toFixed(2),
    maxMs: +sorted.at(-1)!.toFixed(2),
  };
}

/**
 * Times Better Auth's password hash (scrypt, pure JS in @noble/hashes) and verify
 * inside workerd. Locally `performance.now()` advances during CPU work; on a deployed
 * Worker it only moves after I/O, so this endpoint says nothing once deployed.
 */
export const Route = createFileRoute("/api/dev/bench")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!import.meta.env.DEV) return new Response(null, { status: 404 });
        const n = Number(new URL(request.url).searchParams.get("n") ?? 10);
        const { password } = await (await getAuth()).$context;
        const hashes: number[] = [];
        const verifies: number[] = [];
        let hash = "";
        for (let i = 0; i < n; i++) {
          let t = performance.now();
          hash = await password.hash("rubens-dev-password");
          hashes.push(performance.now() - t);
          t = performance.now();
          await password.verify({ hash, password: "rubens-dev-password" });
          verifies.push(performance.now() - t);
        }
        // WebCrypto PBKDF2-SHA256, the native alternative Better Auth's `emailAndPassword.password`
        // option could plug in, at 100k iterations and at OWASP's 600k.
        const pbkdf2 = async (iterations: number) => {
          const key = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode("rubens-dev-password"),
            "PBKDF2",
            false,
            ["deriveBits"],
          );
          const t = performance.now();
          await crypto.subtle.deriveBits(
            {
              name: "PBKDF2",
              hash: "SHA-256",
              salt: crypto.getRandomValues(new Uint8Array(16)),
              iterations,
            },
            key,
            256,
          );
          return performance.now() - t;
        };
        const pbkdf2100k: number[] = [];
        const pbkdf2600k: number[] = [];
        for (let i = 0; i < n; i++) {
          pbkdf2100k.push(await pbkdf2(100_000));
          pbkdf2600k.push(await pbkdf2(600_000));
        }
        // A busy loop of known length, to show whether the clock advances during CPU work here.
        const t = performance.now();
        let x = 0;
        for (let i = 0; i < 5e7; i++) x += i;
        const busyLoopMs = performance.now() - t;
        return Response.json({
          hash: summary(hashes),
          verify: summary(verifies),
          pbkdf2_100k: summary(pbkdf2100k),
          pbkdf2_600k: summary(pbkdf2600k),
          busyLoopMs,
          x: x > 0,
        });
      },
    },
  },
});
