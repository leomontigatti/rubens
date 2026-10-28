import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { type Label, labelFilePath, readLabelFile } from "./labels.ts";

// Push `.github/labels.json` to the repo's labels.
//
// Upsert only. A label in the repo that the file does not hold is reported,
// never deleted: deleting a label strips it from every issue that carries it,
// closed ones included, and that is a decision for a person, not a sync.
// `--dry-run` prints the plan and changes nothing.

type LabelSyncPlan = {
  create: Label[];
  /** Live labels the file does not hold. Reported, never deleted. */
  extra: string[];
  update: Label[];
};

function sameLabel(a: Label, b: Label): boolean {
  return a.color.toLowerCase() === b.color.toLowerCase() && a.description === b.description;
}

export function planLabelSync(input: { desired: Label[]; live: Label[] }): LabelSyncPlan {
  const live = new Map(input.live.map((label) => [label.name, label]));
  const desired = new Set(input.desired.map((label) => label.name));

  return {
    create: input.desired.filter((label) => !live.has(label.name)),
    extra: input.live.map((label) => label.name).filter((name) => !desired.has(name)),
    update: input.desired.filter((label) => {
      const current = live.get(label.name);
      return current !== undefined && !sameLabel(current, label);
    }),
  };
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8" });
}

function runLabelsSync(dryRun: boolean): void {
  const plan = planLabelSync({
    desired: readLabelFile(),
    live: JSON.parse(
      gh(["label", "list", "--limit", "500", "--json", "name,color,description"]),
    ) as Label[],
  });

  for (const [verb, labels] of [
    ["create", plan.create],
    ["update", plan.update],
  ] as const) {
    for (const label of labels) {
      console.log(`${dryRun ? "would " : ""}${verb} ${label.name}`);
      if (!dryRun) {
        gh([
          "label",
          "create",
          label.name,
          "--color",
          label.color,
          "--description",
          label.description,
          "--force",
        ]);
      }
    }
  }

  if (plan.create.length === 0 && plan.update.length === 0) {
    console.log(`The repo's labels already match ${labelFilePath}.`);
  }
  if (plan.extra.length > 0) {
    console.log(`In the repo but not in ${labelFilePath} (left alone): ${plan.extra.join(", ")}`);
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  try {
    runLabelsSync(process.argv.includes("--dry-run"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
