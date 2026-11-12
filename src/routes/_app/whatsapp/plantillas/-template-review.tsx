import { CircleCheckIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { templateReviewRefusals } from "#/lib/whatsapp-template-copy.ts";
import type { reviewTemplate } from "#/server/whatsapp.functions.ts";

// The assistant's review of the text being written (#345), beside the
// preview: `Revisar` sends the text as it is in the box, unsaved edits
// included, and lists the model's notes. It only advises, so a failure is a
// plain line and the form stays as it was.

type ReviewAnswer = Awaited<ReturnType<typeof reviewTemplate>>;

/** What the last review said: its notes, or why it has none; for the text it read. */
type Reviewed = { body: string } & (
  | { notes: string[] }
  | { refusal: keyof typeof templateReviewRefusals }
);

export function TemplateReview(props: {
  body: string;
  review: (body: string) => Promise<ReviewAnswer>;
}) {
  const [running, setRunning] = useState(false);
  const [reviewed, setReviewed] = useState<Reviewed | null>(null);

  async function run() {
    const body = props.body;
    setRunning(true);
    const answer = await props.review(body).catch(() => null);
    setReviewed(
      !answer
        ? { body, refusal: "reviewFailed" }
        : answer.ok
          ? { body, notes: answer.notes }
          : { body, refusal: answer.reason },
    );
    setRunning(false);
  }

  return (
    <section aria-labelledby="template-review" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="template-review" className="text-sm font-medium">
          Revisión del asistente
        </h2>
        <p className="text-muted-foreground text-sm">
          Lee el texto con el trato, el tono y las reglas de Meta. Solo sugiere: no impide guardar.
        </p>
      </div>
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={running || !props.body.trim()}
          onClick={() => void run()}
        >
          {running ? (
            <Spinner data-icon="inline-start" aria-hidden />
          ) : (
            <SparklesIcon data-icon="inline-start" aria-hidden />
          )}
          {running ? "Revisando…" : "Revisar"}
        </Button>
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {running ? (
          <p className="text-muted-foreground text-sm">El asistente está leyendo el texto.</p>
        ) : (
          reviewed && (
            <>
              <ReviewOutcome reviewed={reviewed} />
              {reviewed.body !== props.body && (
                <p className="text-muted-foreground text-sm">
                  El texto cambió desde esta revisión. Revisalo de nuevo para ver el actual.
                </p>
              )}
            </>
          )
        )}
      </div>
    </section>
  );
}

function ReviewOutcome({ reviewed }: { reviewed: Reviewed }) {
  if ("refusal" in reviewed) {
    return (
      <p className="text-muted-foreground text-sm">{templateReviewRefusals[reviewed.refusal]}</p>
    );
  }
  if (reviewed.notes.length === 0) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <CircleCheckIcon className="size-4" aria-hidden />
        Sin observaciones.
      </p>
    );
  }
  return (
    <Alert variant="warning">
      <AlertTitle>Observaciones</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4">
          {reviewed.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
