import { Children } from "react";
import type { ReactNode } from "react";

/**
 * A page's alerts, under its header and above what it holds: what to notice
 * about the record as a whole, such as why some fields are locked. Nothing
 * when it holds none.
 */
export function AlertStack({ children }: { children: ReactNode }) {
  const alerts = Children.toArray(children);
  if (alerts.length === 0) {
    return null;
  }
  return <div className="flex flex-col gap-3">{alerts}</div>;
}
