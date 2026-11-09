// The models under evaluation, each through TanStack AI's adapter for its
// provider (ADR-0006). Rates are USD per million tokens, input and output, from
// each provider's pricing page, read on 2026-11-07; Workers AI's from its model
// catalog, read on 2026-11-08.

import type { AnyTextAdapter } from "@tanstack/ai";
import { anthropicText } from "@tanstack/ai-anthropic";
import { createCloudflareText } from "@tanstack/ai-cloudflare";
import { geminiText } from "@tanstack/ai-gemini";
import { openaiText } from "@tanstack/ai-openai";

export type Provider = "openai" | "gemini" | "anthropic" | "cloudflare";

export type Candidate = {
  label: string;
  provider: Provider;
  model: string;
  // `cachedInput`: the rate for input tokens the provider served from its prompt
  // cache, when it charges them less; otherwise they cost the input rate.
  rates?: { input: number; cachedInput?: number; output: number };
  // Reasoning effort, for a model whose default is not the one to compare:
  // GLM defaults to `max`, slow and long enough to hit the output cap.
  reasoning?: "low" | "high";
};

export const candidates: Candidate[] = [
  {
    label: "gpt-5.4-nano",
    provider: "openai",
    model: "gpt-5.4-nano",
    rates: { input: 0.2, output: 1.25 },
  },
  {
    label: "gpt-5.4-mini",
    provider: "openai",
    model: "gpt-5.4-mini",
    rates: { input: 0.75, output: 4.5 },
  },
  {
    label: "gemini-3.1-flash-lite",
    provider: "gemini",
    model: "gemini-3.1-flash-lite",
    rates: { input: 0.25, output: 1.5 },
  },
  {
    label: "claude-haiku-5-5",
    provider: "anthropic",
    model: "claude-haiku-5-5",
    rates: { input: 0.1, output: 0.5 },
  },
  {
    label: "gpt-oss-120b",
    provider: "cloudflare",
    model: "@cf/openai/gpt-oss-120b",
    rates: { input: 0.35, output: 0.75 },
  },
  // Workers Paid only. Workers AI plans to retire the flash model on 2026-11-20.
  {
    label: "glm-5.3-flash",
    provider: "cloudflare",
    model: "@cf/zai-org/glm-5.3-flash",
    rates: { input: 0.15, cachedInput: 0.03, output: 0.5 },
    reasoning: "low",
  },
  {
    label: "glm-5.3",
    provider: "cloudflare",
    model: "@cf/zai-org/glm-5.3",
    rates: { input: 1.4, cachedInput: 0.26, output: 4.4 },
    reasoning: "low",
  },
];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} to run this candidate`);
  return value;
}

// The factories type their model ids as each provider's known list; the
// candidate's id is passed through as the provider names it.
export function textAdapter(candidate: Candidate): AnyTextAdapter {
  switch (candidate.provider) {
    case "openai":
      required("OPENAI_API_KEY");
      return openaiText(candidate.model as Parameters<typeof openaiText>[0]);
    case "gemini":
      return geminiText(candidate.model as Parameters<typeof geminiText>[0]);
    case "anthropic":
      required("ANTHROPIC_API_KEY");
      return anthropicText(candidate.model as Parameters<typeof anthropicText>[0]);
    case "cloudflare":
      return createCloudflareText(candidate.model, {
        accountId: required("CLOUDFLARE_ACCOUNT_ID"),
        apiKey: required("CLOUDFLARE_API_TOKEN"),
      });
  }
}

// Deterministic where the provider allows it, so a rerun reads the same. Claude
// Haiku 5.5 refuses `temperature` outright. Workers AI's default output cap cuts
// a reasoning model off mid-thought, which would score the platform's default,
// not the model; the cap counts reasoning tokens too.
export function modelOptions(candidate: Candidate): Record<string, unknown> {
  if (candidate.provider === "anthropic") return {};
  if (candidate.provider === "cloudflare") return { temperature: 0, max_tokens: 16384 };
  return { temperature: 0 };
}

export function findCandidate(label: string): Candidate {
  const found = candidates.find((each) => each.label === label);
  if (!found) throw new Error(`No candidate ${label}`);
  return found;
}
