import { useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { officeInputSchema } from "#/lib/offices.ts";
import type { OfficeInput } from "#/lib/offices.ts";

import { useAction } from "#/routes/_app/sedes/-shared.tsx";
import type { ActionResult } from "#/routes/_app/sedes/-shared.tsx";

const fieldMessages: Record<keyof OfficeInput, string> = {
  name: "Ingresá el nombre de la sede.",
  address: "Ingresá la dirección de la sede.",
  timeZone: "La zona horaria no es válida. Usá un nombre como America/Argentina/Buenos_Aires.",
};

export function OfficeForm(props: {
  title: string;
  description?: string;
  initial: OfficeInput;
  submitLabel: string;
  creates?: boolean;
  onSubmit: (input: OfficeInput) => Promise<ActionResult>;
}) {
  const { initial } = props;
  const page = useFormPage({ to: "/sedes" });
  const action = useAction();

  const form = useAppForm({
    defaultValues: {
      name: initial.name,
      address: initial.address,
      timeZone: initial.timeZone,
    },
    onSubmit: async ({ value }) => {
      const input = officeInputSchema.safeParse(value);
      if (!input.success) {
        page.showProblems(fieldProblems(input.error.issues, messageIn(fieldMessages)));
        return;
      }
      if (await action.save(() => props.onSubmit(input.data))) {
        page.leave();
      }
    },
  });

  return (
    <ActionFormPage
      page={page}
      form={form}
      title={props.title}
      description={props.description}
      submitLabel={props.submitLabel}
      creates={props.creates}
      action={action}
    >
      <form.AppField name="name">
        {(field) => <field.TextField label="Nombre" required />}
      </form.AppField>
      <form.AppField name="address">
        {(field) => <field.TextField label="Dirección" size="half" required />}
      </form.AppField>
      <form.AppField name="timeZone">
        {(field) => <field.TextField label="Zona horaria" required />}
      </form.AppField>
    </ActionFormPage>
  );
}
