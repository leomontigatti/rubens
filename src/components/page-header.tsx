import { Link } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * What every page opens with: its title, and around it the page above it, what
 * the record is at a glance, a line of detail and the page's actions. A
 * `description` given as text is the page's subtitle.
 */
export function PageHeader(props: {
  title: ReactNode;
  back?: { to: NonNullable<LinkProps["to"]>; label: string };
  status?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        {props.back && (
          <Link
            to={props.back.to}
            className="text-muted-foreground text-sm underline-offset-4 hover:underline"
          >
            {props.back.label}
          </Link>
        )}
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          {props.title}
          {props.status}
        </h1>
        {typeof props.description === "string" ? (
          <p className="text-muted-foreground text-sm">{props.description}</p>
        ) : (
          props.description
        )}
      </div>
      {props.actions && <div className="flex flex-wrap items-center gap-2">{props.actions}</div>}
    </div>
  );
}
