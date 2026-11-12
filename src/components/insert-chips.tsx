import { PlusIcon } from "lucide-react";
import type { RefObject } from "react";

import { insertText } from "#/components/text-insert.ts";
import { Button } from "#/components/ui/button.tsx";

// The form kit's chips above a text area: each a button that writes its piece
// of text in at the box's cursor, as a template's variables (`TextareaField`'s
// `inserts`).

/** A piece of text a chip writes in, such as a template's variable. */
interface TextInsert {
  label: string;
  text: string;
}

/** The chips a text area offers, and what the row of them is called. */
export interface TextInserts {
  label: string;
  options: readonly TextInsert[];
}

/** A row of chips that write into `box`, whose text is `value`, through `onChange`. */
export function InsertChips(
  props: TextInserts & {
    box: RefObject<HTMLTextAreaElement | null>;
    value: string;
    onChange: (value: string) => void;
  },
) {
  function insert(text: string) {
    const area = props.box.current!;
    const next = insertText(
      props.value,
      { start: area.selectionStart, end: area.selectionEnd },
      text,
    );
    props.onChange(next.value);
    // Once the box holds the new text, the cursor goes after what was written in.
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(next.cursor, next.cursor);
    });
  }

  return (
    <div role="group" aria-label={props.label} className="flex flex-wrap gap-1.5">
      {props.options.map((option) => (
        <Button
          key={option.text}
          type="button"
          variant="outline"
          size="xs"
          onClick={() => insert(option.text)}
        >
          <PlusIcon data-icon="inline-start" aria-hidden />
          {option.label}
        </Button>
      ))}
    </div>
  );
}
