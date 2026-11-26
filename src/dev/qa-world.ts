import type { InsurerKind } from "#/lib/coverages.ts";
import type { PhoneEntry } from "#/lib/phones.ts";

// What `pnpm dev` adds to the dev world (`src/dev/world.ts`) for going
// through the screens by hand: a second practitioner and room, more medical
// services, insurers, a waiting list of patients, the coming week's
// appointments and more WhatsApp conversations. Made-up data only. The
// browser suite runs the production build, which never seeds it, so no spec
// depends on it (`src/dev/seed.ts`).

/** A second practitioner, with a room of her own in the dev office. */
export const qaPractitioner = {
  userId: "dev-practitioner-2",
  name: "Laura Prueba",
  email: "laura@prueba.example.com",
};

export const qaRoom = { name: "Consultorio 2" };

export const qaWorkingHours = { startTime: "09:00", endTime: "17:00" } as const;

export const qaMedicalServices = {
  control: { practitioner: "juan", name: "Control", durationMinutes: 30 },
  firstVisit: { practitioner: "laura", name: "Primera consulta", durationMinutes: 60 },
  followUp: { practitioner: "laura", name: "Seguimiento", durationMinutes: 30 },
} as const;

export type QaPractitioner = "juan" | "laura";
export type QaMedicalService = keyof typeof qaMedicalServices | "devConsult";

export const qaInsurers: readonly { name: string; kind: InsurerKind }[] = [
  { name: "OSDE", kind: "prepaga" },
  { name: "Swiss Medical", kind: "prepaga" },
  { name: "APROSS", kind: "obraSocial" },
  { name: "PAMI", kind: "obraSocial" },
];

interface QaPatient {
  firstName: string;
  lastName: string;
  phone: PhoneEntry;
  chosenName?: string;
  dni?: string;
  birthDate?: string;
  email?: string;
  address?: string;
  /** The patient's one coverage, if any: the insurer's index in `qaInsurers`, its plan and member number. */
  coverage?: { insurer: number; plan: string | null; memberNumber: string };
  guardian?: { name: string; relationship: string; phone: PhoneEntry };
  whatsappConsent?: false;
  /** Deactivated after registering, so it gets no appointments. */
  inactive?: true;
}

export const qaPatients: readonly QaPatient[] = [
  {
    firstName: "Lucía",
    lastName: "Gómez",
    phone: { country: "AR", number: "3514100001" },
    dni: "30111222",
    birthDate: "1984-03-12",
    email: "lucia.gomez@prueba.example.com",
    address: "Bv. San Juan 450",
    coverage: { insurer: 0, plan: "310", memberNumber: "61234567801" },
  },
  {
    firstName: "Martín",
    lastName: "Rodríguez",
    phone: { country: "AR", number: "3514100002" },
    dni: "28444555",
    birthDate: "1980-07-02",
    coverage: { insurer: 2, plan: null, memberNumber: "200345678" },
  },
  {
    firstName: "Valentina",
    lastName: "Sosa",
    phone: { country: "AR", number: "3514100003" },
    birthDate: "2015-09-21",
    coverage: { insurer: 1, plan: "SMG20", memberNumber: "80012345" },
    guardian: {
      name: "Carolina Sosa",
      relationship: "Madre",
      phone: { country: "AR", number: "3514100103" },
    },
  },
  {
    firstName: "Jorge",
    lastName: "Fernández",
    phone: { country: "AR", number: "3514100004" },
    dni: "12345678",
    birthDate: "1951-11-30",
    coverage: { insurer: 3, plan: null, memberNumber: "150987654321" },
  },
  {
    firstName: "Sofía",
    lastName: "López",
    phone: { country: "AR", number: "3514100005" },
    email: "sofi.lopez@prueba.example.com",
  },
  {
    firstName: "Alejandro",
    lastName: "Martínez",
    chosenName: "Ale",
    phone: { country: "AR", number: "3514100006" },
    dni: "35666777",
    coverage: { insurer: 0, plan: "210", memberNumber: "61234567802" },
  },
  {
    firstName: "Camila",
    lastName: "Pérez",
    phone: { country: "AR", number: "3514100007" },
    birthDate: "1996-01-15",
    coverage: { insurer: 2, plan: null, memberNumber: "200111222" },
  },
  {
    firstName: "Federico",
    lastName: "Díaz",
    phone: { country: "AR", number: "3514100008" },
    address: "Obispo Trejo 1020, 3° B",
  },
  {
    firstName: "Mariana",
    lastName: "Romero",
    phone: { country: "AR", number: "3514100009" },
    dni: "33222111",
    coverage: { insurer: 1, plan: "SMG30", memberNumber: "80054321" },
  },
  {
    firstName: "Tomás",
    lastName: "Álvarez",
    phone: { country: "AR", number: "3514100010" },
    birthDate: "2018-04-03",
    guardian: {
      name: "Pablo Álvarez",
      relationship: "Padre",
      phone: { country: "AR", number: "3514100110" },
    },
  },
  {
    firstName: "Gabriela",
    lastName: "Torres",
    phone: { country: "AR", number: "3514100011" },
    coverage: { insurer: 3, plan: null, memberNumber: "150123123123" },
  },
  {
    firstName: "Diego",
    lastName: "Ruiz",
    phone: { country: "AR", number: "3514100012" },
    email: "diego.ruiz@prueba.example.com",
  },
  {
    firstName: "Florencia",
    lastName: "Herrera",
    phone: { country: "AR", number: "3514100013" },
    coverage: { insurer: 0, plan: "410", memberNumber: "61234567803" },
  },
  {
    firstName: "Ricardo",
    lastName: "Medina",
    phone: { country: "AR", number: "3514100014" },
    birthDate: "1962-06-18",
  },
  {
    firstName: "Agustina",
    lastName: "Castro",
    phone: { country: "AR", number: "3514100015" },
    coverage: { insurer: 2, plan: null, memberNumber: "200999888" },
  },
  {
    firstName: "Hernán",
    lastName: "Vega",
    phone: { country: "AR", number: "3514100016" },
  },
  {
    firstName: "Paula",
    lastName: "Molina",
    phone: { country: "AR", number: "3514100017" },
    dni: "37888999",
    whatsappConsent: false,
  },
  {
    firstName: "Esteban",
    lastName: "Ríos",
    phone: { country: "AR", number: "3514100018" },
    coverage: { insurer: 1, plan: "SMG20", memberNumber: "80077777" },
    inactive: true,
  },
];

/**
 * Starts each practitioner books in a day, local time: Juan's from 08:00 to
 * 20:00 every day, Laura's from 09:00 to 17:00 on weekdays. A day uses some of
 * them, by its offset from today, so the week looks uneven.
 */
export const qaDayStarts: Record<QaPractitioner, readonly string[]> = {
  juan: ["08:30", "09:00", "10:00", "11:30", "12:00", "14:30", "16:00", "17:30", "18:00", "19:00"],
  laura: ["09:00", "10:30", "11:00", "13:00", "14:30", "15:30", "16:00"],
};

export const qaReceptionNotes = [
  "Trae estudios previos",
  "Avisar si se demora",
  "Primera vez en el consultorio",
  "Pide factura a nombre de la empresa",
];

export const qaCancellationReasons = ["Viaja por trabajo", "Reprogramación por agenda"];

/**
 * WhatsApp messages patients and strangers sent, as the webhook stores them, in
 * E.164: a few conversations at different ages, for the inbox.
 */
export const qaIncomingMessages = [
  {
    from: "+5493514100001",
    text: "Buen día, ¿puedo pasar el turno a la tarde?",
    minutesAgo: 600,
  },
  { from: "+5493514100001", text: "Si no se puede no pasa nada", minutesAgo: 595 },
  {
    from: "+5493514100004",
    text: "Hola, ¿necesito orden de PAMI para el control?",
    minutesAgo: 240,
  },
  { from: "+5493514100103", text: "Hola! Soy la mamá de Valentina", minutesAgo: 120 },
  { from: "+5493514100103", text: "¿Tienen turno para esta semana?", minutesAgo: 119 },
  { from: "+5493514100009", text: "Gracias por la atención de ayer 🙌", minutesAgo: 45 },
  { from: "+5493514998888", text: "Hola, ¿cuánto sale la consulta particular?", minutesAgo: 15 },
  { from: "+5493514100012", text: "Estoy llegando 10 minutos tarde, perdón", minutesAgo: 3 },
] as const;
