// A template's components in Meta's own vocabulary
// (https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components):
// the body and its quick-reply buttons as a template is submitted for review,
// and the body's values and the buttons' payloads as a message is sent with
// it (ADR-0014). The Graph API client (`graph-api.ts`) posts them.

/** A template's components as it is submitted: its body with each variable's example, and its quick-reply buttons' labels. */
export function componentsToCreate(
  body: string,
  examples: { param_name: string; example: string }[],
  buttons: readonly string[],
) {
  return [
    {
      type: "BODY",
      text: body,
      // Meta refuses an example for a body with no variables.
      ...(examples.length > 0 && { example: { body_text_named_params: examples } }),
    },
    ...(buttons.length > 0
      ? [{ type: "BUTTONS", buttons: buttons.map((text) => ({ type: "QUICK_REPLY", text })) }]
      : []),
  ];
}

/** A message's components: the value of each variable its body uses, and the payload of each button that carries one. */
export function componentsToSend(
  parameters: { name: string; value: string }[],
  buttonPayloads: { index: number; payload: string }[],
) {
  return [
    ...(parameters.length > 0
      ? [
          {
            type: "body",
            parameters: parameters.map(({ name, value }) => ({
              type: "text",
              parameter_name: name,
              text: value,
            })),
          },
        ]
      : []),
    ...buttonPayloads.map(({ index, payload }) => ({
      type: "button",
      sub_type: "quick_reply",
      index,
      parameters: [{ type: "payload", payload }],
    })),
  ];
}
