import { useEffect, useState } from "react";

import { Detail, RecordSection } from "#/components/record-section.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import {
  proposalKindLabels,
  proposalState,
  proposalStatement,
  sandboxOutcomeLabels,
  windowCountdown,
} from "#/lib/assistant-sandbox-copy.ts";
import type { playSandboxTurn } from "#/server/whatsapp.functions.ts";

// What the sandbox shows beside its conversation (docs/domain/assistant.md §
// Trying it): the window's countdown, the number of messages, the proposals,
// and the last turn's outcome and clinical check.

export type Played = Extract<Awaited<ReturnType<typeof playSandboxTurn>>, { ok: true }>;

type Turn = Played["turn"];

/** The current time, read again every `everyMs`, for a countdown. */
function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

export function SandboxState(props: { sandbox: Played["sandbox"]; windowClosesAt: number | null }) {
  const now = useNow(30_000);
  const { sandbox } = props;
  return (
    <RecordSection title="Estado">
      <div className="flex flex-col gap-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Detail
            label="Ventana de conversación"
            value={windowCountdown(props.windowClosesAt, now)}
          />
          <Detail label="Mensajes" value={sandbox.messages.length} />
        </dl>
        <div className="flex flex-col gap-2">
          <h3 className="text-muted-foreground text-sm">Propuestas</h3>
          {sandbox.proposals.length === 0 ? (
            <p className="text-sm">Ninguna todavía.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {sandbox.proposals.map((one) => (
                <li key={one.id} className="flex flex-wrap items-center gap-2 text-sm">
                  {proposalKindLabels[one.kind]}: {proposalStatement(one.statement)}
                  <ProposalBadge proposal={one} now={now} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </RecordSection>
  );
}

export function SandboxLastTurn({ turn }: { turn: Turn }) {
  return (
    <RecordSection title="Último turno">
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          {/* A held reply opens a handoff to the practitioner, which the patient is told. */}
          {sandboxOutcomeLabels[turn.held === null ? turn.outcome : "toPractitioner"]}
        </p>
        {turn.held !== null && (
          <Alert variant="warning">
            <AlertTitle>El control clínico retendría esta respuesta</AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">{turn.held}</AlertDescription>
          </Alert>
        )}
      </div>
    </RecordSection>
  );
}

function ProposalBadge(props: {
  proposal: { acceptedAt: number | null; expiresAt: number };
  now: number;
}) {
  const state = proposalState(props.proposal, props.now);
  return <Badge variant={state.variant}>{state.label}</Badge>;
}
