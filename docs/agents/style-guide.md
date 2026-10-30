# Style guide

The judgement calls of the interface, written with the first screens, one decision at a time,
each with the reason and a component that gets it right.

The mechanical rules live in `pnpm lint`, each message carrying its reason: `@shadcn/lint`'s
rules and the repo's `ui` plugin (`scripts/oxlint-ui-plugin.mjs`), configured in
`vite.config.ts` and tested in `tests/lint/ui-rules.test.ts`. Where they disagree with this
page, they are current. Why a linter and not only this page:
[design-system-enforcement.md](../research/design-system-enforcement.md).

What is settled already:

- The base is shadcn/ui on Tailwind 4, in the `base-nova` style, on Base UI (see [shadcn.md](./shadcn.md)).
- The UI is Spanish; the copy is written with the user's terms from `GLOSSARY.md`
  (the `ui:` values), not with code identifiers.
- **Tokens and variants before classes.** A colour, radius or state comes from a token or a
  component variant, and `className` is for layout. A component in `src/components/ui` keeps
  its look: pick a `variant` or `size`, never restyle it from a screen. A case with no token
  gets a one-off class; a second case gets a variant or a component. A new token, variant or
  typeface is a product decision: ask before adding one.
- **A state is a `Badge` beside the name**, never ` · Inactivo` in the text. It is neutral
  (`secondary`, `outline`) unless it changes what someone does next, then semantic:
  `Datos incompletos` is `warning`, `Ausente` is `destructive`. On the calendar, colour says
  which practitioner, so a status there is an icon.
- **An existing component before new markup.** Look in `src/components/ui` and the shared
  components in `src/components/` ([codebase-map.md](./codebase-map.md#layout)) before writing
  one; extend one with a variant rather than copy its markup. A shadcn component the screen
  needs is added with the CLI ([shadcn.md](./shadcn.md)), never written by hand.

## Forms

What a form checks and when, after GOV.UK's
[validation pattern](https://design-system.service.gov.uk/patterns/validation/) and the rules
carried over from en-escena.

- **Labels sit above the field.** A placeholder shows an example, never the label. A rule the
  user needs while typing is a hint under the field: `PhoneField`
  (`src/components/patient-form.tsx`).
- **A required field is said in words when the context needs it**, never by an asterisk alone.
- **Every `<form>` takes `noValidate`.** The browser's own `required` and `type="email"` popups
  speak the browser's language and style, and run before the form's own check. `required` stays
  on the input for what it tells a screen reader. `pnpm lint` enforces it
  (`ui/require-no-validate`).
- **Validate on submit, never as a field loses focus or while typing.** A check on blur
  interrupts someone still filling the form in, and catches people who type slowly the most. The
  form's Zod schema is the check, with `safeParse` on submit and never a thrown `parse`; the
  message is the form's own Spanish copy, never Zod's. The server parses the same schema again.
- **An empty required field and a wrong one get different messages**: `Ingresá el nombre.` for
  the first, what is wrong and an example for the second
  (`Ingresá el teléfono con su código de área, por ejemplo 0351 15 555-1234.`).
- **A refusal keeps everything the user typed**, the fields that passed included.
- **Several options are picked in place**, as a group of checkboxes (a schedule's days, a
  member's roles), never in a popover that covers what follows.
- **A `Checkbox` for a boolean submitted with the form**; a switch, once there is one, for a
  setting that takes effect on its own and reads as on or off.
- **A long form splits into titled sections**, never cards nested in cards.

**Where the error shows.** The target is GOV.UK's: each error under its field, the field marked
`aria-invalid` and pointing at it with `aria-describedby`, a summary of every error in an
`Alert` above the form, and focus moved to that summary. A server refusal about one field (a
document another patient holds) shows under that field the same way. Today every form shows
only the first problem, in an `ErrorAlert` above the form, and moves no focus. Moving to the
target is one change for every form at once; until then a form, new or changed, uses that shared
display and no other.

## Alerts

An `Alert` says what kind of message it is, not how loud: `variant` is required, and `Alert`
draws that variant's one icon itself.

| Variant       | For                                                               | Example                         |
| ------------- | ----------------------------------------------------------------- | ------------------------------- |
| `destructive` | An error: something went wrong                                    | `ErrorAlert`                    |
| `warning`     | Something to fix or regret                                        | `MinorPrompt`                   |
| `info`        | A state to know about, including a lock and what unlocks it       | `No se puede reprogramar`       |
| `success`     | An outcome that stays on screen, when the screen does not show it | The starting password's `Listo` |

- **A title and a description, always**: the title says what is going on in a few words, the
  description the detail and what to do, never repeating the title. `pnpm lint` enforces it
  (`ui/alert-structure`).
- **An alert is for what the screen does not already say.** A tinted box loses its meaning when
  every screen has one.
- **The semantic colours are not the brand's.** `success`, `info` and `warning` are tokens of
  their own; check them against the brand palette when it lands (#37). Their text keeps 4.5:1 on
  their tint, which is why tints are 6%.

## After a submit

Which channel carries a message, and where the user lands.

| What happened                                         | Channel                                                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| The form's own check failed                           | The error display above ([Forms](#forms)).                                                                                         |
| The server refused the submit                         | The same display, with copy that says what to fix and names and links what blocks it: `DocumentTakenAlert`.                        |
| A likely duplicate, which may be legitimate           | A confirmation that lists the matches and saves only when confirmed: `DuplicateWarning` (`src/components/patient-duplicates.tsx`). |
| Saved, and the change shows on the screen             | No message: the closed panel and the updated row or page are the answer.                                                           |
| Saved, and nothing on the screen shows it             | An `Alert` that stays: the starting password's `Listo.` (`src/routes/_app/personal/$memberId.tsx`).                                |
| A field locked by the record's state                  | An `Alert` above the form listing every reason and what unlocks it, or saying nothing does; a lock icon alone explains nothing.    |
| A condition to know before acting, found by the app   | A `warning` `Alert` on the page.                                                                                                   |
| An action with no form failed, or the network dropped | A toast, once the app has one; it disappears on its own, so it never carries something the user must fix.                          |

- **Stay on the page unless it stops making sense.** An edit or a create made in a panel stays,
  and the screen's data reloads (`useFormAction`). A create whose next step is on the new
  record goes there: a registered patient opens their page. Never navigate only to show a
  message.
- **A message is about one submit or one state.** A refusal of what was just submitted goes
  with the form; a state of the record (inactive, incomplete data) is a badge or an `Alert` on
  the page, shown to everyone who sees the record, whatever their role.

## An action that cannot run

What decides the treatment is whether the user can do anything about it. A button is never
disabled with no reason beside it: the user cannot tell why, and a disabled button is skipped by
the keyboard and by screen readers.

| Why it cannot run                                     | Treatment                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| The user's role never allows it                       | Hidden.                                                                                                            |
| A state of the record that never reverts (it started) | Hidden: a schedule's `Eliminar` shows only before its first date. Where people look for it, a short note says why. |
| A state the user can clear                            | Enabled; on use, an `Alert` or dialog lists every reason and what unblocks it. The server refuses all the same.    |

## Confirming an action

A confirmation interrupts, so it is kept for what the user cannot undo or would not expect.
It is a `ConfirmDialog` (`src/components/confirm-dialog.tsx`), never `AlertDialog` directly: a
question that names the thing, what is lost in the description, and a destructive button
repeating the action's name. It carries no `destructive` `Alert`: the dialog is already the
warning, and `destructive` means something went wrong. A `warning` `Alert` joins it only when
the loss goes beyond the record being deleted.

| Action                              | Treatment                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Eliminar`                          | Always confirmed: `¿Eliminar este horario?`. A record that must stay is deactivated, never deleted. |
| `Desactivar` with consequences      | Confirmed, saying what happens: `DeactivateButton` gives the count of future appointments.          |
| `Desactivar` with none, `Reactivar` | At once: it can be reversed the same way.                                                           |

Deactivating a room or an office has consequences too, and does not ask yet.
