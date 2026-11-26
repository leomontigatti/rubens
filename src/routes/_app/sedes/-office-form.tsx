import { useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import type { RecordHeader } from "#/components/form-page.tsx";
import type { ReactNode } from "react";
import { officeInputSchema } from "#/lib/offices.ts";
import type { OfficeInput } from "#/lib/offices.ts";

import { useAction } from "#/routes/_app/sedes/-shared.tsx";
import type { ActionResult } from "#/routes/_app/sedes/-shared.tsx";

const fieldMessages: Record<keyof OfficeInput, string> = {
  name: "Ingresá el nombre de la sede.",
  address: "Ingresá el domicilio de la sede.",
};

export function OfficeForm(props: {
  title: string;
  description?: string;
  initial: OfficeInput;
  submitLabel: string;
  creates?: boolean;
  /** An existing office's status and deactivation, beside the title. */
  record?: RecordHeader;
  frame?: (content: ReactNode) => ReactNode;
  onSubmit: (input: OfficeInput) => Promise<ActionResult>;
}) {
  const { initial } = props;
  const page = useFormPage({ to: "/sedes" });
  const action = useAction();

  const form = useAppForm({
    defaultValues: {
      name: initial.name,
      address: initial.address,
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
      record={props.record}
      frame={props.frame}
      action={action}
    >
      <form.AppField name="name">
        {(field) => <field.TextField label="Nombre" size="half" required />}
      </form.AppField>
      <form.AppField name="address">
        {(field) => <field.TextField label="Domicilio" size="half" required />}
      </form.AppField>
    </ActionFormPage>
  );
}
