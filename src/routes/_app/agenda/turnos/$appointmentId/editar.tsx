import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { useAppForm } from "#/components/app-form.tsx";
import { fieldProblems, messageIn } from "#/components/form-problems.ts";
import type { FieldProblem } from "#/components/form-problems.ts";
import { FormPage, useFormPage } from "#/components/form-page.tsx";
import { serverAnswer, shownPath } from "#/components/save-failure.ts";
import { NativeSelectOption } from "#/components/ui/native-select.tsx";
import {
  appointmentUpdateSchema,
  isActiveStatus,
  receptionNoteMaxLength,
} from "#/lib/appointments.ts";
import { getAppointmentRecord, saveAppointment } from "#/server/appointments.functions.ts";

import {
  AppointmentPage,
  appointmentBack,
  appointmentSummary,
} from "#/routes/_app/agenda/-appointment-page.tsx";
import type { LoadedAppointment } from "#/routes/_app/agenda/-appointment-page.tsx";
import { roomFullMessage } from "#/routes/_app/agenda/-booking.tsx";

// An appointment's own fields, saved together: its room, another of its
// office at the same time, while it holds its time, and its reception note.

export const Route = createFileRoute("/_app/agenda/turnos/$appointmentId/editar")({
  head: () => ({ meta: [{ title: "Editar turno · Rubens" }] }),
  loader: ({ params }) => getAppointmentRecord({ data: { appointmentId: params.appointmentId } }),
  component: EditAppointment,
});

const refusalMessages = {
  unauthenticated: "Tu sesión terminó. Ingresá de nuevo.",
  forbidden: "Solo recepción, un administrador o el propio profesional pueden cambiar el turno.",
  mustChangePassword: "Elegí una contraseña nueva para continuar.",
  invalidInput: "Revisá los datos ingresados.",
  notFound: "No encontramos ese turno, o ya no ocupa su horario: volvé a abrirlo.",
  practitionerInactive: "Ese profesional está inactivo.",
  otherOffice: "Ese consultorio es de otra sede.",
  roomInactive: "Ese consultorio está desactivado.",
  officeInactive: "La sede de ese consultorio está desactivada.",
};

const roomRefusals: readonly string[] = ["otherOffice", "roomInactive", "officeInactive"];

const fieldMessages = {
  roomId: "Elegí un consultorio.",
  receptionNote: `La nota de recepción puede tener hasta ${receptionNoteMaxLength} caracteres.`,
};

type SaveResult = Awaited<ReturnType<typeof saveAppointment>>;

/** What a refusal says, under the room when it is about the room. */
function refusalOf(result: Exclude<SaveResult, { ok: true }>, timeZone: string): FieldProblem {
  if (result.reason === "roomFull") {
    return { field: "roomId", message: roomFullMessage(result.occupants, timeZone) };
  }
  return {
    field: roomRefusals.includes(result.reason) ? "roomId" : "",
    message: refusalMessages[result.reason],
  };
}

function EditAppointment() {
  return (
    <AppointmentPage loaded={Route.useLoaderData()}>
      {(loaded) => <AppointmentForm loaded={loaded} />}
    </AppointmentPage>
  );
}

function AppointmentForm({ loaded }: { loaded: LoadedAppointment }) {
  const { appointment, office } = loaded;
  const page = useFormPage(appointmentBack);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<FieldProblem | null>(null);

  const form = useAppForm({
    defaultValues: { roomId: appointment.roomId, receptionNote: appointment.receptionNote ?? "" },
    onSubmit: async ({ value }) => {
      const input = appointmentUpdateSchema.safeParse({
        appointmentId: appointment.id,
        // A room the user did not change is not sent: someone may have moved it since.
        roomId: value.roomId === appointment.roomId ? undefined : value.roomId,
        receptionNote: value.receptionNote,
      });
      if (!input.success) {
        page.showProblems(fieldProblems(input.error.issues, messageIn(fieldMessages)));
        return;
      }
      setPending(true);
      const result = await serverAnswer("appointment-edit", shownPath(router), () =>
        saveAppointment({ data: input.data }),
      );
      setPending(false);
      if (!result) {
        return;
      }
      if (result.ok) {
        page.leave();
      } else {
        setRefusal(refusalOf(result, office.timeZone));
      }
    },
  });

  return (
    <FormPage
      page={page}
      form={form}
      title="Editar turno"
      description={appointmentSummary(loaded)}
      submitLabel="Guardar"
      pending={pending}
      refusals={refusal ? [refusal] : undefined}
      onClear={() => setRefusal(null)}
    >
      {/* Only an appointment that holds its time moves to another room. */}
      {isActiveStatus(appointment.status) && (
        <form.AppField name="roomId">
          {(field) => (
            <field.SelectField label="Consultorio" required>
              {office.rooms.map((room) => (
                <NativeSelectOption key={room.id} value={room.id}>
                  {room.name}
                </NativeSelectOption>
              ))}
            </field.SelectField>
          )}
        </form.AppField>
      )}
      <form.AppField name="receptionNote">
        {(field) => (
          <field.TextField
            label="Nota de recepción (opcional)"
            hint="La información clínica va en la historia clínica, no acá."
            placeholder="Por ejemplo: trae radiografías"
            maxLength={receptionNoteMaxLength}
          />
        )}
      </form.AppField>
    </FormPage>
  );
}
