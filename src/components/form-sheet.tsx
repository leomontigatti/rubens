import { useState } from "react";
import type { ReactNode } from "react";

import { Button } from "#/components/ui/button.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "#/components/ui/sheet.tsx";

/**
 * A create or an edit, beside the screen it changes. A click outside leaves it
 * open, so a stray click never loses what was typed. Its form mounts on opening
 * and goes on closing, so each opening starts from the saved values.
 */
export function FormSheet(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => !open && props.onClose()}
      disablePointerDismissal
    >
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{props.title}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">{props.children}</div>
      </SheetContent>
    </Sheet>
  );
}

/** The button that opens a creation form. `children` gets the function that closes it. */
export function CreateSheet(props: {
  canCreate: boolean;
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  if (!props.canCreate) {
    return null;
  }
  return (
    <div>
      <Button onClick={() => setOpen(true)}>{props.label}</Button>
      <FormSheet open={open} onClose={close} title={props.label}>
        {props.children(close)}
      </FormSheet>
    </div>
  );
}
