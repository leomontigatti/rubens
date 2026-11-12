// The `ui` oxlint JS plugin: the clauses of docs/agents/style-guide.md that a
// machine can judge and `@shadcn/lint` does not. `vite.config.ts` decides which
// files it runs on; its tests are tests/lint/ui-rules.test.ts.
//
// - `no-raw-form-element`: a raw form element where a ui component exists.
// - `require-no-validate`: a `<form>` without `noValidate`.
// - `require-post-method`: a `<form>` without `method="post"`.
// - `alert-structure`: an `Alert` without its title and description.
// - `no-raw-page-title`: an `<h1>` where `PageHeader` belongs.
// - `no-bare-label`: `Label` where `FieldLabel` belongs.
// - `no-raw-table`: a `<table>` or the ui `Table` where `DataTable` belongs.
// - `no-raw-empty`: the ui `Empty` where `EmptyState` belongs.
// - `no-raw-form`: a `<form>` where `FormPage` belongs.
// - `no-uncontrolled-input`: a default value where `useAppForm` holds the field.
// - `no-raw-date-format`: a date or a time written for a person outside `src/lib/dates.ts`.

const REPLACEMENTS = new Map([
  ["button", "Button"],
  ["fieldset", "FieldSet"],
  ["label", "FieldLabel"],
  ["legend", "FieldLegend"],
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

const requirePostMethod = {
  meta: {
    type: "problem",
    docs: {
      description:
        'A <form> takes method="post", so a native submit keeps its fields out of the URL.',
    },
    messages: {
      missing:
        'Add method="post" to the <form>: submitted before the page hydrates, the browser sends it on its own, and without it as a GET, which puts every field, a password included, in the URL, the history and any access log.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "form") return;
        if (stringAttribute(node, "method")?.toLowerCase() !== "post") {
          context.report({ node, messageId: "missing" });
        }
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

// A prop, a fragment or a wrapper may bring the parts. Text and raw elements
// cannot: the parts are the alert's direct children, placed by its grid.
const hidesParts = (child, alertImports) =>
  child.type === "JSXExpressionContainer" ||
  child.type === "JSXFragment" ||
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

const noRawPageTitle = {
  meta: {
    type: "suggestion",
    docs: {
      description: "A page's title comes from PageHeader.",
    },
    messages: {
      title:
        "Use PageHeader for the page's title: it keeps the title's size, the link to the page above and the actions in one place on every screen (style guide, Page shell).",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type === "JSXIdentifier" && node.name.name === "h1") {
          context.report({ node, messageId: "title" });
        }
      },
    };
  },
};

const noBareLabel = {
  meta: {
    type: "suggestion",
    docs: {
      description: "A field's label comes from the Field kit.",
    },
    messages: {
      label:
        "Use Field and FieldLabel from #/components/ui/field.tsx instead of Label: Field owns the spacing between a label, its input and its hint, so a hand-made wrapper drifts from it (style guide, Forms).",
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value.endsWith("/components/ui/label.tsx")) {
          context.report({ node, messageId: "label" });
        }
      },
    };
  },
};

const noRawTable = {
  meta: {
    type: "problem",
    docs: {
      description: "A list is a DataTable.",
    },
    messages: {
      table:
        "Use DataTable from #/components/data-table.tsx: it owns the toolbar, the 40 px rows and the pager, so a hand-made table drifts from it (style guide, Tables).",
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value.endsWith("/components/ui/table.tsx")) {
          context.report({ node, messageId: "table" });
        }
      },
      JSXOpeningElement(node) {
        if (node.name.name === "table") {
          context.report({ node, messageId: "table" });
        }
      },
    };
  },
};

const noRawEmpty = {
  meta: {
    type: "problem",
    docs: {
      description: "A page or a list with nothing to show is an EmptyState.",
    },
    messages: {
      empty:
        "Use EmptyState from #/components/empty-state.tsx: it owns the icon, the description and the action buttons, so a hand-made empty state drifts from it (style guide, Empty states).",
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value.endsWith("/components/ui/empty.tsx")) {
          context.report({ node, messageId: "empty" });
        }
      },
    };
  },
};

const noRawForm = {
  meta: {
    type: "problem",
    docs: {
      description: "A create or an edit is a FormPage.",
    },
    messages: {
      form: "Use FormPage from #/components/form-page.tsx: it owns the actions, the spinner and the question before leaving with changes, so a hand-made form drifts from it (style guide, Form pages).",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.name === "form") {
          context.report({ node, messageId: "form" });
        }
      },
    };
  },
};

const noUncontrolledInput = {
  meta: {
    type: "problem",
    docs: {
      description: "A form's values live in useAppForm.",
    },
    messages: {
      input:
        "Use a field from useAppForm in #/components/app-form.tsx: the form then knows what changed, so Descartar cambios and the question before leaving work (style guide, Forms).",
    },
    schema: [],
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name.name === "defaultValue" || node.name.name === "defaultChecked") {
          context.report({ node, messageId: "input" });
        }
      },
    };
  },
};

// date-fns' functions that write a date by a pattern.
const PATTERN_FORMATS = new Set(["format", "formatDate", "lightFormat"]);

// A pattern a date is stored or compared in, never shown: ISO from the year on
// (`yyyy-MM-dd`, `yyyy-MM-dd'T'HH:mm`), or one number alone (`m`).
const isMachinePattern = (pattern) =>
  pattern.startsWith("yyyy-MM") || /^(yyyy|MM?|dd?|HH?|mm?|ss?)$/.test(pattern);

// The patterns a call's argument can be, each as its node and text: a string,
// a template without expressions, or either branch of a condition. Anything
// else is not judged.
function patternsOf(node) {
  if (node?.type === "ConditionalExpression") {
    return [...patternsOf(node.consequent), ...patternsOf(node.alternate)];
  }
  if (node?.type === "Literal" && typeof node.value === "string") {
    return [{ node, text: node.value }];
  }
  const plainTemplate = node?.type === "TemplateLiteral" && node.expressions.length === 0;
  return plainTemplate ? [{ node, text: node.quasis[0].value.cooked }] : [];
}

// `Intl.DateTimeFormat(locale, { timeZone })` writes nothing a person reads
// itself: it is how a zone's name is checked.
function asksOnlyZone(options) {
  return (
    options?.type === "ObjectExpression" &&
    options.properties.length > 0 &&
    options.properties.every(
      (property) => property.type === "Property" && property.key?.name === "timeZone",
    )
  );
}

const isIntlDateTimeFormat = (callee) =>
  callee?.type === "MemberExpression" &&
  callee.object?.name === "Intl" &&
  callee.property?.name === "DateTimeFormat";

const LOCALE_STRINGS = new Set(["toLocaleDateString", "toLocaleTimeString"]);

const noRawDateFormat = {
  meta: {
    type: "problem",
    docs: {
      description: "A date or a time a person reads is written by src/lib/dates.ts.",
    },
    messages: {
      format:
        "Write a date or a time a person reads with src/lib/dates.ts (formatDate, formatTime, formatDateTime, formatDay, formatDayHeading, formatLocalDate, formatMonth): every screen then writes it the same way, in the zone passed. A pattern a date is stored in, such as yyyy-MM-dd, is fine here.",
    },
    schema: [],
  },
  create(context) {
    // Local names of date-fns' pattern functions, as this file imports them.
    const formats = new Set();
    const report = (node) => context.report({ node, messageId: "format" });
    const shownPatterns = (node) =>
      node.callee?.type === "Identifier" && formats.has(node.callee.name)
        ? patternsOf(node.arguments[1]).filter((pattern) => !isMachinePattern(pattern.text))
        : [];
    const writesForPerson = (node) =>
      (isIntlDateTimeFormat(node.callee) && !asksOnlyZone(node.arguments[1])) ||
      LOCALE_STRINGS.has(node.callee?.property?.name);
    const check = (node) => {
      shownPatterns(node).forEach((pattern) => report(pattern.node));
      if (writesForPerson(node)) report(node);
    };
    return {
      ImportDeclaration(node) {
        if (node.source.value !== "date-fns") return;
        node.specifiers
          .filter((one) => one.type === "ImportSpecifier" && PATTERN_FORMATS.has(one.imported.name))
          .forEach((one) => formats.add(one.local.name));
      },
      CallExpression: check,
      NewExpression: check,
    };
  },
};

export default {
  meta: { name: "ui" },
  rules: {
    "alert-structure": alertStructure,
    "no-bare-label": noBareLabel,
    "no-raw-date-format": noRawDateFormat,
    "no-raw-form": noRawForm,
    "no-raw-empty": noRawEmpty,
    "no-raw-form-element": noRawFormElement,
    "no-raw-page-title": noRawPageTitle,
    "no-raw-table": noRawTable,
    "no-uncontrolled-input": noUncontrolledInput,
    "require-no-validate": requireNoValidate,
    "require-post-method": requirePostMethod,
  },
};
