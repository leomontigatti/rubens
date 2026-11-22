import { useState } from "react";

import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs.tsx";

// A dev-only panel to try the look: the motion style on <html> and dark mode.
// Only `pnpm dev` renders it, and a reload goes back to springy and light.
const motionStyles = [
  { value: "springy", label: "Springy" },
  { value: "calm", label: "Calm" },
  { value: "snappy", label: "Snappy" },
  { value: "playful", label: "Playful" },
];

export function LookPreview() {
  const [motion, setMotion] = useState("springy");
  const [dark, setDark] = useState(false);

  function pickMotion(value: string) {
    document.documentElement.dataset.motion = value;
    setMotion(value);
  }

  function pickDark(value: boolean) {
    document.documentElement.classList.toggle("dark", value);
    setDark(value);
  }

  return (
    <div className="fixed right-4 bottom-4 z-40 flex items-center gap-3 rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg">
      <Tabs value={motion} onValueChange={(value: string) => pickMotion(value)}>
        <TabsList>
          {motionStyles.map((style) => (
            <TabsTrigger key={style.value} value={style.value}>
              {style.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Field orientation="horizontal" className="mr-1 w-fit">
        <Checkbox id="dev-look-dark" checked={dark} onCheckedChange={pickDark} />
        <FieldLabel htmlFor="dev-look-dark">Oscuro</FieldLabel>
      </Field>
    </div>
  );
}
