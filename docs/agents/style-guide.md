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
- **A badge only shows a state out of the ordinary**: an archived record (`ArchivedBadge`), an
  incomplete patient, a minor, a patient without WhatsApp, a coverage's `Principal`. The regular state has none: no `Activo`
  badge, no `Estado` filter, since a list already shows only active records. A state is a `Badge`
  beside the name, never ` · Archivado` in the text, and a table has no `Estado` column. Every list looks alike unless a screen says otherwise: its first cell is
  `RowName` (`data-table.tsx`), the only way a list links a row: its name or link and its states
  beside the name. An avatar with up to two initials (`avatar`) and a `detail` line under the name
  (a template's timing) are each a deliberate choice, off by default. A badge's colour means what an
  alert's and a toast's does: `warning` and `destructive` for what changes what someone does
  next, and neutral for the rest. On the calendar, colour says
  which practitioner, so a status there is an icon.

  | State                                         | Variant       |
  | --------------------------------------------- | ------------- |
  | `Cancelado`, `Atendido`                       | `secondary`   |
  | `Archivado`, `Archivada`, as its page's alert | `info`        |
  | `Sin WhatsApp`, as its page's alert           | `info`        |
  | `Sobreturno`, `Principal`, `Menor de edad`    | `outline`     |
  | `Incompleto`                                  | `warning`     |
  | `Ausente`, `Turnos a reprogramar` count       | `destructive` |

- **A record is archived, never deactivated**: `Archivar` takes it out of use and `Restaurar`
  brings it back; its badge says `Archivado` or `Archivada`, and a message about it `está
  archivado` (GLOSSARY.md, `inactive`). A list shows only active records; its `Archivados` (or
  `Archivadas`) filter, off by default, adds the archived ones (`archivedFilter`,
  `src/components/filter-groups.ts`). An archived record's page says so in an `info` alert
  above the form (`Paciente archivado`, `ArchivedAlert`), with `Restaurar` as its action for whoever may restore
  it, a `link` button in the alert's colour, centred on its right edge, and what someone else can do instead
  for the rest. Every record page has it, through `activeRecord`'s `archived` (its title and what
  archiving it changes); a form dialog's record shows `Restaurar` in its footer instead.

- **An existing component before new markup.** Look in `src/components/ui` and the shared
  components in `src/components/` ([codebase-map.md](./codebase-map.md#layout)) before writing
  one; extend one with a variant rather than copy its markup. A shadcn component the screen
  needs is added with the CLI ([shadcn.md](./shadcn.md)), never written by hand.
- **Stop and ask when the guide has no answer.** A screen that needs a component, a pattern or
  a layout this page and the shared components do not cover is a design decision, not an
  implementation detail: stop and ask the user before building it, with what you would do and
  why. Once decided, it goes in the same PR as a component, a lint rule where a machine can judge
  it, and a line here, so the next screen finds it.

## Copy

A screen is used, not read: its words are the ones a person needs to act. What an agent tends to
add beyond them reads as generated and buries the rest.

- **A line under a heading says what the heading does not.** A page's or a dialog's
  `description` says what Page shell and Form pages give it to say, never the title again or an
  order to manage it: `Sedes` /
  `Los lugares de atención, cada uno con sus consultorios.`, never `Administrá las sedes de la
  organización.` A section, a card or a menu item gets no line of its own unless it carries a
  fact.
- **No text narrates the screen or how it was built**: no `Hacé clic en el botón para empezar`,
  `Esta tabla muestra los turnos`, `(se actualiza en tiempo real)`. An instruction earns its place
  only where the user would otherwise get it wrong: a field's rule (`Código de área sin 0 y
  número sin 15.`), an empty state's way to start.
- **Only the label names a field.** A placeholder shows an example of the
  format (`Av. Colón 1234, Córdoba`) and a hint states a rule (Forms); neither repeats the label.
- **Say what happens, not how it feels.** Name the mechanism, the person or the number:
  `underthing deja de enviar y recibir mensajes de WhatsApp hasta que conectes un número de
  nuevo.`, never `Desconectá tu WhatsApp fácilmente.` No adverb that a number or a stronger verb
  could replace (`fácilmente`, `rápidamente`, `simplemente`), and no sentence that would fit
  another product unchanged.
- **Name who acts when it changes what the user expects**: underthing, the patient, the
  practitioner or `vos`. `No le llega al paciente.` says who does not get the message; a bare
  `se envía` leaves the reader asking who sends it. An impersonal `se` stays where the actor does
  not matter (`Todavía no se envió a Meta`).
- **No em dash in a sentence**: a period or a comma instead. A lone `—` stands for an empty value
  (`Detail`, `src/components/record-section.tsx`).

## Page shell

Every signed-in screen sits in one shell, `_app.tsx`, for every role: the sidebar, and the page
beside it.

- **Every role opens on the calendar**: `/` goes to `/agenda`.
- **A new screen gets one link in the sidebar**, in `src/components/app-nav.ts`, in the group that
  fits: `Día a día` for what reception uses all day, `Profesionales` for what a practitioner sets
  up, `Administración` for the organization's own setup. A detail page gets no link: its parent
  stays current. A new group is a product decision: ask.
- **An area of several pages is a folder in its group**: a link with a chevron that opens its
  entries (`SidebarMenuSub`, in a `Collapsible`), never a page of its own, and open while the
  current page is one of them: `WhatsApp`, with `Configuración` and `Plantillas`. Its entries have
  no icon: with the sidebar collapsed, the folder's icon stands for them, and a click on it opens
  the menu.
- **A link is hidden only when the screen has nothing for that role.** The menu spares a click and
  guards nothing: the screen's server functions decide what a member may do.
- **Every link has a `lucide` icon**, the only thing left when the sidebar is collapsed.
- **Every page opens with `PageHeader`**, never its own `<h1>` (`pnpm lint` enforces it): `title`,
  `status` for its `Badge`, `description` for a line of detail, and `actions` for the buttons
  that act on the whole page. The way up is the top bar's breadcrumbs, not a link in the header. A page in the sidebar has a one-line
  `description` saying what it is for; a detail or form page uses it for the record (an address,
  an email, a name). A page that is one card holding one form,
  `/ingresar` and `/cambiar-contrasena`, is titled by its `CardTitle` instead.
- **A refused detail page keeps its header**, above the refusal's `ErrorAlert`, and its
  breadcrumbs keep the way back to its list: `/conversaciones/$conversationId`.
- **The top bar holds the breadcrumbs and the member's own things.** After the sidebar's toggle,
  `AppBreadcrumbs` names the section as the sidebar does, then the steps a page under it declares
  in its route's `staticData.crumbs` (`fixedCrumbs` for fixed labels, a `Crumbs` component with
  `PageCrumbs` when a step names a record). At its end, the notifications bell with the unread
  count, then the account menu (`UserMenu`).

## Filters

- **What narrows a list or the calendar is `FilterBar`** (`src/components/filter-bar.tsx`), never
  a row of selects. A form that asks and answers, such as `/disponibilidad`, stays a form.
- **An applied filter is a button group**: its name, its value as a menu, a trash button; the
  rest come from `Agregar filtro`. A filter that always holds a value, the calendar's
  `Consultorio`, is `required`: always shown, with no trash button.
- **A filter's icon is the one the sidebar gives its concept.** A value's menu has no search; the
  picker gets one past seven values.

## Empty states

- **A page or a list with nothing to show is `EmptyState`** (`src/components/empty-state.tsx`;
  `pnpm lint` rejects the ui `Empty` anywhere else, `ui/no-raw-empty`), with the icon the sidebar
  gives its concept, in a dashed outline centred in the space the page leaves. Inside a form, a
  dialog, a menu or a section of a page, a sentence is enough.
- **Its title is short, `Sin sedes`; its description says there are none yet, then how to start**:
  `Todavía no hay sedes. Empezá creando la primera.` Without the permission to start, the first
  sentence stands alone. What the page is for goes in the page's subtitle, not here.
- **What to do next is a button in it**, as shadcn's `Empty` shows: `CreateButton` for a create,
  `EmptyStateLink` for a way elsewhere, the main action first and the rest `outline`, even when the
  page header has the same button. Pass only the buttons the viewer may use.
- **A list with no records has no search, filters or footer** (`DataTable`'s `noRecords`): the
  empty state's buttons are all there is to do. A search that finds nothing keeps them, and says
  so with `NoMatches`.
- **A list that hides archived records says none exist only when that is true.** Its loader
  answers `onlyInactive` when the default list is empty because every record is archived; then
  the empty state says `No hay sedes activas` and offers `Ver archivadas`. `/dev/patrones` shows
  each case.

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
- **A list page takes the full width.** Search text stays out of the URL, the patients' and the
  inbox's alike.
- **A short fixed list has no search or filters**, only the table and its count: `DataTable`
  with no `search`, as `/whatsapp/plantillas`, whose set of templates never changes.

## Form pages

- **By default, a create or an edit is a page of its own**, `FormPage`
  (`src/components/form-page.tsx`), never in a list, a card or a side panel. The exceptions are
  [Form dialogs](#form-dialogs), each named there. `pnpm lint` rejects any other `<form>`
  (`ui/no-raw-form`). `CreateButton` opens a create, with a leading plus: in the `PageHeader`'s
  `actions`, on the title's line, and again in the list's `EmptyState`.
- **A form that holds a form of its own goes in `lead`**, above the form element: booking's patient
  picker, whose quick registration submits apart. Its problems still show under its field.
- **A create's submit button names the thing**: `Crear prestación`, `Agregar cobertura`, never
  a bare `Crear`.
- **A form is one `Card`** (`FormPage` draws it): the fields in rows by their size in its
  content ([Forms](#forms)), and the actions in its footer, which sticks to the bottom of the window
  so a long form never hides them. The actions sit in one row: `Volver` on the left,
  `Descartar cambios` and the submit button on the right. The right-hand buttons wrap under
  `Volver` only when they do not fit, as the three and a long label (`Guardar y enviar a Meta`) at
  390px.
- **`Volver` goes where the browser's back goes**, so a list comes back with its filters and page.
- **On an edit, `Descartar cambios` shows once something differs from what the form opened with.**
  A create has none (`FormPage`'s `creates`): with no saved values to go back to, it would only
  empty the form, which `Volver` already does.
- **While saving, the submit button is disabled and shows a spinner, and the other buttons are
  disabled with it.** The spinner is the visible reason a disabled button needs. With nothing
  changed, the submit button stays enabled: nothing would say why it is not.
- **Leaving with unsaved changes asks**, by any way out: `Volver`, the sidebar, the browser's back,
  a closed tab, on a create as on an edit. `Descartar cambios` asks the same question, because it
  cannot be undone.
- **A successful save goes back**, unless what comes next is on the new record: a registered patient
  opens their page. A save the page must confirm stays: the starting password's `Listo`.
- **A record has one form for its own fields**: its page shows values in `RecordSection`s
  (`src/components/record-section.tsx`), and one `Editar` opens them all, saved together in one
  transaction, until the record's page becomes its form (below). A record of its own, such as a
  coverage, keeps its own page unless it is a form dialog's; a one-off action, such as a starting
  password, opens a dialog.
- **A page of settings is `RecordSection`s**, one per setting, each showing its values; its
  `Editar` opens that setting's own form page, saved apart from the rest, and a section that
  leads elsewhere has that link as its action (`Probar`): `/whatsapp/configuracion`.
- **A record's page is its edit form**, the model being an office's (`/sedes/$officeId`); detail
  pages move to it one by one. The list's name opens it: no detail page, no `Editar`. Its fields are
  the create's, in the same order, so a create and an edit look alike.
- **Its title is the record's name, with its state badge beside it** when there is one
  (`ArchivedBadge`, which shows none on an active record),
  and its actions on the right in one `Acciones` menu (`activeRecord`'s `menu`,
  `src/components/admin-form.tsx`): a create for each of its lists first, such as `Nuevo
  consultorio`, then, past a separator, `Archivar` in red or `Restaurar`, or `Eliminar`. Its
  items are text only, with no icons (`ui/no-menu-item-icon`). One
  that asks first keeps asking: its dialog sits outside the menu (`useDeactivation`). The name
  moves from the list row into the title and back (`RecordName`, through the router's view transitions); nothing else on the page animates. The
  subtitle says what the page holds, the same for every record, never one of its fields; a
  create's says what the new record is (`Una sala de la sede donde se atiende.`). The browser tab
  names the page as its title does: the record's name on its page (`pageHead`, `src/lib/page-title.ts`).
- **A record with lists of its own gets full-width `Tabs` under its header**: `Datos generales`
  first, holding the form, then one tab per list, named by it with a count of its active rows in an
  `outline` `Badge` (the tab list's background hides a `secondary` one). A list in a tab has no
  heading or button of its own: its create is in `Acciones`, and again in its empty state. A
  patient's page splits its form over `Datos generales` and `Contacto` (one form; a refusal opens
  the tab of the field it names), shows `Coberturas` and `Responsables` only once there is one,
  and ends with `Actividad`: `Turnos`, the past ones collapsed, and for an admin `Historial`,
  collapsed, each a line of shadcn's `Trace` that opens on its detail. A
  list page of its own keeps its create button visible in its header (`Nueva sede`).
  The form's tab stays mounted, so an edit survives a look at another tab, and a tab switch is no
  navigation, which would ask before discarding it. `?seccion=` only picks the tab a page
  opens on; a list row's pages lead back to their tab with it. A list in a tab is a `DataTable`
  like any other, and a row's actions, such as a coverage's `Hacer principal` and `Quitar`, are
  in its own page's `Acciones`, never buttons in the row.
- **Who can't edit the record sees its header and its lists**, with no form and no tabs. Its
  list's name cell links only for someone who may open the page, and is plain text otherwise.
- **A page that is only its form stays as it is**: `/ingresar`, `/cambiar-contrasena`, and
  `/disponibilidad`, which asks and answers.

## Form dialogs

The exception to a page of its own: a create and an edit in a `FormDialog`
(`src/components/form-dialog.tsx`) over the list the record lives in. Only the records listed
here take one; a new one is a product decision, added to this list first.

- **A record qualifies when it is small and lives only in its parent's list**: a few short fields,
  no list of its own, no history worth a page, nothing that links to it. Anything bigger stays a page:
  a dialog cannot hold tabs, a long form, or a list, and a page can be linked and gone back to.
- **Today: an office's rooms** (`/sedes/$officeId`, tab `Consultorios`), created from the office's
  `Acciones` > `Nuevo consultorio` and edited from the room's name.
- **The list opens it**: the row's name is a button (`RowName`'s `onOpen`) that looks like the
  other lists' links, and `CreateButton`'s `onClick` opens an empty one. No URL changes.
- **Its title is the record's name with its state badge**, like a record's page, and a create's
  is the thing (`Nuevo consultorio`). The description says what it holds, as a page's subtitle.
- **The fields stack in one column**, in the create's order, as on the page they replace.
- **The footer holds every action**: the record's state action (`Archivar` in red or
  `Restaurar`) on the left; `Cancelar` and the submit, named as on a page, on the right. No
  `Acciones` menu: there is room for the one action a small record has.
- **A question asked from it replaces its content**, never a second dialog over it
  (`FormDialog`'s `question`): `Cancelar` goes back to the form as it was left.
- **Closing drops what it holds**, by `Cancelar`, Escape or the close button, with no question
  first: it holds a few fields, and nothing else is lost. A click outside does not close it.
- **A save or a state change closes it**, and the list reloads behind it. A refusal shows above
  the fields, or under the field it names, with focus on the first problem, as on a page.

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
  uncontrolled, so what the browser autofills or a user types before hydration is what submits,
  save `/disponibilidad`'s `Fecha`: a controlled `DateInput` that submits through a hidden input,
  so a date typed before the page hydrates is not what submits: the date the page opened with,
  today's unless the address names one, is.
- **A field is `Field` with a `FieldLabel`, never a hand-made wrapper** (`pnpm lint` enforces it:
  `ui/no-bare-label`). The label sits above the input. A placeholder shows an example, never the
  label.
- **A value the form shows but cannot change is a read-only field**, `TextField`'s `readOnly`,
  never a disabled input or plain text: it keeps the field's place and label, on the sidebar's
  background (`bg-sidebar`), its label and value muted, with a small lock (`size-3`) at its end
  (local edits in `src/components/ui/field.tsx` and `input-group.tsx`). The lock says only that
  it is locked; why, and what unlocks it, is an `Alert` above the form (Alerts), never the
  field's hint.
- **A rule the user needs while typing is a hint under the field**: a `FieldDescription`, with
  the input's `aria-describedby` pointing at it: `PhoneField` (`src/components/phone-field.tsx`).
- **A person's phone is the form kit's `PhoneField`**, never a text field: the country, shown as
  its flag and dial code (`🇦🇷 +54`, Argentina by default), picked from a list searched by name
  or dial code, beside the national number, digits only. For Argentina the number is 10 digits,
  the area code without its `0` and the number without its `15`, with the placeholder
  `3515551234` and the hint `Código de área sin 0 y número sin 15.`; another country's is checked
  for that country. Only the hint and the refusal of a wrong Argentine number name the `0` and the
  `15`; everywhere else, `formatPhone` (`src/lib/phones.ts`) shows the 10 digits (`351 555-1234`). Picking a country
  moves the focus to the number. The form holds the country and the number apart, and `phoneSchema`
  (`src/lib/patients.ts`) reads them into E.164. Every phone a person is reached at takes it: a
  patient's, a guardian's and the organization's `Teléfono para urgencias`; only a search box
  reads a phone typed as text. In a patient's `Contacto` it is a `half` on a row of its own, with
  `Ver conversación` after the number once their number has a conversation the reader may open.
- **A form's fields sit in rows of up to twelve columns, by the form's own width** (`FormGrid`,
  `src/components/app-form.tsx`, which `FormPage` holds its fields in, a container query rather
  than the window's breakpoints): one column below 448px, as on a phone; six from 448px, where a
  quarter or a third takes half the row and a half the whole row; twelve from 900px, where a
  quarter holds a date and time (213px). Every field of the form kit takes a `size`: `quarter`
  (three columns; four to a row at twelve), `third` (four; three to a row at twelve), `half`
  (six; two to a row at twelve) or `full` (the row). A field is a `quarter` unless what it holds
  needs more, judged by its content and the form's layout, not by its kind. A row's fields share
  its width evenly when the row is a subject of its own: two to a row are `half`, three `third`,
  as a patient's (below). Otherwise:
  - `full`: a text area, a group of checkboxes, the patient search, the free times, a block such
    as a template's text beside its preview (the form kit's text area, checkbox group and both
    comboboxes default to it);
  - `half`: an email, an address, a medical service, a template's name, a specialty, and a select
    whose longest option does not fit a quarter, measured in the browser at 1440 px;
  - `quarter`: the rest, names, a phone, a document's type and number, dates, times, durations,
    a checkbox whose label fits.
- **Related fields share a row; a field that starts a new subject starts a new row**
  (`startsRow`). A patient's: `Nombre` · `Apellido`, then `Apodo` · `Fecha de
  nacimiento`, then `Tipo de documento` · `Número de documento`, then `Correo electrónico` ·
  `Domicilio` (in `Contacto`), then `Teléfono` alone; a quick registration has only `Nombre` · `Apellido` · `Teléfono`. A
  child that is no field (a section, an alert, a line of text) takes the whole row; a section is a
  `FormGrid` of its own, inside the form's: `/dev/patrones`, `Campos por tamaño`. What a missing
  field means for the record is an `Alert` above the form, not a section's description: a
  patient with no birth date (`IncompleteAlert`).
- **An option that needs a mark, such as a colour's swatch, is a `MarkedSelectField`**, which
  shows the mark beside each option and inside the box; any other choice from a list is a
  `SelectField`, shadcn's `Select` (`OptionSelect`, `src/components/option-select.tsx`), its
  options as data, its list opening below the box (never over it, aligned on the picked option).
  A native select is not used: `pnpm lint` rejects a raw `<select>`, and shadcn's `Select`
  outside `OptionSelect` (`ui/use-option-select`), where it would open over the box.
- **A checkbox is a horizontal `Field` with `className="w-fit"`**, the box before its label:
  without `w-fit` the label fills the row, and a click on the empty space ticks the box.
  A group of them is a `FieldSet` with a `FieldLegend variant="label"`, and its boxes in a
  `FieldGroup data-slot="checkbox-group"`.
- **A date is a `DateField` and a time a `TimeField`**, two fields side by side, never
  `type="date"`, `type="time"` or `datetime-local`: the browser draws those in its own language
  and clock. They are typed as `dd/mm/aaaa` and `HH:mm` (`src/components/date-time-input.tsx`).
  A date or a time shown to a person is written by `src/lib/dates.ts`: day first, on a
  24-hour clock, with Spanish names, in the zone the caller passes, never the process's
  or the browser's. `pnpm lint` keeps
  hand-written formats out (`ui/no-raw-date-format`).
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
  (`Ingresá 10 números: el código de área sin 0 y el número sin 15, por ejemplo 3515551234.`).
- **A refusal keeps everything the user typed**, the fields that passed included.
- **One record picked from a server search is the form kit's `ComboboxField`**
  (`src/components/app-form.tsx`), as booking's patient picker: it searches as [Tables](#tables)
  says, its list opens only on the answer to the text in the box, and the record picked stays in
  the box.
- **A few fixed options are picked in place**, as a group of checkboxes (a schedule's days, a
  member's roles), never in a popover that covers what follows.
- **Several records picked from a list are the form kit's `MultiComboboxField`**: each pick a
  chip that removes it, the list searched by name, each option with a line that tells it apart,
  and its own lines for nothing to pick and for a search that finds nothing: a medical service's
  `Mensajes por WhatsApp`.
- **A piece of text the user may write in, such as a template's variable, is a chip above the
  text area** (`TextareaField`'s `inserts`): a row of `outline` `xs` buttons, each with a plus and
  the variable's name in the user's terms (`Paciente`), between the label and the box. A press
  writes it in at the cursor, over what is selected, and the focus goes back to the box after it.
  The text stays plain: no chips inside it and no dragging. The template form's chips are the
  variables its check allows (`templateVariables`): `/whatsapp/plantillas/$templateId`.
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

## WhatsApp messages

- **A message the patient reads is a `WhatsappBubble` in a `WhatsappChat`**
  (`src/components/whatsapp-bubble.tsx`), with its line breaks kept: the template preview and its
  versions. A screen that shows what a patient will get, or got, uses them rather than plain
  text. The bubbles use WhatsApp's own light-theme colours, so the screen looks like the patient's
  phone: the clinic's in its outgoing green (`whatsapp-outgoing`) with the app's foreground text,
  the patient's white, on the sidebar's grey.
- **A conversation reads as the chat**: the patient's messages in `PatientBubble`s on one side, the
  clinic's (templates, the assistant's, staff replies) in `WhatsappBubble`s on the other, oldest
  first, under a `WhatsappDay` where the day changes (`Hoy`, `Ayer`, `Martes 10 de noviembre`). A
  clinic bubble names its `author`; every bubble's `footer` holds its time alone (`17:31`) and its
  status as WhatsApp's ticks, `WhatsappStatus` (`src/components/whatsapp-status.tsx`), named by
  its label and in a tooltip. What has not gone yet shows where the patient will get it, `pending`
  with the clock: a queued template, a reply waiting for the patient. What the patient never
  reads, such as a late reply's hint, sits beside the bubble, outside it.
- **A patient's media opens from its bubble**: under the words (`Foto`, `Archivo: estudio.pdf`,
  a voice note's transcript), an `outline` `sm` button names what it does: `Ver foto` and
  `Ver video` open a dialog over the chat, `Abrir archivo` a new tab, `Escuchar` a player in
  place. Nothing loads before the press. Once Meta deleted it, a muted line says so in the
  button's place.
- **Who answers a conversation is a state**: a `Badge` beside the title (`Asistente`,
  `Tomada por Rita Prueba`), with `Tomar conversación` or `Devolver al asistente` in the header's
  `actions`.

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
- **A page's alerts stack under its header, above what it holds** (`AlertStack`,
  `src/components/alert-stack.tsx`), one gap apart, in a fixed order: the server's refusal
  (`ErrorAlert`), then the record's own state (`ArchivedAlert`, `RecordHeader`'s `alert`), then
  the page's own (`FormPage`'s `alerts`: why a field is locked, `IncompleteAlert`). An alert is
  never inside the form or between its fields, and a page with none shows no gap.
- **The semantic colours are not the brand's.** `success`, `info` and `warning` are tokens of
  their own; check them against the brand palette when it lands (#37). Their text keeps 4.5:1 on
  their tint, which is why tints are 6%.
- **A toast is an alert's kind of message too.** `toast.add` takes the alert variant as its
  `type` (`type: "destructive"` for an error), and the toast draws in that variant's colours
  and icon, from the same `alertTones` and `alertIcons` the `Alert` uses
  (`src/components/ui/alert.tsx`). A new kind of toast picks one of the variants above, never
  colours of its own.

## After a submit

Which channel carries a message, and where the user lands.

| What happened                                         | Channel                                                                                                                                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The form's own check failed                           | The error display above ([Forms](#forms)).                                                                                                                                             |
| The server refused the submit                         | The same display, with copy that says what to fix and names and links what blocks it: `DocumentTakenAlert`.                                                                            |
| A likely duplicate, which may be legitimate           | A confirmation that lists the matches and saves only when confirmed: `DuplicateWarning` (`src/components/patient-duplicates.tsx`).                                                     |
| Saved, and the change shows on the screen             | No message: the page it goes back to, with the updated row or value, is the answer.                                                                                                    |
| Saved, and nothing on the screen shows it             | An `Alert` that stays: the starting password's `Listo.` (`src/routes/_app/personal/$memberId_/contrasena.tsx`).                                                                        |
| A field locked by the record's state                  | An `Alert` above the form listing every reason and what unlocks it, or saying nothing does; a lock icon alone explains nothing.                                                        |
| A condition to know before acting, found by the app   | A `warning` `Alert` on the page.                                                                                                                                                       |
| An action with no form failed, or the network dropped | A toast (`toast.add` from `#/components/ui/toast.tsx`; a submit's thrown call goes through `serverAnswer`); it disappears on its own, so it never carries something the user must fix. |

- **After a save, a form page goes back**, and the screen's data reloads (`useFormAction`). A
  create whose next step is on the new record goes there: a registered patient opens their page.
  Never navigate only to show a message.
- **A message is about one submit or one state.** A refusal of what was just submitted goes
  with the form; a state of the record (archived, incomplete) is a badge or an `Alert` on
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

| Action                                     | Treatment                                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Eliminar`                                 | Always confirmed: `¿Eliminar este horario?`. A record that must stay is deactivated, never deleted.                                                                       |
| `Archivar` with consequences               | Confirmed, saying what happens: `useDeactivation` gives the count of future appointments; from a form dialog, in its place.                                               |
| `Archivar` with none, `Restaurar`          | At once: it can be reversed the same way.                                                                                                                                 |
| A save that sends appointments to the list | Asked with the count, two answers and no destructive button: a time off's or a closure's `Avisar por WhatsApp` or `Guardar sin avisar` (`ConfirmDialog`'s `alternative`). |
| A hand-over that loses nothing             | Asked once, its button the default one, not destructive: a handoff's `Pasar al profesional`, which changes who answers it (`ConfirmDialog`'s `destructive={false}`).      |
