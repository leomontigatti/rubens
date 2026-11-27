import { describe, expect, it } from "vite-plus/test";

import { lintProbes, text } from "./lint.test-support.ts";
import type { Diagnostic } from "./lint.test-support.ts";

// The organization object's rules a machine can judge: the repo's own `object`
// plugin (scripts/oxlint-object-plugin.mjs), and the send boundary, held by
// `no-restricted-properties` in vite.config.ts.

const probes = lintProbes("object");

// The 1-based line a diagnostic starts on.
const line = (d: Diagnostic) => d.labels[0]!.span.line;

const awaits = (...files: string[]) =>
  probes.lint(...files).filter((d) => d.code === "object(no-await-in-transaction)");

const inlines = (...files: string[]) => awaits(...files).filter((d) => text(d).includes("inline"));

const sends = (...files: string[]) =>
  probes
    .lint(...files)
    .filter((d) => d.code === "eslint(no-restricted-properties)" && text(d).includes("sending.ts"));

// Each finding's line is the line its marker comment ends.
const markedLines = (source: string) =>
  [...source.split("\n").entries()]
    .filter(([, source]) => source.endsWith("// found"))
    .map(([index]) => index + 1);

const awaitedTransactions = `declare const database: {
  transaction<T>(work: (tx: { run(): number }) => T): T;
};
declare function remote(): Promise<number>;

export const asyncArrow = () =>
  database.transaction(async (tx) => tx.run()); // found

export const asyncFunction = () =>
  database.transaction(async function (tx) { // found
    return tx.run();
  });

export const awaited = () =>
  database.transaction(async (tx) => { // found
    const value = await remote(); // found
    return value + tx.run();
  });

export const nested = () =>
  database.transaction((tx) => {
    const later = async () => { // found
      await remote(); // found
    };
    void later;
    return tx.run();
  });

export const thisDatabase = {
  database,
  run() {
    return this.database.transaction(async (tx) => tx.run()); // found
  },
};
`;

const synchronousTransactions = `declare const database: {
  transaction<T>(work: (tx: { run(): number }) => T): T;
};
declare function remote(): Promise<number>;

export async function checkThenWrite() {
  const checked = await remote();
  return database.transaction((tx) => checked + tx.run());
}

export const plain = () =>
  database.transaction(function (tx) {
    return tx.run();
  });

export const unrelated = () => [1].map(async (n) => (await remote()) + n);
`;

const passedCallbacks = `declare const database: {
  transaction<T>(work: (tx: { run(): number }) => T): T;
};
declare function remote(): Promise<number>;

async function work() {
  return (await remote()) + 1;
}

export const named = () => database.transaction(work); // found
export const wrapped = () =>
  database.transaction((async () => remote()) satisfies () => Promise<number>); // found
`;

const directSends = `declare const cloud: {
  sendText(message: { to: string; text: string }): Promise<void>;
  sendTemplate(message: { to: string }): Promise<void>;
};

export const text = () => cloud.sendText({ to: "1", text: "hola" }); // found
export const template = () => cloud.sendTemplate({ to: "1" }); // found
export const { sendText } = cloud; // found
`;

describe("Organization object lint rules", { timeout: 30_000 }, () => {
  const awaitedProbe = probes.probe("awaited.ts", awaitedTransactions);

  it("reject an async callback and an await inside a transaction, nested ones included, and say why", () => {
    const found = awaits(awaitedProbe);

    expect(found.map(line)).toEqual(markedLines(awaitedTransactions));
    expect(markedLines(awaitedTransactions)).toHaveLength(7);
    expect(found.map(text).join()).toContain("double booking");
  });

  const passedProbe = probes.probe("passed.ts", passedCallbacks);

  it("reject a transaction whose callback is not written inline, which lint cannot read", () => {
    const found = inlines(passedProbe);

    expect(found.map(line)).toEqual(markedLines(passedCallbacks));
    expect(markedLines(passedCallbacks)).toHaveLength(2);
  });

  const synchronousProbe = probes.probe("synchronous.ts", synchronousTransactions);

  it("accept an await before a synchronous transaction, and async code outside one", () => {
    expect(awaits(synchronousProbe)).toEqual([]);
  });

  const object = probes.existing("src/organization/appointments.ts");

  it("accept the object's own transactions", () => {
    expect(awaits(object)).toEqual([]);
  });

  const sendsProbe = probes.probe("sends.ts", directSends);

  it("reject sendText and sendTemplate outside the sending module, and say where a send goes", () => {
    expect(sends(sendsProbe).map(line)).toEqual(markedLines(directSends));
    expect(markedLines(directSends)).toHaveLength(3);
  });

  const sending = probes.existing("src/organization/sending.ts");
  const graphApi = probes.existing("src/organization/graph-api.ts");

  it("accept the sending module's calls and the Graph API's definitions", () => {
    expect(sends(sending, graphApi)).toEqual([]);
  });
});
