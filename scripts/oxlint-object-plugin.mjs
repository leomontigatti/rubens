// The `object` oxlint JS plugin: the organization object's rules of
// docs/agents/coding-standards.md that a machine can judge. `vite.config.ts` turns
// them on; its tests are tests/lint/object-rules.test.ts.
//
// - `no-await-in-transaction`: an async function or an `await` inside a `.transaction(` callback,
//   which is written inline so the rule can read it.

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

// `database.transaction(…)`, `this.database.transaction(…)`.
const isTransaction = (node) =>
  node.callee.type === "MemberExpression" &&
  !node.callee.computed &&
  node.callee.property.name === "transaction";

// The inline callback a transaction runs.
function transactionCallback(node) {
  const work = isTransaction(node) ? node.arguments[0] : undefined;
  return FUNCTIONS.has(work?.type) ? work : undefined;
}

// Whether `node` sits inside a transaction's callback, at any depth.
function inTransaction(node) {
  for (let at = node.parent; at; at = at.parent) {
    const work = at.type === "CallExpression" ? transactionCallback(at) : undefined;
    if (work && work.start <= node.start && node.end <= work.end) return true;
  }
  return false;
}

const noAwaitInTransaction = {
  meta: {
    type: "problem",
    docs: {
      description: "A transaction is synchronous: no async callback and no await inside it.",
    },
    messages: {
      inline:
        "Write a transaction's callback inline, as `database.transaction((tx) => …)`, so lint can check that it is synchronous (docs/agents/coding-standards.md#underthing-rules).",
      async:
        "A transaction runs synchronously: an async callback or an `await` inside it lets another event in between the check and its write, which is what stops double booking (ADR-0003), and a write after the await is missed by the alarm. Await the outside call first, then check and write in one synchronous transaction (docs/agents/coding-standards.md#underthing-rules).",
    },
    schema: [],
  },
  create(context) {
    const report = (node) => context.report({ node, messageId: "async" });
    const checkFunction = (node) => {
      if (node.async && inTransaction(node)) report(node);
    };
    return {
      CallExpression(node) {
        if (isTransaction(node) && !transactionCallback(node)) {
          context.report({ node, messageId: "inline" });
        }
      },
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,
      FunctionDeclaration: checkFunction,
      AwaitExpression(node) {
        if (inTransaction(node)) report(node);
      },
    };
  },
};

export default {
  meta: { name: "object" },
  rules: {
    "no-await-in-transaction": noAwaitInTransaction,
  },
};
