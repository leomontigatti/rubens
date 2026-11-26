import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { guardianInputSchema } from "#/lib/guardians.ts";
import {
  historyChanges,
  historyTitle,
  patientInputSchema,
  patientName,
  patientUpdateSchema,
} from "#/lib/patients.ts";

const typed = {
  firstName: "juan",
  lastName: "pérez",
  phone: { country: "AR", number: "3515551234" },
};

describe("patientName", () => {
  it("calls a patient by their chosen first name, with their last name", () => {
    expect(patientName({ firstName: "Juan", lastName: "Pérez", chosenName: "Juana" })).toBe(
      "Juana Pérez",
    );
    expect(patientName({ firstName: "Juan", lastName: "Pérez", chosenName: null })).toBe(
      "Juan Pérez",
    );
  });
});

describe("historyChanges", () => {
  it("shows each changed field's values the way the patient page does", () => {
    expect(
      historyChanges({
        before: { phone: "+5493515551234", birthDate: null, whatsappConsent: true },
        after: { phone: "+541155551234", birthDate: "2015-06-01", whatsappConsent: false },
      }),
    ).toEqual([
      { field: "Teléfono", before: "351 555-1234", after: "11 5555-1234" },
      { field: "Fecha de nacimiento", before: "—", after: "01/06/2015" },
      { field: "Acepta WhatsApp", before: "Sí", after: "No" },
    ]);
  });

  it("lists a new patient's values with nothing before them", () => {
    expect(
      historyChanges({ before: null, after: { firstName: "Juan", documentType: "passport" } }),
    ).toEqual([
      { field: "Nombre", before: "—", after: "Juan" },
      { field: "Tipo de documento", before: "—", after: "Pasaporte" },
    ]);
  });

  it("lists the fields in the form's order, whatever order the log kept them in", () => {
    const changes = historyChanges({
      before: null,
      after: { phone: "+5493515551234", lastName: "Pérez", firstName: "Juan" },
    });

    expect(changes.map((change) => change.field)).toEqual(["Nombre", "Apellido", "Teléfono"]);
  });

  it("labels a coverage's fields, after the patient's, showing the insurer by name", () => {
    expect(
      historyChanges({
        before: null,
        after: {
          primary: true,
          memberNumber: "123",
          insurerId: "6f1c0d2e-0000-4000-8000-000000000000",
          insurer: "OSDE",
          plan: "310",
        },
      }),
    ).toEqual([
      { field: "Obra social / prepaga", before: "—", after: "OSDE" },
      { field: "Plan", before: "—", after: "310" },
      { field: "Número de afiliado", before: "—", after: "123" },
      { field: "Principal", before: "—", after: "Sí" },
    ]);
  });

  it("labels a guardian's fields, the name and relationship first", () => {
    expect(
      historyChanges({
        before: null,
        after: { phone: "+543514123456", relationship: "Madre", name: "Laura Gómez" },
      }),
    ).toEqual([
      { field: "Nombre", before: "—", after: "Laura Gómez" },
      { field: "Relación", before: "—", after: "Madre" },
      { field: "Teléfono", before: "—", after: "351 412-3456" },
    ]);
  });

  it("names the patient as the message contact when no guardian is", () => {
    expect(
      historyChanges({
        before: { messageContact: null },
        after: { messageContact: "Laura Gómez" },
      }),
    ).toEqual([{ field: "Recibe los mensajes", before: "El paciente", after: "Laura Gómez" }]);
  });

  describe("an appointment's entry", () => {
    const names = {
      "room-1": "Consultorio 1",
      "room-2": "Consultorio 2",
      "practitioner-1": "Juan Gómez",
      "service-1": "Consulta",
    };

    it("shows a booking's fields by name and its times in the practice's zone, never the patient's id", () => {
      expect(
        historyChanges(
          {
            before: null,
            after: {
              patientId: "patient-1",
              practitionerId: "practitioner-1",
              medicalServiceId: "service-1",
              roomId: "room-1",
              receptionNote: "Trae estudios",
              start: "2099-01-05T12:00:00.000Z",
              end: "2099-01-05T12:30:00.000Z",
              status: "booked",
            },
          },
          names,
        ),
      ).toEqual([
        { field: "Inicio", before: "—", after: "05/01/2099 09:00" },
        { field: "Fin", before: "—", after: "05/01/2099 09:30" },
        { field: "Profesional", before: "—", after: "Juan Gómez" },
        { field: "Prestación", before: "—", after: "Consulta" },
        { field: "Consultorio", before: "—", after: "Consultorio 1" },
        { field: "Estado", before: "—", after: "Reservado" },
        { field: "Nota de recepción", before: "—", after: "Trae estudios" },
      ]);
    });

    it("shows a room move and an overbooking by name and in Spanish", () => {
      expect(
        historyChanges(
          {
            before: { roomId: "room-1", overbooking: false },
            after: { roomId: "room-2", overbooking: true },
          },
          names,
        ),
      ).toEqual([
        { field: "Consultorio", before: "Consultorio 1", after: "Consultorio 2" },
        { field: "Sobreturno", before: "No", after: "Sí" },
      ]);
    });

    it("shows a cancellation's status, who cancelled and why", () => {
      expect(
        historyChanges(
          {
            before: { status: "confirmed", cancelledBy: null, cancellationReason: null },
            after: { status: "cancelled", cancelledBy: "patient", cancellationReason: "Viaje" },
          },
          names,
        ),
      ).toEqual([
        { field: "Estado", before: "Confirmado", after: "Cancelado" },
        { field: "Canceló", before: "—", after: "El paciente" },
        { field: "Motivo de cancelación", before: "—", after: "Viaje" },
      ]);
    });

    it("never shows an id it has no name for", () => {
      expect(
        historyChanges({ before: { roomId: "room-gone" }, after: { roomId: "room-1" } }, names),
      ).toEqual([{ field: "Consultorio", before: "Desconocido", after: "Consultorio 1" }]);
    });
  });
});

describe("historyTitle", () => {
  it("names an appointment's entry by its time and practitioner (#173)", () => {
    const appointment = {
      startsAt: Date.parse("2026-11-12T10:00:00-03:00"),
      practitioner: "Juan Prueba",
    };

    expect(historyTitle({ action: "update", entityType: "appointment", appointment })).toBe(
      "Cambio del turno del 12/11/2026 10:00 con Juan Prueba",
    );
  });

  it("says only what changed for an entry of no appointment", () => {
    expect(historyTitle({ action: "update", entityType: "patient", appointment: null })).toBe(
      "Cambio",
    );
    expect(historyTitle({ action: "create", entityType: "coverage", appointment: null })).toBe(
      "Alta de cobertura",
    );
    expect(historyTitle({ action: "delete", entityType: "appointment", appointment: null })).toBe(
      "Baja de turno",
    );
  });
});

describe("patientInputSchema", () => {
  const patient = { firstName: "Juan", lastName: "Pérez" };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves the names in title case and the chosen name as typed", () => {
    const input = {
      ...typed,
      firstName: "juan DE LA cruz",
      lastName: "DE LA CRUZ",
      chosenName: "juana LU",
    };
    expect(patientInputSchema.parse(input)).toMatchObject({
      firstName: "Juan de la Cruz",
      lastName: "de la Cruz",
      chosenName: "juana LU",
    });
  });

  it("cases an edit's names as a registration's", () => {
    const update = { ...typed, patientId: crypto.randomUUID() };
    expect(patientUpdateSchema.parse(update)).toMatchObject({
      firstName: "Juan",
      lastName: "Pérez",
    });
  });

  function birthDateMessages(birthDate: string) {
    const parsed = patientInputSchema.safeParse({ ...typed, birthDate });
    return parsed.success
      ? []
      : parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
  }

  it("refuses a birth date after today in the practice's zone, not UTC's", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T23:00:00-03:00"));
    expect(birthDateMessages("2026-11-16")).toEqual([]);
    expect(birthDateMessages("2026-11-17")).toEqual([
      { path: ["birthDate"], message: "futureBirthDate" },
    ]);
  });

  it("refuses a birth date more than 100 years before today", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
    expect(birthDateMessages("1926-11-17")).toEqual([]);
    expect(birthDateMessages("1926-11-16")).toEqual([
      { path: ["birthDate"], message: "birthDateTooOld" },
    ]);
  });

  it("stores a phone field's entry in E.164", () => {
    const parsed = patientInputSchema.parse({
      ...patient,
      phone: { country: "AR", number: "3515551234" },
    });
    expect(parsed.phone).toBe("+5493515551234");
  });

  it("refuses a wrong entry on the phone, with its reason", () => {
    const parsed = patientInputSchema.safeParse({
      ...patient,
      phone: { country: "AR", number: "0351 15 555-1234" },
    });
    expect(parsed.error?.issues).toMatchObject([{ path: ["phone"], message: "notDigits" }]);
  });
});

describe("guardianInputSchema", () => {
  it("saves a guardian's name in title case", () => {
    const input = {
      ...typed,
      name: "MARÍA DEL CARMEN lópez",
      relationship: "Madre",
      patientId: crypto.randomUUID(),
    };
    expect(guardianInputSchema.parse(input).name).toBe("María del Carmen López");
  });
});
