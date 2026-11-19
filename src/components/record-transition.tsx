import type { ReactNode } from "react";

/**
 * A record's name, wherever it shows: its list row and its page's title take
 * the same view transition name, so the row's link carries the name into the title.
 */
export function RecordName(props: { id: string; children: ReactNode }) {
  return (
    <span className="record-transition" style={{ "--record-transition": `record-${props.id}` }}>
      {props.children}
    </span>
  );
}
