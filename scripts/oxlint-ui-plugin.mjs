// The `ui` oxlint JS plugin: the clauses of docs/agents/style-guide.md that a
// machine can judge and `@shadcn/lint` does not. `vite.config.ts` decides which
// files it runs on; its tests are tests/lint/ui-rules.test.ts.
//
// - `no-raw-form-element`: a raw form element where a ui component exists.
// - `require-no-validate`: a `<form>` without `noValidate`.
// - `alert-structure`: an `Alert` without its title and description.

const REPLACEMENTS = new Map([
  ["button", "Button"],
  ["select", "NativeSelect"],
  ["textarea", "Textarea"],
]);

const INPUT_REPLACEMENTS = new Map([
  ["checkbox", "Checkbox"],
  ["radio", "RadioGroup"],
]);

// An attribute's value is a literal or `{literal}`; the container holds it in `expression`.
const unwrap = (value) => value?.expression ?? value;

function stringAttribute(openingElement, name) {
  const value = openingElement.attributes.find((item) => item.name?.name === name)?.value;
  const literal = unwrap(value);
  return literal?.type === "Literal" ? literal.value : undefined;
}

// The ui component to use instead of the element, or none when it is not a form
// element or is a hidden input, which has no look.
function replacementFor(openingElement) {
  const element = openingElement.name.name;
  if (element !== "input") return REPLACEMENTS.get(element);
  const type = stringAttribute(openingElement, "type");
  return type === "hidden" ? undefined : (INPUT_REPLACEMENTS.get(type) ?? "Input");
}

// What lies between a value and the attribute it is: `{…}`, and a callback that
// returns the value, directly or from a branch.
const PASS_THROUGH = new Set([
  "JSXExpressionContainer",
  "ArrowFunctionExpression",
  "FunctionExpression",
  "ReturnStatement",
  "BlockStatement",
  "IfStatement",
  "ConditionalExpression",
  "LogicalExpression",
  "ParenthesizedExpression",
]);

// The node an element is the value of: an attribute when it is one, directly or
// as what a callback returns. An element held in a variable stops at the variable.
function jsxOwner(openingElement) {
  let node = openingElement.parent.parent;
  while (PASS_THROUGH.has(node?.type)) node = node.parent;
  return node;
}

// `<Button render={<button type="submit" />}>`, or a callback returning it: Base UI
// renders the element with the component's look, so the raw element is right.
function isRenderedByComponent(openingElement) {
  const owner = jsxOwner(openingElement);
  return owner?.type === "JSXAttribute" && owner.name.name === "render";
}

// `<input type="file" className="sr-only">` under a styled `<label>`: the element
// is only the picker behind a drop zone, so it has no look to drift. A
// `not-sr-only` under any variant (`sm:`, `focus:`) shows it again.
function isVisuallyHidden(openingElement) {
  const tokens = (stringAttribute(openingElement, "className") ?? "").split(/\s+/);
  return (
    tokens.includes("sr-only") && !tokens.some((token) => token.split(":").pop() === "not-sr-only")
  );
}

// A raw element with no look of its own to drift.
const isExempt = (openingElement) =>
  isRenderedByComponent(openingElement) || isVisuallyHidden(openingElement);

const noRawFormElement = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Use the components under src/components/ui instead of raw form elements.",
    },
    messages: {
      raw: "Use {{replacement}} from #/components/ui instead of a raw <{{element}}>: the component owns the look, so a raw element drifts from it. If it is not there yet, add it with the shadcn CLI (docs/agents/shadcn.md).",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        const replacement = replacementFor(node);
        if (!replacement || isExempt(node)) return;
        const data = { element: node.name.name, replacement };
        context.report({ node, messageId: "raw", data });
      },
    };
  },
};

// `noValidate` alone is `true`; any value other than a literal `false` counts as set.
function setsNoValidate(openingElement) {
  const attribute = openingElement.attributes.find((item) => item.name?.name === "noValidate");
  if (!attribute) return false;
  const literal = unwrap(attribute.value);
  return !(literal?.type === "Literal" && literal.value === false);
}

const requireNoValidate = {
  meta: {
    type: "problem",
    docs: {
      description: "A <form> turns off the browser's validation with noValidate.",
    },
    messages: {
      missing:
        "Add noValidate to the <form>: the form validates on submit with its own Spanish messages under each field, and without it the browser's native popup runs first, in the browser's language and style, so the two fight (GOV.UK's validation pattern turns HTML5 validation off too).",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "form") return;
        if (!setsNoValidate(node)) context.report({ node, messageId: "missing" });
      },
    };
  },
};

const ALERT_PARTS = ["AlertTitle", "AlertDescription"];

// Whitespace and `{/* comments */}` render nothing.
function isBlankChild(child) {
  return (
    (child.type === "JSXText" && child.value.trim() === "") ||
    (child.type === "JSXExpressionContainer" && child.expression.type === "JSXEmptyExpression")
  );
}

// A component the alert module does not export: a wrapper, which may render the parts.
const isWrapper = (name, alertImports) =>
  name.type !== "JSXIdentifier" || (/^[A-Z]/.test(name.name) && !alertImports.has(name.name));

// A prop or a wrapper may bring the parts; text and raw elements cannot.
const hidesParts = (child, alertImports) =>
  child.type === "JSXExpressionContainer" ||
  (child.type === "JSXElement" && isWrapper(child.openingElement.name, alertImports));

// The parts the alert lacks, or none when a child hides from the rule what it brings.
function missingAlertParts(node, alertImports) {
  const children = node.children.filter((child) => !isBlankChild(child));
  if (children.some((child) => hidesParts(child, alertImports))) return [];
  const present = children.map((child) => alertImports.get(child.openingElement?.name.name));
  return ALERT_PARTS.filter((part) => !present.includes(part));
}

const alertStructure = {
  meta: {
    type: "suggestion",
    docs: {
      description: "An Alert has a title and a description.",
    },
    messages: {
      part: "Give the alert an {{part}}: the title says what is going on in a few words, the description the detail and what to do (style guide, Alerts).",
    },
    schema: [],
  },
  create(context) {
    // Each local name imported from the alert module, to its exported name.
    const alertImports = new Map();
    return {
      ImportDeclaration(node) {
        if (!node.source.value.endsWith("/components/ui/alert.tsx")) return;
        for (const specifier of node.specifiers) {
          alertImports.set(specifier.local.name, specifier.imported?.name);
        }
      },
      JSXElement(node) {
        const opening = node.openingElement;
        if (alertImports.get(opening.name.name) !== "Alert") return;
        for (const part of missingAlertParts(node, alertImports)) {
          context.report({ node: opening, messageId: "part", data: { part } });
        }
      },
    };
  },
};

export default {
  meta: { name: "ui" },
  rules: {
    "alert-structure": alertStructure,
    "no-raw-form-element": noRawFormElement,
    "require-no-validate": requireNoValidate,
  },
};
