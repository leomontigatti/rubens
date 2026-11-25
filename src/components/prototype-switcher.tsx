import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "#/components/ui/button.tsx";
import { useArrowKeys } from "#/hooks/use-arrow-keys.ts";

// PROTOTYPE tooling, never merged: the floating bar a UI prototype's variants
// are switched with (the shared `prototype` skill, UI.md). Only `pnpm dev` shows it.

export function PrototypeSwitcher<K extends string>(props: {
  variants: readonly { key: K; name: string }[];
  current: K;
  onChange: (key: K) => void;
}) {
  const { variants, current, onChange } = props;
  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.key === current),
  );
  const step = (by: number) => {
    const next = variants[(index + by + variants.length) % variants.length];
    if (next) {
      onChange(next.key);
    }
  };
  useArrowKeys(step);

  const shown = variants[index];
  if (!import.meta.env.DEV || !shown) {
    return null;
  }
  return (
    <div
      role="toolbar"
      aria-label="Variantes del prototipo"
      className="bg-foreground text-background fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full p-1 shadow-lg"
    >
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label="Variante anterior"
        onClick={() => step(-1)}
      >
        <ChevronLeftIcon aria-hidden />
      </Button>
      <span className="min-w-48 px-2 text-center text-sm font-medium" aria-live="polite">
        {shown.key} ({shown.name}) · {index + 1}/{variants.length}
      </span>
      <Button
        variant="secondary"
        size="icon-sm"
        aria-label="Variante siguiente"
        onClick={() => step(1)}
      >
        <ChevronRightIcon aria-hidden />
      </Button>
    </div>
  );
}
