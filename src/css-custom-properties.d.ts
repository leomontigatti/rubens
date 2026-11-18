import "react";

// A `style` may set CSS custom properties (`--height`), which the markup's
// classes read (`h-(--height)`). React's own type has no key for them.
declare module "react" {
  interface CSSProperties {
    [customProperty: `--${string}`]: string | number | undefined;
  }
}
