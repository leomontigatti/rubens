// Folds an evaluation's rows into one line per candidate: the pass rate of each
// criterion, how often a whole turn passed, latency, and cost per turn.

export type Row = {
  candidate: string;
  passed: Record<string, boolean>;
  latencyMs?: number;
  cost?: number;
  error?: string;
};

export type CandidateSummary = {
  candidate: string;
  turns: number;
  errors: number;
  passRate: Record<string, number>;
  wholeTurn: number;
  latencyMs: { p50: number; p95: number };
  costPerTurn?: number;
};

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? Number.NaN;
}

export function summarize(rows: Row[], criteria: string[]): CandidateSummary[] {
  const labels = [...new Set(rows.map((row) => row.candidate))];
  return labels.map((candidate) => {
    const own = rows.filter((row) => row.candidate === candidate);
    // A turn that errored fails every criterion: an outage is the candidate's too.
    const rate = (passed: (row: Row) => boolean) => own.filter(passed).length / own.length;
    const latencies = own
      .filter((row) => !row.error && row.latencyMs !== undefined)
      .map((row) => row.latencyMs as number)
      .sort((left, right) => left - right);
    const costs = own.map((row) => row.cost).filter((cost) => cost !== undefined);
    return {
      candidate,
      turns: own.length,
      errors: own.filter((row) => row.error).length,
      passRate: Object.fromEntries(
        criteria.map((name) => [name, rate((row) => !row.error && row.passed[name] === true)]),
      ),
      wholeTurn: rate((row) => !row.error && criteria.every((name) => row.passed[name] === true)),
      latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
      costPerTurn: costs.length
        ? costs.reduce((sum, cost) => sum + cost, 0) / costs.length
        : undefined,
    };
  });
}

// The parts of a promptfoo result a row is read from.
export type Result = {
  provider: { id?: string; label?: string };
  namedScores: Record<string, number>;
  latencyMs?: number;
  response?: { latencyMs?: number } | null;
  cost?: number;
  error?: string | null;
  // promptfoo's ResultFailureReason: 1 an assertion failed, 2 the call itself
  // failed. `error` holds the failed assertions' reasons too, so only 2 is an error.
  failureReason: number;
  tokenUsage?: { prompt?: number; completion?: number };
};

export function rowOf(
  result: Result,
  criteria: string[],
  costOf: (label: string, input: number, output: number) => number | undefined = () => undefined,
): Row {
  const candidate = result.provider.label ?? result.provider.id ?? "unknown";
  const failed = result.failureReason === 2;
  const usage = result.tokenUsage;
  return {
    candidate,
    passed: Object.fromEntries(criteria.map((name) => [name, result.namedScores[name] === 1])),
    latencyMs: result.response?.latencyMs ?? result.latencyMs,
    cost: failed
      ? undefined
      : // A run saved before its candidate had rates stored a cost of 0.
        result.cost ||
        (usage ? costOf(candidate, usage.prompt ?? 0, usage.completion ?? 0) : undefined),
    error: failed ? (result.error ?? "error") : undefined,
  };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

export function asMarkdown(summaries: CandidateSummary[], criteria: string[]): string {
  const header = ["Candidate", ...criteria, "Whole turn", "p50 ms", "p95 ms", "USD/turn", "Errors"];
  const lines = summaries.map((each) => [
    each.candidate,
    ...criteria.map((name) => percent(each.passRate[name] ?? 0)),
    percent(each.wholeTurn),
    String(each.latencyMs.p50),
    String(each.latencyMs.p95),
    each.costPerTurn === undefined ? "?" : each.costPerTurn.toFixed(5),
    `${each.errors}/${each.turns}`,
  ]);
  return [header, header.map(() => "---"), ...lines]
    .map((cells) => `| ${cells.join(" | ")} |`)
    .join("\n");
}
