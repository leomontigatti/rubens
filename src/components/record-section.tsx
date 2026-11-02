import type { ReactNode } from "react";

import { Card, CardAction, CardContent, CardHeader, CardTitle } from "#/components/ui/card.tsx";

/** A part of a record's page: its title, the button that changes it, and what it holds. */
export function RecordSection(props: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        {props.action && <CardAction>{props.action}</CardAction>}
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}

/** One value of a record, in a `dl`. */
export function Detail(props: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-sm">{props.label}</dt>
      <dd>{props.value ?? "—"}</dd>
    </div>
  );
}
