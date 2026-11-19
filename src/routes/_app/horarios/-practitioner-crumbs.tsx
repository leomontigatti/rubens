import { Link } from "@tanstack/react-router";

import { PageCrumbs } from "#/components/app-breadcrumbs.tsx";

/** A practitioner's schedules, linked, then the step a page under them takes. */
export function PractitionerStepCrumbs(props: {
  practitionerId: string;
  name: string | null;
  step: string;
}) {
  return (
    <PageCrumbs
      items={[
        {
          label: props.name ?? "Profesional",
          link: (
            <Link
              to="/horarios/$practitionerId"
              params={{ practitionerId: props.practitionerId }}
            />
          ),
        },
        { label: props.step },
      ]}
    />
  );
}
