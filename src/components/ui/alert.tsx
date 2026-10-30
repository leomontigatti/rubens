import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "cn";
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";

// Local divergence from shadcn: every alert says what kind of message it is, so
// `variant` is required and has no `default`, and `Alert` draws that variant's
// one icon itself, so a message reads the same everywhere (style guide, Alerts).

const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        destructive:
          "border-destructive-tint-border bg-destructive-tint text-destructive *:data-[slot=alert-description]:text-current",
        info: "border-info-tint-border bg-info-tint text-info *:data-[slot=alert-description]:text-current",
        success:
          "border-success-tint-border bg-success-tint text-success *:data-[slot=alert-description]:text-current",
        warning:
          "border-warning-tint-border bg-warning-tint text-warning *:data-[slot=alert-description]:text-current",
      },
    },
  },
);

const alertIcons = {
  destructive: CircleAlertIcon,
  info: InfoIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
};

type AlertVariant = keyof typeof alertIcons;

function Alert({
  className,
  variant,
  children,
  ...props
}: React.ComponentProps<"div"> & { variant: AlertVariant }) {
  const Icon = alertIcons[variant];
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon aria-hidden="true" />
      {children}
    </div>
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-medium group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="alert-action" className={cn("absolute top-2 right-2", className)} {...props} />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
