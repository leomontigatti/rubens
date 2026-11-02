import type { FormEvent } from "react";

import { NameField, fieldMessage, useFormAction } from "#/components/admin-form.tsx";
import { ActionFormPage, useFormPage } from "#/components/form-page.tsx";
import { Field, FieldLabel } from "#/components/ui/field.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = insurerInputSchema.safeParse({ name: form.get("name"), kind: form.get("kind") });
    if (!input.success) {
      action.setError(fieldMessage(fieldMessages, input.error));
      return;
    }
    if (await action.run(() => props.onSubmit(input.data))) {
      page.leave();
    }
  }

  return (
    <ActionFormPage
      page={page}
      title={props.title}
      description={props.description}
      submitLabel={props.submitLabel}
      action={action}
      onSubmit={handleSubmit}
    >
      <NameField idPrefix="insurer" initial={initial.name} />
      <Field>
        <FieldLabel htmlFor="insurer-kind">Tipo</FieldLabel>
        <NativeSelect id="insurer-kind" name="kind" defaultValue={initial.kind}>
          {insurerKinds.map((kind) => (
            <NativeSelectOption key={kind} value={kind}>
              {insurerKindLabels[kind]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
    </ActionFormPage>
  );
}
