import { describe, expect, it } from "vite-plus/test";

import { historyChanges, patientName } from "#/lib/patients.ts";

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
      { field: "Teléfono", before: "0351 15-555-1234", after: "011 5555-1234" },
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
      { field: "Teléfono", before: "—", after: "0351 412-3456" },
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
    const timeZone = "America/Argentina/Buenos_Aires";

    it("shows a booking's fields by name and its times in the office's zone, never the patient's id", () => {
      expect(
        historyChanges(
          {
            timeZone,
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
            timeZone,
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
            timeZone,
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
        historyChanges(
          { timeZone, before: { roomId: "room-gone" }, after: { roomId: "room-1" } },
          names,
        ),
      ).toEqual([{ field: "Consultorio", before: "Desconocido", after: "Consultorio 1" }]);
    });
  });
});
