import { Link, useMatches, useRouterState } from "@tanstack/react-router";
import type { ComponentProps, ComponentType, ReactElement } from "react";
import { Fragment } from "react";

import { sectionOf } from "#/components/app-nav.ts";
import { usePrototypeNav } from "#/routes/_app/sedes/-prototype-store.ts";
import type { SectionCrumb } from "#/components/app-nav.ts";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb.tsx";

// The top bar's breadcrumbs: the section the page sits in, as the sidebar
// names it, then the steps a page under it declares in its route's
// `staticData.crumbs`, a component that reads the route's own data.

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** The steps below the section, ending in the page itself (`PageCrumbs`). */
    crumbs?: ComponentType;
  }
}

/** A step below the section: a label, and the page it opens unless it is the page itself. */
export interface Crumb {
  label: string;
  link?: ReactElement;
}

/** A route's steps below its section, the last one the page itself. */
export function PageCrumbs({ items }: { items: Crumb[] }) {
  return items.map((item, index) => (
    <Fragment key={index}>
      <BreadcrumbSeparator />
      <BreadcrumbItem>
        {index === items.length - 1 || !item.link ? (
          <BreadcrumbPage>{item.label}</BreadcrumbPage>
        ) : (
          <BreadcrumbLink render={item.link}>{item.label}</BreadcrumbLink>
        )}
      </BreadcrumbItem>
    </Fragment>
  ));
}

function SectionStep({ step, isPage }: { step: SectionCrumb; isPage: boolean }) {
  if (isPage) {
    return <BreadcrumbPage>{step.label}</BreadcrumbPage>;
  }
  if (!step.to) {
    return step.label;
  }
  return <BreadcrumbLink render={<SectionLink to={step.to} />}>{step.label}</BreadcrumbLink>;
}

/** PROTOTYPE (LEO-6): a link back to the office page keeps the variant last shown. */
function SectionLink(props: ComponentProps<"a"> & { to: NonNullable<SectionCrumb["to"]> }) {
  const { to, ...anchor } = props;
  const { variant } = usePrototypeNav();
  return <Link {...anchor} to={to} search={to === "/sedes" ? { variant } : undefined} />;
}

export function AppBreadcrumbs() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const deepest = useMatches({ select: (matches) => matches.at(-1) });
  // PROTOTYPE (LEO-6): the office page's name follows the variant last shown.
  const officeNav = usePrototypeNav();
  const section = sectionOf(pathname).map((step) =>
    step.to === "/sedes" ? { ...step, label: officeNav.label } : step,
  );
  // A page's own steps read its loaded data: none while it loads or after its loader failed.
  const RouteCrumbs = deepest?.status === "success" ? deepest.staticData.crumbs : undefined;
  if (section.length === 0 && !RouteCrumbs) {
    return null;
  }
  return (
    <Breadcrumb aria-label="Ubicación">
      <BreadcrumbList>
        {section.map((step, index) => (
          <Fragment key={step.label}>
            {index > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              <SectionStep step={step} isPage={!RouteCrumbs && index === section.length - 1} />
            </BreadcrumbItem>
          </Fragment>
        ))}
        {RouteCrumbs && <RouteCrumbs key={deepest?.routeId} />}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/** The steps of a page whose labels never change, as a route's `staticData.crumbs`. */
export function fixedCrumbs(...labels: string[]): ComponentType {
  return function FixedCrumbs() {
    return <PageCrumbs items={labels.map((label) => ({ label }))} />;
  };
}
