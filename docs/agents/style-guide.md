# Style guide

The judgement calls of the interface, written with the first screens, one decision at a time,
each with the reason and a component that gets it right.

The mechanical rules live in `pnpm lint`, each message carrying its reason: `@shadcn/lint`'s
rules and the repo's `ui` plugin (`scripts/oxlint-ui-plugin.mjs`), configured in
`vite.config.ts` and tested in `tests/lint/ui-rules.test.ts`. Where they disagree with this
page, they are current. Why a linter and not only this page:
[design-system-enforcement.md](../research/design-system-enforcement.md).

`/dev/patrones`, served only by `pnpm dev`, draws each pattern once. A pattern added here gets an
entry there in the same PR.

What is settled already:

- The base is shadcn/ui on Tailwind 4, in the `base-nova` style, on Base UI (see [shadcn.md](./shadcn.md)).
- The UI is Spanish; the copy is written with the user's terms from `GLOSSARY.md`
  (the `ui:` values), not with code identifiers.
- **Tokens and variants before classes.** A colour, radius or state comes from a token or a
  component variant, and `className` is for layout. A component in `src/components/ui` keeps
  its look: pick a `variant` or `size`, never restyle it from a screen. A case with no token
  gets a one-off class; a second case gets a variant or a component. A new token, variant or
  typeface is a product decision: ask before adding one.
- **A state is a `Badge` beside the name**, or in the `Estado` column of a table, never
  ` · Inactivo` in the text. It is neutral
  unless it changes what someone does next. On the calendar, colour says which practitioner, so
  a status there is an icon.

  | State                                           | Variant       |
  | ----------------------------------------------- | ------------- |
  | `Inactivo`, `Inactiva`, `Cancelado`, `Atendido` | `secondary`   |
  | `Sobreturno`, `Principal`, `Menor de edad`      | `outline`     |
  | `Datos incompletos`                             | `warning`     |
  | `Ausente`, `Turnos a reprogramar` count         | `destructive` |

- **An existing component before new markup.** Look in `src/components/ui` and the shared
  components in `src/components/` ([codebase-map.md](./codebase-map.md#layout)) before writing
  one; extend one with a variant rather than copy its markup. A shadcn component the screen
  needs is added with the CLI ([shadcn.md](./shadcn.md)), never written by hand.
- **Stop and ask when the guide has no answer.** A screen that needs a component, a pattern or
  a layout this page and the shared components do not cover is a design decision, not an
  implementation detail: stop and ask the user before building it, with what you would do and
  why. Once decided, it goes in the same PR as a component, a lint rule where a machine can judge
  it, and a line here, so the next screen finds it.

## Page shell

Every signed-in screen sits in one shell, `_app.tsx`, for every role: the sidebar, and the page
beside it.

- **Every role opens on the calendar**: `/` goes to `/agenda`.
- **A new screen gets one link in the sidebar**, in `src/components/app-nav.ts`, in the group that
  fits: `Día a día` for what reception uses all day, `Profesionales` for what a practitioner sets
  up, `Administración` for the organization's own setup. A detail page gets no link: its parent
  stays current. A new group is a product decision: ask.
- **A link is hidden only when the screen has nothing for that role.** The menu spares a click and
  guards nothing: the screen's server functions decide what a member may do.
- **Every link has a `lucide` icon**, the only thing left when the sidebar is collapsed.
- **Every page opens with `PageHeader`**, never its own `<h1>` (`pnpm lint` enforces it): `title`,
  `back` on a detail page, `status` for its `Badge`, `description` for a line of detail, and
  `actions` for the buttons that act on the whole page. A page that is one card holding one form,
  `/ingresar` and `/cambiar-contrasena`, is titled by its `CardTitle` instead.

## Filters

- **What narrows a list or the calendar is `FilterBar`** (`src/components/filter-bar.tsx`), never
  a row of selects. A form that asks and answers, such as `/disponibilidad`, stays a form.
- **An applied filter is a button group**: its name, its value as a menu, a trash button; the
  rest come from `Agregar filtro`. A filter that always holds a value, the calendar's
  `Consultorio`, is `required`: always shown, with no trash button.
- **A filter's icon is the one the sidebar gives its concept.** A value's menu has no search; the
  picker gets one past seven values.

## Empty states

- **A page or a list with nothing to show is `EmptyState`** (`src/components/empty-state.tsx`),
  with the icon the sidebar gives its concept. A list that can hide inactive records never says none
  exist: it points at them while they are hidden.
  Inside a form, a dialog, a menu or a section of a page, a sentence is enough.
- **It says why and what to do next**, naming the button that does it. `canAct` hides it from
  someone who cannot do it: without the permission, the title stands alone.

## Tables

- **A list of records is `DataTable`** (`src/components/data-table.tsx`): `useClientDataTable` when
  the loader sends the whole list, `useServerDataTable` when a list can grow without limit, so the
  server searches and pages it. The `ui/no-raw-table` lint rule rejects any other table.
- **Rows are 40 px, with no actions column.** The cell that names the record holds its `RowLink`,
  and only that link opens it, so the rest of a row can be selected and copied. Every action lives
  on the record.
- **One toolbar, above the table:** `SearchInput`, then `FilterBar`. A list's show-or-hide choices
  are filters, not buttons in the header.
- **A server search waits 300 ms for typing to pause**, shows a spinner in the box, and shows only
  the answer to the text in the box: earlier rows never stand in for it.
- **The footer counts:** `25 de 36 registros`, on the left, with the pager on the right when there
  is more than one page. A patient search has no count: it stops at its 20 best matches, and when
  more patients match, a muted line under the results says so and asks for more text.
- **A list page takes the full width.** Patient search text stays out of the URL.

## Form pages

- **A create or an edit is a page of its own**, `FormPage` (`src/components/form-page.tsx`), never
  in a list, a card, a dialog or a side panel, until a case proves otherwise. `pnpm lint` rejects any
  other `<form>` (`ui/no-raw-form`). `CreateButton` opens a create's page.
- **A form that holds a form of its own goes in `lead`**, above the form element: booking's patient
  picker, whose quick registration submits apart. Its problems still show under its field.
- **The fields take the page's width, outside any card.** The actions close the form: `Volver` on
  the left, `Descartar cambios` and the submit button on the right. On a long form they stick to the
  bottom of the window.
- **`Volver` goes where the browser's back goes**, so a list comes back with its filters and page.
- **`Descartar cambios` shows once something differs from what the form opened with.**
- **While saving, the submit button is disabled and shows a spinner, and the other buttons are
  disabled with it.** The spinner is the visible reason a disabled button needs. With nothing
  changed, the submit button stays enabled: nothing would say why it is not.
- **Leaving with unsaved changes asks**, by any way out: `Volver`, the sidebar, the browser's back,
  a closed tab. `Descartar cambios` asks the same question, because it cannot be undone.
- **A successful save goes back**, unless what comes next is on the new record: a registered patient
  opens their page. A save the page must confirm stays: the starting password's `Listo`.
- **A record has one form for its own fields**: its page shows values in `RecordSection`s
  (`src/components/record-section.tsx`), and one `Editar` opens them all, saved together in one
  transaction. A record of its own, such as a coverage, and a one-off action, such as a starting
  password, keep their own page.
- **When the edit page is a record's only page, its actions sit beside its title**: `Desactivar` or
  `Reactivar`, with an `Inactiva` badge (`activeRecord`, `src/components/admin-form.tsx`), or
  `Eliminar`, which asks first and goes back to the list (`FormPage`'s `record`). A record with a
  page of its own, such as an office (`Sedes`), has them in that page's header beside `Editar`.
  Its list's name cell links only for someone who may open the page, and is plain text otherwise.
- **A page that is only its form stays as it is**: `/ingresar`, `/cambiar-contrasena`, and
  `/disponibilidad`, which asks and answers.

## Forms

What a form checks and when, after GOV.UK's
[validation pattern](https://design-system.service.gov.uk/patterns/validation/) and the rules
carried over from en-escena.

- **A form's values live in `useAppForm`** (`src/components/app-form.tsx`, on TanStack Form): each
  field is a `form.AppField` with one of its field components, and a form needing a new kind adds
  one there. `pnpm lint` rejects an uncontrolled input (`ui/no-uncontrolled-input`). The pages
  that are only their form (`/ingresar`, `/cambiar-contrasena`, `/disponibilidad`) are the
  exception: they read the form's `FormData` on submit and show one problem in an `ErrorAlert`,
  with no per-field errors or unsaved changes for the form kit to hold. Their inputs stay
  uncontrolled, so what the browser autofills or a user types before hydration is what submits.
- **A field is `Field` with a `FieldLabel`, never a hand-made wrapper** (`pnpm lint` enforces it:
  `ui/no-bare-label`). The label sits above the input. A placeholder shows an example, never the
  label.
- **A rule the user needs while typing is a hint under the field**: a `FieldDescription`, with
  the input's `aria-describedby` pointing at it: `PhoneField` (`src/components/patient-form.tsx`).
- **Fields sit in a column or a grid**, where they fill their cell. In a `flex` row, each takes
  `className="w-auto"`, or it takes the whole line. An input narrower than its field takes
  `max-w-*`: `Field` sets its children's `width`.
- **A checkbox is a horizontal `Field` with `className="w-fit"`**, the box before its label:
  without `w-fit` the label fills the row, and a click on the empty space ticks the box.
  A group of them is a `FieldSet` with a `FieldLegend variant="label"`, and its boxes in a
  `FieldGroup data-slot="checkbox-group"`.
- **A required field is said in words when the context needs it**, never by an asterisk alone.
- **Every `<form>` takes `method="post"`.** Submitted before the page hydrates, the browser sends
  the form on its own, and a GET puts every field, a password included, in the URL, the history and
  any access log. `pnpm lint` enforces it (`ui/require-post-method`).
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
- **One record picked from a server search is the form kit's `ComboboxField`**
  (`src/components/app-form.tsx`), as booking's patient picker: it searches as [Tables](#tables)
  says, its list opens only on the answer to the text in the box, and the record picked stays in
  the box.
- **Several options are picked in place**, as a group of checkboxes (a schedule's days, a
  member's roles), never in a popover that covers what follows.
- **A `Checkbox` for a boolean submitted with the form**; a switch, once there is one, for a
  setting that takes effect on its own and reads as on or off.
- **A long form splits into titled sections**, never cards nested in cards.

**Where the error shows.** Each error sits under its field, the input marked `aria-invalid` and
pointing at it with `aria-describedby`, and focus moves to the first refused field, which brings it
into view. `FormPage` does all of this: a form passes what its schema refused through `fieldProblems`
(`src/components/form-problems.ts`), and `page.showProblems` shows it. An error stays until the next
submit. There is no summary of the fields' errors: on forms this short it only repeats them.

A server refusal about one field shows the same way, under that field: `useFormAction`'s second
argument names them (`emailTaken`). A refusal about no field is the only error above the form, in an
`ErrorAlert`, and takes the focus. A refusal the page must link from keeps its own `Alert` and marks
the field: `DocumentTakenAlert`.

The pages that are only their form show one problem in an `ErrorAlert`: `/ingresar`,
`/cambiar-contrasena`, `/disponibilidad`.

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
| Saved, and the change shows on the screen             | No message: the page it goes back to, with the updated row or value, is the answer.                                                |
| Saved, and nothing on the screen shows it             | An `Alert` that stays: the starting password's `Listo.` (`src/routes/_app/personal/$memberId.tsx`).                                |
| A field locked by the record's state                  | An `Alert` above the form listing every reason and what unlocks it, or saying nothing does; a lock icon alone explains nothing.    |
| A condition to know before acting, found by the app   | A `warning` `Alert` on the page.                                                                                                   |
| An action with no form failed, or the network dropped | A toast, once the app has one; it disappears on its own, so it never carries something the user must fix.                          |

- **After a save, a form page goes back**, and the screen's data reloads (`useFormAction`). A
  create whose next step is on the new record goes there: a registered patient opens their page.
  Never navigate only to show a message.
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
