import type { LucideIcon } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "#/components/ui/empty.tsx";

/**
 * A page or a list with nothing to show. `description` says what to do next, so
 * it stays hidden from someone who cannot: `canAct` false.
 */
export function EmptyState(props: {
  icon: LucideIcon;
  title: string;
  description: string;
  canAct?: boolean;
}) {
  const Icon = props.icon;
  const { canAct = true } = props;
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{props.title}</EmptyTitle>
        {canAct && <EmptyDescription>{props.description}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}
