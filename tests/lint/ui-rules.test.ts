import { describe, expect, it } from "vite-plus/test";

import { lintProbes, text } from "./lint.test-support.ts";

// The style guide's rules that a machine can judge: `@shadcn/lint`'s rules and
// the repo's own `ui` plugin (scripts/oxlint-ui-plugin.mjs).

const { probe, existing, lint } = lintProbes("ui");

const codes = (...files: string[]) => lint(...files).map((d) => d.code);

// A rule of its own: `<form>` is its own finding in the probes about something else.
const besidesRawForm = (found: string[]) => found.filter((code) => code !== "ui(no-raw-form)");

const button = `import { Button } from "#/components/ui/button.tsx";\n\n`;
const alert = `import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";\n\n`;

// The one type-aware `vp lint` runs inside the first test, slower cold.
describe("UI lint rules", { timeout: 30_000 }, () => {
  const restyleProbe = probe(
    "restyle.tsx",
    `${button}export const Save = () => <Button className="p-4 rounded-full">Guardar</Button>;\n`,
  );

  it("reject restyling a ui component, and point at the style guide", () => {
    const found = lint(restyleProbe).filter((d) => d.code.includes("no-restyle"));

    expect(found.length).toBeGreaterThan(0);
    expect(found.map(text).join()).toContain("style-guide.md");
  });

  const titleProbe = probe("title.tsx", `export const Title = () => <h1>Sedes</h1>;\n`);

  it("reject a raw page title", () => {
    expect(codes(titleProbe).filter((code) => code.includes("no-raw-page-title")).length).toBe(1);
  });

  const bareLabelProbe = probe(
    "bare-label.tsx",
    `import { Label } from "#/components/ui/label.tsx";\n\nexport const Name = () => <Label htmlFor="name">Nombre</Label>;\n`,
  );

  it("reject a bare Label: a field's label comes from Field", () => {
    expect(codes(bareLabelProbe).filter((code) => code.includes("no-bare-label")).length).toBe(1);
  });

  const rawFieldProbe = probe(
    "raw-field.tsx",
    `export const Days = () => (\n  <fieldset>\n    <legend>Días</legend>\n    <label htmlFor="monday">Lunes</label>\n  </fieldset>\n);\n`,
  );

  it("reject a raw label, fieldset or legend", () => {
    expect(codes(rawFieldProbe).filter((code) => code.includes("no-raw-form-element")).length).toBe(
      3,
    );
  });

  const rawTableProbe = probe(
    "raw-table.tsx",
    `import { Table } from "#/components/ui/table.tsx";\n\nexport const Lists = () => (\n  <>\n    <Table />\n    <table />\n  </>\n);\n`,
  );

  it("reject a table outside DataTable, and say where the list belongs", () => {
    const found = lint(rawTableProbe).filter((d) => d.code.includes("no-raw-table"));

    expect(found).toHaveLength(2);
    expect(found.map(text).join()).toContain("DataTable");
  });

  const rawEmptyProbe = probe(
    "raw-empty.tsx",
    `import { Empty, EmptyTitle } from "#/components/ui/empty.tsx";\n\nexport const Nothing = () => (\n  <Empty>\n    <EmptyTitle>Nada</EmptyTitle>\n  </Empty>\n);\n`,
  );

  it("reject an empty state outside EmptyState, and say where it belongs", () => {
    const found = lint(rawEmptyProbe).filter((d) => d.code.includes("no-raw-empty"));

    expect(found).toHaveLength(1);
    expect(found.map(text).join()).toContain("EmptyState");
  });

  it("allow the ui Empty in EmptyState, the one place an empty state is drawn", () => {
    expect(codes(existing("src/components/empty-state.tsx"))).not.toContain("ui(no-raw-empty)");
  });

  const rawFormProbe = probe("raw-form.tsx", `export const Inline = () => <form noValidate />;\n`);

  it("reject a form outside FormPage, and say where it belongs", () => {
    const found = lint(rawFormProbe).filter((d) => d.code.includes("no-raw-form"));

    expect(found.filter((d) => !d.code.includes("no-raw-form-element"))).toHaveLength(1);
    expect(found.map(text).join()).toContain("FormPage");
  });

  const uncontrolledProbe = probe(
    "uncontrolled.tsx",
    `import { Input } from "#/components/ui/input.tsx";\n\nexport const Name = () => <Input defaultValue="Ana" />;\n`,
  );

  it("reject an uncontrolled input: a form's values live in useAppForm", () => {
    const found = lint(uncontrolledProbe).filter((d) => d.code.includes("no-uncontrolled-input"));

    expect(found).toHaveLength(1);
    expect(found.map(text).join()).toContain("useAppForm");
  });

  const layoutProbe = probe(
    "layout.tsx",
    `${button}export const Save = () => <Button className="mt-4 w-full">Guardar</Button>;\n`,
  );

  it("allow layout classes on a ui component", () => {
    expect(codes(layoutProbe)).toEqual([]);
  });

  const card = `import { CardContent } from "#/components/ui/card.tsx";\n\n`;
  const gap = probe(
    "card-gap.tsx",
    `${card}export const Body = () => <CardContent className="flex flex-col gap-4" />;\n`,
  );
  const padding = probe(
    "card-padding.tsx",
    `${card}export const Body = () => <CardContent className="p-8" />;\n`,
  );

  it("let a card's content lay out its children, but not change its padding", () => {
    expect(codes(gap)).toEqual([]);
    expect(codes(padding).join()).toContain("no-restyle");
  });

  const offThemeProbe = probe(
    "off-theme.tsx",
    `export const Box = () => (\n  <>\n    <div className="bg-red-500" />\n    <div className="p-[13px]" />\n    <div style={{ color: "red" }} />\n  </>\n);\n`,
  );

  it("reject palette colours, arbitrary values and inline styles", () => {
    const found = codes(offThemeProbe).join();

    expect(found).toContain("no-raw-colors");
    expect(found).toContain("no-arbitrary-values");
    expect(found).toContain("no-inline-styles");
  });

  const onThemeProbe = probe(
    "on-theme.tsx",
    `export const Box = () => <div className="bg-muted text-muted-foreground p-4" />;\n`,
  );

  it("allow theme tokens", () => {
    expect(codes(onThemeProbe)).toEqual([]);
  });

  const rawElementsProbe = probe(
    "raw-elements.tsx",
    `export const Form = () => (\n  <form>\n    <input name="email" />\n    <input type="checkbox" name="active" />\n    <select name="office" />\n    <textarea name="notes" />\n    <button type="submit">Guardar</button>\n  </form>\n);\n`,
  );

  it("reject a raw form element outside src/components/ui, naming the component to use", () => {
    const found = lint(rawElementsProbe).filter((d) => d.code.includes("no-raw-form-element"));

    expect(found).toHaveLength(5);
    const messages = found.map(text).join("\n");
    for (const component of ["Input", "Checkbox", "NativeSelect", "Textarea", "Button"]) {
      expect(messages).toContain(component);
    }
  });

  const rawNestedInRenderProbe = probe(
    "raw-nested-in-render.tsx",
    `${button}export const Back = () => (\n  <Button\n    render={(props) => {\n      const child = <button type="button" />;\n      return <a {...props}>{child}</a>;\n    }}\n  />\n);\n`,
  );

  it("reject a raw element nested inside what a render callback returns", () => {
    expect(codes(rawNestedInRenderProbe)).toEqual(["ui(no-raw-form-element)"]);
  });

  const rawAllowedProbe = probe(
    "raw-allowed.tsx",
    `${button}export const Form = () => (\n  <form method="post" noValidate>\n    <input type="hidden" name="id" value="1" />\n    <input type="file" className="sr-only" />\n    <Button render={<button type="submit" />}>Guardar</Button>\n    <Button render={(props) => <button {...props} />}>Enviar</Button>\n    <Button\n      render={(props) => {\n        return <button {...props} />;\n      }}\n    >\n      Volver\n    </Button>\n    <Button\n      render={(props) => {\n        if (props.className) return <button {...props} />;\n        return <a {...props} />;\n      }}\n    >\n      Ir\n    </Button>\n  </form>\n);\n`,
  );

  it("allow a raw element that has no look: hidden, visually hidden, or rendered by a ui component", () => {
    expect(besidesRawForm(codes(rawAllowedProbe))).toEqual([]);
  });

  const formValidatesProbe = probe(
    "form-validates.tsx",
    `export const Forms = () => (\n  <>\n    <form />\n    <form noValidate={false} />\n  </>\n);\n`,
  );

  it("reject a form that lets the browser validate, and say why", () => {
    const found = lint(formValidatesProbe).filter((d) => d.code.includes("require-no-validate"));

    expect(found).toHaveLength(2);
    expect(found.map(text).join()).toContain("Spanish");
  });

  const formNoValidateProbe = probe(
    "form-no-validate.tsx",
    `export const Forms = () => (\n  <>\n    <form method="post" noValidate />\n    <form method="post" noValidate={true} />\n  </>\n);\n`,
  );

  it("allow a form that turns the browser's validation off", () => {
    expect(besidesRawForm(codes(formNoValidateProbe))).toEqual([]);
  });

  const formGetsProbe = probe(
    "form-gets.tsx",
    `export const Forms = () => (\n  <>\n    <form noValidate />\n    <form method="get" noValidate />\n  </>\n);\n`,
  );

  it("reject a form a native submit would send as a GET", () => {
    const found = lint(formGetsProbe).filter((d) => d.code.includes("require-post-method"));

    expect(found).toHaveLength(2);
  });

  const formPostsProbe = probe(
    "form-posts.tsx",
    `export const Forms = () => (\n  <>\n    <form method="post" noValidate />\n    <form method={"post"} noValidate />\n  </>\n);\n`,
  );

  it("allow a form that posts", () => {
    expect(besidesRawForm(codes(formPostsProbe))).toEqual([]);
  });

  const alertPartsProbe = probe(
    "alert-parts.tsx",
    `${alert}export const Notices = () => (\n  <>\n    <Alert variant="info">\n      <AlertDescription>Sin título.</AlertDescription>\n    </Alert>\n    <Alert variant="info">\n      <AlertTitle>Sin descripción</AlertTitle>\n    </Alert>\n  </>\n);\n`,
  );

  it("reject an alert without a title or a description, and say what each is for", () => {
    const found = lint(alertPartsProbe).filter((d) => d.code.includes("alert-structure"));

    expect(found).toHaveLength(2);
  });

  const alertUnstructuredProbe = probe(
    "alert-unstructured.tsx",
    `import { Alert, AlertAction, AlertTitle } from "#/components/ui/alert.tsx";\n\nexport const Notices = () => (\n  <>\n    <Alert variant="info">Texto</Alert>\n    <Alert variant="info">\n      <p>Texto</p>\n    </Alert>\n    <Alert variant="info">\n      <AlertTitle>Título</AlertTitle>\n      <AlertAction />\n    </Alert>\n  </>\n);\n`,
  );

  it("reject an alert of plain text or raw elements, beside an action too", () => {
    const found = lint(alertUnstructuredProbe).filter((d) => d.code.includes("alert-structure"));

    expect(found).toHaveLength(5);
  });

  const alertImportsProbe = probe(
    "alert-imports.tsx",
    `import { Alert as Notice } from "#/components/ui/alert.tsx";\nimport { AlertDescription as Body } from "#/components/ui/alert.tsx";\n\nexport const Lacking = () => (\n  <Notice variant="info">\n    <Body>Detalle.</Body>\n  </Notice>\n);\n`,
  );

  it("follow the alert through split and renamed imports", () => {
    const found = lint(alertImportsProbe).filter((d) => d.code.includes("alert-structure"));

    expect(found).toHaveLength(1);
  });

  const alertCompleteProbe = probe(
    "alert-complete.tsx",
    `${alert}export const Notices = ({ body }: { body: React.ReactNode }) => (\n  <>\n    <Alert variant="info">\n      <AlertTitle>Título</AlertTitle>\n      <AlertDescription>Detalle.</AlertDescription>\n    </Alert>\n    <Alert variant="warning">{body}</Alert>\n    <Alert variant="warning">\n      <Wrapper />\n    </Alert>\n    <Alert variant="info">\n      <>\n        <AlertTitle>Título</AlertTitle>\n        <AlertDescription>Detalle.</AlertDescription>\n      </>\n    </Alert>\n  </>\n);\n\nconst Wrapper = () => null;\n`,
  );

  it("allow an alert with both parts, and one whose parts it cannot see", () => {
    expect(codes(alertCompleteProbe)).toEqual([]);
  });

  const dateFormat = (found: string[]) =>
    found.filter((code) => code.includes("no-raw-date-format"));

  const displayPatternsProbe = probe(
    "display-patterns.ts",
    `import { tz } from "@date-fns/tz";\nimport { format, format as write } from "date-fns";\n\nconst zone = { in: tz("UTC") };\nexport const stamp = (at: Date) => format(at, "dd/MM/yyyy HH:mm", zone);\nexport const clock = (at: Date) => write(at, "HH:mm", zone);\nexport const day = (at: Date, long: boolean) => format(at, long ? "EEEE d 'de' MMMM" : \`d/M\`, zone);\n`,
  );

  it("reject a date-fns format a person reads, renamed or in a branch, and point at dates.ts", () => {
    const found = lint(displayPatternsProbe).filter((d) => d.code.includes("no-raw-date-format"));

    expect(found).toHaveLength(4);
    expect(found.map(text).join()).toContain("src/lib/dates.ts");
  });

  const machinePatternsProbe = probe(
    "machine-patterns.ts",
    `import { tz } from "@date-fns/tz";\nimport { format } from "date-fns";\n\nconst zone = { in: tz("UTC") };\nexport const key = (at: Date) => format(at, "yyyy-MM-dd", zone);\nexport const local = (at: Date) => format(at, "yyyy-MM-dd'T'HH:mm", zone);\nexport const minute = (at: Date) => Number(format(at, "m", zone));\nconst own = { format: (at: Date, pattern: string) => pattern + at.getTime() };\nexport const other = (at: Date) => own.format(at, "dd/MM/yyyy");\n`,
  );

  it("allow the machine formats a date is stored or compared in", () => {
    expect(dateFormat(codes(machinePatternsProbe))).toEqual([]);
  });

  const intlProbe = probe(
    "intl-dates.ts",
    `export const short = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeZone: "UTC" });\nexport const plain = Intl.DateTimeFormat("es-AR");\nexport const day = (at: Date) => at.toLocaleDateString("es-AR");\nexport const time = (at: Date) => at.toLocaleTimeString("es-AR");\nexport const both = (at: Date) => at.toLocaleString("en-US", { dateStyle: "short" });\nexport const quoted = (at: Date) => at.toLocaleString("en-US", { "timeStyle": "short" });\nexport const count = (n: number) => n.toLocaleString("es-AR", { maximumFractionDigits: 1 });\n`,
  );

  it("reject Intl's date formats and a date's own locale strings, not a number's", () => {
    expect(dateFormat(codes(intlProbe))).toHaveLength(6);
  });

  const zoneCheckProbe = probe(
    "zone-check.ts",
    `export function isZone(value: string) {\n  try {\n    new Intl.DateTimeFormat("en", { timeZone: value });\n    return true;\n  } catch {\n    return false;\n  }\n}\n`,
  );

  it("allow Intl asked only whether a time zone exists", () => {
    expect(dateFormat(codes(zoneCheckProbe))).toEqual([]);
  });

  const dateFiles = [
    existing("src/lib/dates.ts"),
    existing("src/routes/_app/conversaciones/-labels.ts"),
    existing("src/routes/_app/notificaciones/-notification-copy.ts"),
  ];

  it("leave dates.ts its formats, and skip the files PR #300 changes until it merges", () => {
    expect(dateFormat(codes(...dateFiles))).toEqual([]);
  });

  const uiComponents = [
    existing("src/components/ui/input.tsx"),
    existing("src/components/ui/native-select.tsx"),
  ];

  it("leave src/components/ui alone: its components own the raw elements", () => {
    expect(codes(...uiComponents)).toEqual([]);
  });
});
