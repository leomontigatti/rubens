// The `tests` oxlint JS plugin: the testing rules of docs/agents/coding-standards.md
// that a machine can judge. `vite.config.ts` turns them on for test code only; its
// tests are tests/lint/test-rules.test.ts.
//
// - `no-sleep-poll`: a timer awaited in a loop, polling a state the test could await.

const TIMER_MODULES = new Set(["node:timers/promises", "timers/promises"]);

const LOOPS = new Set([
  "WhileStatement",
  "DoWhileStatement",
  "ForStatement",
  "ForOfStatement",
  "ForInStatement",
]);

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

const isNamed = (node, name) => node?.type === "Identifier" && node.name === name;

const isMember = (node, object, property) =>
  node?.type === "MemberExpression" &&
  isNamed(node.object, object) &&
  isNamed(node.property, property);

// Whether a node holds a call that `matches`.
function hasCall(node, matches) {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((one) => hasCall(one, matches));
  if (node.type === "CallExpression" && matches(node)) return true;
  return Object.entries(node).some(
    ([key, value]) =>
      key !== "parent" && value && typeof value === "object" && hasCall(value, matches),
  );
}

const isSetTimeout = (callee) =>
  isNamed(callee, "setTimeout") || isMember(callee, "globalThis", "setTimeout");

// Whether a promise executor settles on a timer: it hands `setTimeout` its
// `resolve`, or a callback that calls it. A timer that only cleans up after an
// event settles nothing.
function settlesOnTimer(executor) {
  const resolve = executor.params[0];
  if (resolve?.type !== "Identifier") return false;
  // `resolve` itself, or a method on it: `resolve.bind(…)` handed over, `resolve.call(…)` called.
  const isResolve = (node) =>
    isNamed(node, resolve.name) ||
    (node?.type === "MemberExpression" && isNamed(node.object, resolve.name)) ||
    (node?.type === "CallExpression" && isResolve(node.callee));
  const callsResolve = (node) =>
    FUNCTIONS.has(node?.type) && hasCall(node.body, (call) => isResolve(call.callee));
  return hasCall(
    executor.body,
    (call) =>
      isSetTimeout(call.callee) &&
      (isResolve(call.arguments[0]) || callsResolve(call.arguments[0])),
  );
}

// Whether a loop runs again around `node`: it sits in the loop with no function between.
function inLoop(node) {
  for (let at = node.parent; at && !FUNCTIONS.has(at.type); at = at.parent) {
    if (LOOPS.has(at.type)) return true;
  }
  return false;
}

const noSleepPoll = {
  meta: {
    type: "problem",
    docs: {
      description: "A test awaits what the code under test does, not a timer in a loop.",
    },
    messages: {
      poll: "Do not poll by awaiting a timer in a loop: it races the code under test, and a slow run reads a state that has not arrived yet. Await a signal the code or its fake emits instead, a promise resolved when the event happens (a fake's method that resolves once its record reaches a count, as `scriptedModel.turnsStarted` and `fakeMeta.received` do).",
    },
    schema: [],
  },
  create(context) {
    // Local names that are `setTimeout` and `scheduler` from timers/promises, and
    // namespaces of that module. `scheduler` is also the global one Workers and Node have.
    const sleeps = new Set();
    const schedulers = new Set(["scheduler"]);
    const namespaces = new Set();

    // `scheduler.wait`, or `timers.scheduler.wait` through a namespace.
    const isScheduler = (node) =>
      (node.type === "Identifier" && schedulers.has(node.name)) ||
      (node.type === "MemberExpression" &&
        namespaces.has(node.object.name) &&
        isNamed(node.property, "scheduler"));

    const isTimerPromise = (node) => {
      if (node?.type === "NewExpression" && isNamed(node.callee, "Promise")) {
        const executor = node.arguments[0];
        return FUNCTIONS.has(executor?.type) && settlesOnTimer(executor);
      }
      if (node?.type !== "CallExpression") return false;
      const { callee } = node;
      if (callee.type === "Identifier") return sleeps.has(callee.name);
      if (callee.type !== "MemberExpression") return false;
      return (
        (isNamed(callee.property, "wait") && isScheduler(callee.object)) ||
        (namespaces.has(callee.object.name) && isNamed(callee.property, "setTimeout"))
      );
    };

    return {
      ImportDeclaration(node) {
        if (!TIMER_MODULES.has(node.source.value)) return;
        for (const one of node.specifiers) {
          if (one.type === "ImportNamespaceSpecifier") namespaces.add(one.local.name);
          if (one.type !== "ImportSpecifier") continue;
          if (one.imported.name === "setTimeout") sleeps.add(one.local.name);
          if (one.imported.name === "scheduler") schedulers.add(one.local.name);
        }
      },
      AwaitExpression(node) {
        if (isTimerPromise(node.argument) && inLoop(node)) {
          context.report({ node, messageId: "poll" });
        }
      },
    };
  },
};

export default {
  meta: { name: "tests" },
  rules: {
    "no-sleep-poll": noSleepPoll,
  },
};
