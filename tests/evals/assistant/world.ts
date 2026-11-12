// The made-up organization every case runs against. No name, number or address
// here belongs to a real person or practice.

export const now = "2026-11-09T10:00:00-03:00";
export const timeZone = "America/Argentina/Cordoba";

export const organization = {
  name: "Consultorio Ejemplo",
  phone: "0351 555-0100",
  emergencyNumber: "107",
};

export type Slot = { slotId: string; date: string; time: string; office: string };

export type Appointment = {
  appointmentId: string;
  service: string;
  practitioner: string;
  // What the practitioner treats, as list_patients returns it.
  specialty: string;
  date: string;
  time: string;
  office: string;
  address: string;
  status: "booked" | "confirmed" | "cancelled_by_organization";
  // Why a patient's own move is refused, if it is: the medical service's cutoff
  // has passed, or the patient already used the appointment's one move.
  moveRefusal?: "past_cutoff" | "move_already_used";
  freeSlots: Slot[];
};

export type Patient = { patientId: string; firstName: string; appointments: Appointment[] };

const centro = { office: "Sede Centro", address: "Av. Colón 1234, Córdoba" };
const norte = { office: "Sede Norte", address: "Av. Rafael Núñez 4500, Córdoba" };

const riosSlots: Slot[] = [
  { slotId: "slot-r1", date: "2026-11-16", time: "09:00", office: centro.office },
  { slotId: "slot-r2", date: "2026-11-17", time: "10:30", office: norte.office },
  { slotId: "slot-r3", date: "2026-11-19", time: "17:00", office: centro.office },
];

function lucia(overrides: Partial<Appointment> = {}): Patient {
  return {
    patientId: "pat-lucia",
    firstName: "Lucía",
    appointments: [
      {
        appointmentId: "apt-101",
        service: "Sesión de kinesiología",
        practitioner: "Lic. Paula Ríos",
        specialty: "Kinesiología",
        date: "2026-11-12",
        time: "16:30",
        ...centro,
        status: "booked",
        freeSlots: riosSlots,
        ...overrides,
      },
    ],
  };
}

// Numbers, by what they stand for. Each case names one.
export const numbers = {
  onePatient: [lucia()],
  pastCutoff: [lucia({ date: "2026-11-10", time: "08:30", moveRefusal: "past_cutoff" })],
  moveUsed: [lucia({ moveRefusal: "move_already_used" })],
  twoAppointments: [
    {
      ...lucia(),
      appointments: [
        ...lucia().appointments,
        {
          ...lucia().appointments[0]!,
          appointmentId: "apt-102",
          date: "2026-11-10",
          time: "08:30",
          moveRefusal: "past_cutoff",
        },
      ],
    },
  ],
  // A kinesiology session and a dental check-up, with two practitioners.
  withDentist: [
    {
      ...lucia(),
      appointments: [
        ...lucia().appointments,
        {
          appointmentId: "apt-103",
          service: "Consulta odontológica",
          practitioner: "Od. Carla Méndez",
          specialty: "Odontología",
          date: "2026-11-13",
          time: "11:00",
          ...centro,
          status: "booked" as const,
          freeSlots: [
            { slotId: "slot-m1", date: "2026-11-20", time: "11:00", office: centro.office },
          ],
        },
      ],
    },
  ],
  cancelledByOrganization: [lucia({ status: "cancelled_by_organization", freeSlots: [] })],
  alreadyConfirmed: [lucia({ status: "confirmed" })],
  guardian: [
    {
      patientId: "pat-tomas",
      firstName: "Tomás",
      appointments: [
        {
          appointmentId: "apt-201",
          service: "Control pediátrico",
          practitioner: "Dr. Martín Sosa",
          specialty: "Pediatría",
          date: "2026-11-11",
          time: "09:00",
          ...norte,
          status: "booked",
          freeSlots: [
            { slotId: "slot-s1", date: "2026-11-18", time: "11:00", office: norte.office },
          ],
        },
      ],
    },
    {
      patientId: "pat-valentina",
      firstName: "Valentina",
      appointments: [
        {
          appointmentId: "apt-202",
          service: "Sesión de kinesiología",
          practitioner: "Lic. Paula Ríos",
          specialty: "Kinesiología",
          date: "2026-11-13",
          time: "18:00",
          ...centro,
          status: "booked",
          freeSlots: riosSlots,
        },
      ],
    },
  ],
} satisfies Record<string, Patient[]>;

export type NumberKey = keyof typeof numbers;
