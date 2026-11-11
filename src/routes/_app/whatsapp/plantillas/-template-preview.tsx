import { CircleCheckIcon } from "lucide-react";

import { RecordSection } from "#/components/record-section.tsx";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { WhatsappBubble, WhatsappChat } from "#/components/whatsapp-bubble.tsx";
import {
  appointmentDay,
  appointmentTime,
  fillSample,
  sampleAppointment,
} from "#/lib/template-filling.ts";
import { mentionsSendTime } from "#/lib/template-timing.ts";
import { checkTemplateBody, templateVariables } from "#/lib/whatsapp-templates.ts";
import type { getWhatsappSettings } from "#/server/whatsapp.functions.ts";

import {
  problemText,
  rejectionText,
  templateCategoryLabels,
  templateStatusLabels,
  templateStatusVariants,
} from "#/lib/whatsapp-template-copy.ts";

// The template preview (docs/domain/assistant.md § Trying it): a template as
// the patient reads it on WhatsApp, filled with the sample appointment.

/** A submitted version of a template, as the WhatsApp settings list it. */
export type TemplateVersion = Extract<
  Awaited<ReturnType<typeof getWhatsappSettings>>,
  { ok: true }
>["templates"][number]["versions"][number];

const { patient, start, timeZone } = sampleAppointment;

const sampleNote = `Con un turno de ejemplo: ${patient.firstName}, el ${appointmentDay(start, timeZone)} a las ${appointmentTime(start, timeZone)}.`;

/**
 * The body being written for template `templateId` (`null` for a new one), as
 * WhatsApp shows it, what Meta's rules would refuse in it, and a warning when
 * it says when it is sent, which a late message would make wrong.
 */
export function TemplatePreview(props: {
  templateId: string | null;
  body: string;
  /** Fills `{{consultorio}}`, as a sent message would. */
  organizationName: string;
}) {
  const checked = checkTemplateBody(templateVariables(props.templateId), props.body);
  return (
    <section aria-labelledby="template-preview" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="template-preview" className="text-sm font-medium">
          Vista previa
        </h2>
        <p className="text-muted-foreground text-sm">{sampleNote}</p>
      </div>
      <WhatsappChat label="Así lo lee el paciente">
        <WhatsappBubble>{fillSample(props.body, props.organizationName) || "…"}</WhatsappBubble>
      </WhatsappChat>
      {mentionsSendTime(props.body) && (
        <Alert variant="warning">
          <AlertTitle>El texto dice cuándo se envía</AlertTitle>
          <AlertDescription>
            Si el mensaje sale más tarde, &quot;mañana&quot;, &quot;hoy&quot; o &quot;en 2
            horas&quot; ya no serían ciertos. Usá {"{{fecha}}"} y {"{{hora}}"}.
          </AlertDescription>
        </Alert>
      )}
      {checked.ok ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <CircleCheckIcon className="size-4" aria-hidden />
          Cumple el formato de Meta. Meta revisa el contenido antes de aprobarla.
        </p>
      ) : (
        <Alert variant="warning">
          <AlertTitle>Meta no la aceptaría así</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {checked.problems.map((problem) => {
                const text = problemText(problem);
                return <li key={text}>{text}</li>;
              })}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <MetaReview />
    </section>
  );
}

/** What Meta's review looks for in a utility template, beyond the format checked above. */
function MetaReview() {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">Qué revisa Meta</h3>
      <ul className="text-muted-foreground list-disc pl-4 text-sm">
        <li>Que sea sobre el turno de este paciente.</li>
        <li>Que no tenga nada promocional.</li>
        <li>Que no tenga ofertas ni descuentos.</li>
      </ul>
    </div>
  );
}

/** Each version submitted to Meta side by side, newest first, with Meta's verdict. */
export function TemplateVersions({
  versions,
  organizationName,
}: {
  versions: TemplateVersion[];
  organizationName: string;
}) {
  if (versions.length === 0) {
    return null;
  }
  return (
    <RecordSection title="Versiones">
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {versions.map((version) => (
          <li key={version.id} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">Versión {version.version}</h3>
              <Badge variant={templateStatusVariants[version.status]}>
                {templateStatusLabels[version.status]}
              </Badge>
              {version.category !== "utility" && (
                <Badge variant="warning">{templateCategoryLabels[version.category]}</Badge>
              )}
              {version.inUse && <Badge variant="outline">En uso</Badge>}
            </div>
            {version.status === "rejected" && (
              <p className="text-destructive text-sm">
                {version.rejectionReason
                  ? rejectionText(version.rejectionReason)
                  : "Meta no dio el motivo."}
              </p>
            )}
            <WhatsappChat label={`Versión ${version.version}, como la lee el paciente`}>
              <WhatsappBubble>{fillSample(version.body, organizationName)}</WhatsappBubble>
            </WhatsappChat>
          </li>
        ))}
      </ul>
    </RecordSection>
  );
}
