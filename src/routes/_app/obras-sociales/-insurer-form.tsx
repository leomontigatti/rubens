import { fieldMessage, useFormAction } from "#/components/admin-form.tsx";
import { useAppForm } from "#/components/app-form.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { NativeSelectOption } from "#/components/ui/native-select.tsx";
import { insurerInputSchema, insurerKindLabels, insurerKinds } from "#/lib/coverages.ts";
import type { InsurerInput } from "#/lib/coverages.ts";

export const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo un administrador puede cambiar las obras sociales y prepagas.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos esa obra social o prepaga.",
  nameTaken: "Ya hay una obra social o prepaga con ese nombre.",
};

type ActionResult = { ok: true } | { ok: false; reason: keyof typeof refusalMessages };

const fieldMessages: Record<keyof InsurerInput, string> = {
  name: "Ingresá el nombre.",
  kind: "Elegí si es una obra social o una prepaga.",
};

export function useAction() {
  return useFormAction(refusalMessages);
}

export function InsurerForm(props: {
  title: string;
  description?: string;
  initial: InsurerInput;
  submitLabel: string;
  onSubmit: (input: InsurerInput) => Promise<ActionResult>;
}) {
  const { initial } = props;
  const page = useFormPage({ to: "/obras-sociales" });
  const action = useAction();

  const form = useAppForm({
    defaultValues: { name: initial.name, kind: initial.kind as string },
    onSubmit: async ({ value }) => {
      const input = insurerInputSchema.safeParse(value);
      if (!input.success) {
        action.setError(fieldMessage(fieldMessages, input.error));
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
      action={action}
    >
      <form.AppField name="name">
        {(field) => <field.TextField label="Nombre" required />}
      </form.AppField>
      <form.AppField name="kind">
        {(field) => (
          <field.SelectField label="Tipo">
            {insurerKinds.map((kind) => (
              <NativeSelectOption key={kind} value={kind}>
                {insurerKindLabels[kind]}
              </NativeSelectOption>
            ))}
          </field.SelectField>
        )}
      </form.AppField>
    </ActionFormPage>
  );
}
