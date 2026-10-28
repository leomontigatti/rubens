import { Link } from "@tanstack/react-router";

import { Alert, AlertDescription } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";
import { patientName } from "#/lib/patients.ts";
import { formatPhone } from "#/lib/phones.ts";
import { formatLocalDate } from "#/lib/schedules.ts";
import type { DuplicateCandidate, DuplicateMatch, Patient } from "#/server/patients.ts";

// The duplicate check as the registration and edit forms show it: a document
// another patient has is an error naming them; a likely duplicate opens a
// warning that offers that patient, or saves anyway.

/** The refusal of a document another patient has, with a link to them. */
export function DocumentTakenAlert({ holder }: { holder: Patient | null }) {
  if (!holder) {
    return null;
  }
  return (
    <Alert variant="destructive">
      <AlertDescription>
        Ya hay un paciente con ese documento:{" "}
        <Link
          to="/pacientes/$patientId"
          params={{ patientId: holder.id }}
          className="underline underline-offset-4"
        >
          {patientName(holder)}
        </Link>
        .
      </AlertDescription>
    </Alert>
  );
}

const matchLabels: Record<DuplicateMatch, string> = {
  phone: "Mismo teléfono",
  nameAndBirthDate: "Mismo nombre y fecha de nacimiento",
};

/** What tells the candidate apart, and why they matched. */
function candidateDetails({ patient, matches }: DuplicateCandidate): string {
  return [
    formatPhone(patient.phone),
    patient.birthDate && formatLocalDate(patient.birthDate),
    ...matches.map((match) => matchLabels[match]),
    !patient.active && "Inactivo",
  ]
    .filter(Boolean)
    .join(" · ");
}

function CandidateRow(props: { candidate: DuplicateCandidate; onUse: (patient: Patient) => void }) {
  const { patient } = props.candidate;
  return (
    <li className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-medium">{patientName(patient)}</span>
        <span className="text-muted-foreground text-sm">{candidateDetails(props.candidate)}</span>
      </div>
      <Button variant="outline" size="sm" onClick={() => props.onUse(patient)}>
        Usar este paciente
      </Button>
    </li>
  );
}

/**
 * The warning of a likely duplicate: open while there are `candidates`. The
 * user picks one of them, or confirms to save anyway.
 */
export function DuplicateWarning(props: {
  candidates: DuplicateCandidate[];
  confirmLabel: string;
  pending: boolean;
  onUse: (patient: Patient) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      open={props.candidates.length > 0}
      onOpenChange={(open) => {
        if (!open) {
          props.onCancel();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Ya está registrado?</DialogTitle>
          <DialogDescription>
            Estos pacientes podrían ser la misma persona. Usá uno de ellos, o guardá igual si es
            otra persona, como un hermano que comparte el teléfono.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-4">
          {props.candidates.map((candidate) => (
            <CandidateRow key={candidate.patient.id} candidate={candidate} onUse={props.onUse} />
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={props.onCancel}>
            Cancelar
          </Button>
          <Button disabled={props.pending} onClick={props.onConfirm}>
            {props.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
