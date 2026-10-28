import { describe, expect, it } from "vite-plus/test";

import { lint, lintProbes, text } from "./lint.test-support.ts";

// The style guide's rules that a machine can judge: `@shadcn/lint`'s rules and
// the repo's own `ui` plugin (scripts/oxlint-ui-plugin.mjs).

const probe = lintProbes("ui");

const codes = (...files: string[]) => lint(...files).map((d) => d.code);

const button = `import { Button } from "#/components/ui/button.tsx";\n\n`;

// Each case spawns a type-aware `vp lint`: well under a second warm, slower cold.
describe("UI lint rules", { timeout: 30_000 }, () => {
  it("reject restyling a ui component, and point at the style guide", () => {
    const file = probe(
      "restyle.tsx",
      `${button}export const Save = () => <Button className="p-4 rounded-full">Guardar</Button>;\n`,
    );

    const found = lint(file).filter((d) => d.code.includes("no-restyle"));

    expect(found.length).toBeGreaterThan(0);
    expect(found.map(text).join()).toContain("style-guide.md");
  });

  it("allow layout classes on a ui component", () => {
    const file = probe(
      "layout.tsx",
      `${button}export const Save = () => <Button className="mt-4 w-full">Guardar</Button>;\n`,
    );

    expect(codes(file)).toEqual([]);
  });

  it("let a card's content lay out its children, but not change its padding", () => {
    const card = `import { CardContent } from "#/components/ui/card.tsx";\n\n`;
    const gap = probe(
      "card-gap.tsx",
      `${card}export const Body = () => <CardContent className="flex flex-col gap-4" />;\n`,
    );
    const padding = probe(
      "card-padding.tsx",
      `${card}export const Body = () => <CardContent className="p-8" />;\n`,
    );

    expect(codes(gap)).toEqual([]);
    expect(codes(padding).join()).toContain("no-restyle");
  });

  it("reject palette colours, arbitrary values and inline styles", () => {
    const file = probe(
      "off-theme.tsx",
      `export const Box = () => (\n  <>\n    <div className="bg-red-500" />\n    <div className="p-[13px]" />\n    <div style={{ color: "red" }} />\n  </>\n);\n`,
    );

    const found = codes(file).join();

    expect(found).toContain("no-raw-colors");
    expect(found).toContain("no-arbitrary-values");
    expect(found).toContain("no-inline-styles");
  });

  it("allow theme tokens", () => {
    const file = probe(
      "on-theme.tsx",
      `export const Box = () => <div className="bg-muted text-muted-foreground p-4" />;\n`,
    );

    expect(codes(file)).toEqual([]);
  });

  it("reject a raw form element outside src/components/ui, naming the component to use", () => {
    const file = probe(
      "raw-elements.tsx",
      `export const Form = () => (\n  <form>\n    <input name="email" />\n    <input type="checkbox" name="active" />\n    <select name="office" />\n    <textarea name="notes" />\n    <button type="submit">Guardar</button>\n  </form>\n);\n`,
    );

    const found = lint(file).filter((d) => d.code.includes("no-raw-form-element"));

    expect(found).toHaveLength(5);
    const messages = found.map(text).join("\n");
    for (const component of ["Input", "Checkbox", "NativeSelect", "Textarea", "Button"]) {
      expect(messages).toContain(component);
    }
  });

  it("reject a raw element nested inside what a render callback returns", () => {
    const file = probe(
      "raw-nested-in-render.tsx",
      `${button}export const Back = () => (\n  <Button\n    render={(props) => {\n      const child = <button type="button" />;\n      return <a {...props}>{child}</a>;\n    }}\n  />\n);\n`,
    );

    expect(codes(file)).toEqual(["ui(no-raw-form-element)"]);
  });

  it("allow a raw element that has no look: hidden, visually hidden, or rendered by a ui component", () => {
    const file = probe(
      "raw-allowed.tsx",
      `${button}export const Form = () => (\n  <form>\n    <input type="hidden" name="id" value="1" />\n    <input type="file" className="sr-only" />\n    <Button render={<button type="submit" />}>Guardar</Button>\n    <Button render={(props) => <button {...props} />}>Enviar</Button>\n    <Button\n      render={(props) => {\n        return <button {...props} />;\n      }}\n    >\n      Volver\n    </Button>\n    <Button\n      render={(props) => {\n        if (props.className) return <button {...props} />;\n        return <a {...props} />;\n      }}\n    >\n      Ir\n    </Button>\n  </form>\n);\n`,
    );

    expect(codes(file)).toEqual([]);
  });

  it("leave src/components/ui alone: its components own the raw elements", () => {
    expect(codes("src/components/ui/input.tsx", "src/components/ui/native-select.tsx")).toEqual([]);
  });
});
