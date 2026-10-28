import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vite-plus/test";

import {
  checkCommentLanguage,
  excludedDocDirectories,
  excludedYamlFiles,
  findSpanishProseInMarkdown,
  findSpanishProseInShell,
  findSpanishProseInSource,
  findSpanishProseInSql,
  findSpanishProseInYaml,
  gitHookDirectories,
  hashCommentRootFiles,
  readGlossaryNouns,
  scannedDirectories,
  scannedFilesIn,
  scannedDocDirectories,
  scannedShellDirectories,
  scannedSqlDirectories,
  scannedYamlDirectories,
} from "./check-comment-language.ts";

const filePath = "src/routes/_app/example.tsx";
const glossaryNouns = readGlossaryNouns(process.cwd());

function violationsIn(contents: string) {
  return findSpanishProseInSource({ contents, filePath, glossaryNouns });
}

function kindsIn(contents: string): string[] {
  return violationsIn(contents).map((violation) => violation.kind);
}

describe("comment-language guardrail", () => {
  test("fires on a Spanish line comment and on a Spanish block comment", () => {
    expect(kindsIn(`// La alerta no se suprime para el profesional.`)).toEqual(["comment"]);
    expect(kindsIn(`/* Esto queda sin nivel porque la fila es vieja. */`)).toEqual(["comment"]);
    expect(kindsIn(`const value = 1; // Se calcula una vez por turno.`)).toEqual(["comment"]);
  });

  test("reports the line, the markers and the passage", () => {
    const [violation = expect.unreachable()] = violationsIn(
      `const value = 1;\n\n// El motivo del bloqueo no se guarda.\n`,
    );

    expect(violation.lineNumber).toBe(3);
    expect(violation.filePath).toBe(filePath);
    expect(violation.markers).toContain("del");
    expect(violation.text).toContain("El motivo");
  });

  test("stays quiet on English prose", () => {
    expect(
      kindsIn(`// The alert is not suppressed for the practitioner.\n// TODO: revisit`),
    ).toEqual([]);
  });

  // A word list that skipped every short word missed short one-line comments
  // like these.
  test("catches short Spanish built only from short words", () => {
    expect(kindsIn(`// Se ejecuta al montar el componente.`)).toEqual(["comment"]);
    expect(kindsIn(`// Devuelve el total con IVA incluido.`)).toEqual(["comment"]);
    expect(kindsIn(`test("cierra la sesión activa", () => {});`)).toEqual(["test name"]);
  });

  // The whole reason the second instrument exists: a sentence built from a proper
  // noun and two conjugated verbs carries no function word at all, so no list of
  // them can ever reach it.
  test("catches Spanish carried only by accented verbs", () => {
    expect(kindsIn(`// Meta respondió y no aprobó.`)).toEqual(["comment"]);
  });

  // The other half of that disjointness: `Nota de crédito` has no `GLOSSARY.md`
  // entry, so the vocabulary rule cannot name it and only morphology reaches it.
  test("catches an accented term the glossary never lists", () => {
    expect(kindsIn(`// The mirror Nota de crédito annuls the original.`)).toEqual(["comment"]);
  });

  // A place name keeps its accent inside an English sentence, the same way
  // "São Paulo" would. Matching one says nothing about the language around it.
  test("does not read an accented proper noun as Spanish prose", () => {
    expect(kindsIn(`// Defaults to Córdoba's business date.`)).toEqual([]);
  });

  test("does not read an acronym as a short Spanish word", () => {
    expect(kindsIn(`// Reported to the UN and to the ES locale team.`)).toEqual([]);
    expect(kindsIn(`// SE quadrant only.`)).toEqual([]);
  });

  // The long list holds `del`, `los` and `sus` too, so the two-letter guard
  // this once applied was not enough: `DEL` is a key and `LOS` is
  // line-of-sight.
  test("does not read a longer all-caps acronym as a Spanish word", () => {
    expect(kindsIn(`// Uses the DEL key; LOS is line-of-sight.`)).toEqual([]);
  });

  // A digit ends a word as surely as a letter does, or `// Target es2020
  // output.` reads `es` as Spanish.
  test("does not read a Spanish word out of an alphanumeric token", () => {
    expect(kindsIn(`// Target es2020 output, not es5.`)).toEqual([]);
  });

  // An apostrophe is not a quote. Two contractions in one English sentence used
  // to pair up and blank everything between them, so this comment was silently
  // clean — and it hid real Spanish in five files.
  test("does not let an apostrophe blank the prose between two of them", () => {
    expect(kindsIn(`// It's fine; the consultorio isn't.`)).toEqual(["comment"]);
    expect(violationsIn(`/* The user's sede, the patient's cobertura. */`)[0]!.markers).toEqual([
      "sede",
      "cobertura",
    ]);
  });

  // `ü` is Spanish too, and leaving it out contradicted the rule's own claim to
  // catch any word carrying an accent.
  test("catches a word carrying a diaeresis", () => {
    expect(kindsIn(`// Antigüedad bilingüe pingüino vergüenza.`)).toEqual(["comment"]);
  });

  // The inflection the glossary does not list is the same violation as the
  // headword it comes from: `profesional` has a row in GLOSSARY.md,
  // `profesionales` does not, and nobody writing the second means anything different.
  test("catches a glossary noun in an inflection the glossary never lists", () => {
    expect(kindsIn(`// Shows the empty state when there are no profesionales.`)).toEqual([
      "comment",
    ]);
    expect(kindsIn(`test("creates sedes and consultorios", () => {});`)).toEqual(["test name"]);
  });

  // That tail is a closed set of Spanish endings and not `\p{L}*`, because an
  // open one reads the English `notable` and `notation` as inflections of `nota`.
  test("does not read an English word as an inflection of a glossary noun", () => {
    expect(kindsIn(`// A notable change to the notation.`)).toEqual([]);
  });

  // The spelling the routes use and a hurried hand types. Neither instrument
  // reached it before: no accent for morphology to find, and not the spelling
  // the glossary lists.
  test("catches a glossary noun spelled without its accent", () => {
    expect(kindsIn(`// Recalculates the linked evoluciones on correction.`)).toEqual(["comment"]);
    expect(kindsIn(`test("loads Organizacion detail data", () => {});`)).toEqual(["test name"]);
  });

  // A route may be a single segment, and the pattern used to need two — so
  // `/cambiar-contrasena` was read as prose while `/administracion/usuarios`
  // was not.
  test("treats a single-segment route as the address it is", () => {
    expect(kindsIn(`// Completes recovery through /cambiar-contrasena.`)).toEqual([]);
  });

  // Prose is governed exactly like an
  // identifier, so a glossary noun is a violation in a comment for the same
  // reason it would be in a name.
  test("catches the Spanish domain nouns the glossary names", () => {
    expect(
      kindsIn(
        `// The sede does not close the field: it only rejects a correction\n// that would move the consultorio of the evolución.`,
      ),
    ).toEqual(["comment"]);
  });

  // Naming the Spanish term is still allowed. It just has to be marked as the
  // data it is, which is what the identifier rule has always asked for.
  test("allows a glossary term marked as the data it is", () => {
    expect(kindsIn(`// Shared across the \`Tipo de turno\` routes.`)).toEqual([]);
    expect(kindsIn(`// The button reads "Confirmar el turno que falta" once it is due.`)).toEqual(
      [],
    );
  });

  // Glossary words that are ordinary English: "Obra social" is what puts
  // `social` in the list, and `// the social contract` is not Spanish.
  test("does not read an English homograph of a glossary word as Spanish", () => {
    expect(kindsIn(`// The social contract holds; WhatsApp is a channel.`)).toEqual([]);
  });

  // Without the glossary the vocabulary rule has nothing to match on, which is
  // what keeps it honest: GLOSSARY.md names the term, the checker does not guess.
  test("the glossary is what makes a domain noun a violation", () => {
    expect(
      findSpanishProseInSource({
        contents: `// The consultorio is fixed at registration.`,
        filePath,
        glossaryNouns: [],
      }),
    ).toEqual([]);
    expect(kindsIn(`// The consultorio is fixed at registration.`)).toEqual(["comment"]);
  });

  test("treats quoted copy, backticks, routes and URLs as the data they are", () => {
    expect(kindsIn(`// Mirrors \`estado=todos&incompletos=si\`.`)).toEqual([]);
    expect(kindsIn(`// Redirects to /obras-sociales/nueva/cobertura.`)).toEqual([]);
  });

  // A line match read the `//` of a URL as the start of a comment, and split a
  // backticked term across a comment run into halves that stopped looking like
  // data. Both were live false positives before the scanner replaced it.
  test("does not read a comment out of a string literal", () => {
    expect(kindsIn(`const requestUrl = \`http://localhost/pacientes?estado=todos\`;`)).toEqual([]);
  });

  test("reads a run of line comments as one passage, so data can wrap", () => {
    expect(
      kindsIn(`// The label is the whole sentence, as \`Nota de\n// recepción\` shows.`),
    ).toEqual([]);
  });

  test("fires on a Spanish test name, in every form the suite uses", () => {
    expect(kindsIn(`test("no emite cuando falta el número", () => {});`)).toEqual(["test name"]);
    expect(kindsIn(`describe("rutas de turnos, para el profesional", () => {});`)).toEqual([
      "test name",
    ]);
    expect(
      kindsIn(
        `test.each(["a", "b"])("\`%s\` es un error genérico, no una contingencia", () => {});`,
      ),
    ).toEqual(["test name"]);
  });

  test("leaves an English test name alone", () => {
    expect(kindsIn(`test("refuses to move an appointment into a closure", () => {});`)).toEqual([]);
    expect(kindsIn(`test("collects \`Tipo de turno\` breadcrumbs", () => {});`)).toEqual([]);
  });

  // Fixtures are why the callee is resolved instead of pattern-matched: this
  // very file carries Spanish test names inside strings, and a regex over the
  // file would report them as real ones.
  test("ignores a test call that is only a fixture inside a string", () => {
    expect(
      kindsIn(`const fixture = \`test("no emite cuando falta el número", () => {});\`;`),
    ).toEqual([]);
    expect(kindsIn(`translate("no emite cuando falta el número");`)).toEqual([]);
  });

  // The assertion that actually guards the repo. It reads every file, so it
  // takes seconds and grows with the repo; under the full unit run's load it
  // outlasted the default 5 s, hence its own limit.
  test(
    "the repository carries no Spanish comment and no Spanish test name",
    {
      timeout: 30_000,
    },
    async () => {
      await expect(checkCommentLanguage()).resolves.toEqual([]);
    },
  );

  // A clean run says nothing about a file the walk never reached: in en-escena the
  // gate twice passed because a new directory was not a scan root. Every tracked
  // file of a kind some scanner reads is read, or is a record exempt on purpose.
  test("every tracked file of a scannable kind is read, unless exempt", () => {
    const scanned = new Set(scannedFilesIn(process.cwd()).map(({ filePath }) => filePath));
    const tracked = execFileSync(
      "git",
      ["ls-files", "*.ts", "*.tsx", "*.mts", "*.mjs", "*.md", "*.sh", "*.yml", "*.yaml", "*.sql"],
      { cwd: process.cwd(), encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    const exempt = (filePath: string) =>
      excludedYamlFiles.includes(filePath) ||
      excludedDocDirectories.some(
        (excluded) => filePath === excluded || filePath.startsWith(`${excluded}/`),
      );

    expect(tracked.filter((filePath) => !scanned.has(filePath) && !exempt(filePath))).toEqual([]);
  });

  // A quote or backtick inside a regex literal used to open a string running to
  // the end of the file, hiding every comment after it.
  test("reads past a regex literal holding a quote or a backtick", () => {
    expect(
      kindsIn('const clean = value.replace(/`/g, "");\n// Se ejecuta para el profesional.'),
    ).toEqual(["comment"]);
    expect(kindsIn('const ok = /"[^"]*"/.test(line);\n// Se ejecuta una vez.')).toEqual([
      "comment",
    ]);
    expect(kindsIn("const pattern = />`/; // Se calcula una vez.")).toEqual(["comment"]);
  });

  test("still reads a division and a closing JSX tag as what they are", () => {
    expect(kindsIn("const half = total / 2; // Se calcula una vez.")).toEqual(["comment"]);
    expect(kindsIn("<p>Hola</p>{/* Se muestra una vez. */}")).toEqual(["comment"]);
    expect(kindsIn("<Foo a={b} /> {/* Se muestra una vez. */}")).toEqual(["comment"]);
    expect(kindsIn("const next = x++ / 2; // Se calcula una vez.")).toEqual(["comment"]);
  });
});

describe("comment-language guardrail, thrown error messages", () => {
  test("catches Spanish in a thrown error message", () => {
    expect(violationsIn(`throw new Error("Falta la variable de entorno.");`)).toMatchObject([
      { kind: "error message" },
    ]);
  });

  test("catches Spanish carried only by the second half of a concatenation", () => {
    // The literal that opens the call is English, so matching on the callee of
    // the opening literal would report nothing here. The scope is the call.
    const violations = violationsIn(
      `throw new Error(
         "The service dates go " +
           "las tres juntas o ninguna.",
       );`,
    );

    expect(violations).toMatchObject([{ kind: "error message" }]);
    // `las` appears only in the second literal, so this is the half that fired.
    expect(violations[0]!.markers).toContain("las");
  });

  test("catches Spanish thrown from an error subclass", () => {
    expect(
      violationsIn(`throw new WhatsAppTimeoutError("El servicio no respondió.");`),
    ).toMatchObject([{ kind: "error message" }]);
  });

  // The distinction the whole rule rests on. A refusal builder such as
  // `updateError(…)` looks like a constructor and carries the copy a user reads.
  // Requiring `new` is what separates them.
  test("does not read a refusal builder as an error constructor", () => {
    expect(violationsIn(`return updateError("Ingresá el nombre visible.");`)).toEqual([]);
    expect(violationsIn(`return actionError("Acción no soportada.");`)).toEqual([]);
  });

  // A thrown `Response`'s body is user copy.
  test("leaves a thrown `Response` in Spanish alone", () => {
    expect(
      violationsIn(`throw new Response("No encontramos ese Paciente.", {
         status: 404,
       });`),
    ).toEqual([]);
  });

  test("does not read a `new Error` inside a fixture string as code", () => {
    expect(violationsIn('const fixture = `throw new Error("Falta la variable.");`;')).toEqual([]);
  });

  test("reads an interpolation as the expression it is, not as vocabulary", () => {
    expect(violationsIn("throw new Error(`Expected ${insurer} to be loaded.`);")).toEqual([]);
  });

  test("still names a Spanish term the way the identifier rule does", () => {
    expect(violationsIn('throw new Error("Expected `Tipo de turno` to exist.");')).toEqual([]);
  });
});

describe("comment-language guardrail, markdown", () => {
  const docPath = "docs/domain/example.md";

  function docKindsIn(contents: string): string[] {
    return findSpanishProseInMarkdown({
      contents,
      filePath: docPath,
      glossaryNouns,
    }).map((violation) => violation.kind);
  }

  test("fires on Spanish prose and reports the line it is on", () => {
    const [violation = expect.unreachable()] = findSpanishProseInMarkdown({
      contents: `# Title\n\nEl turno no se libera al archivar.\n`,
      filePath: docPath,
      glossaryNouns,
    });

    expect(violation.kind).toBe("prose");
    expect(violation.lineNumber).toBe(3);
  });

  test("stays quiet on English prose", () => {
    expect(docKindsIn(`The capacity is not released on archiving.\n`)).toEqual([]);
  });

  // The backtick, because the coding standards name it and it renders as the
  // name it is.
  test("a backticked term is the name of something, not prose", () => {
    expect(docKindsIn(`Rules for locks and \`Tipo de turno\`.\n`)).toEqual([]);
  });

  // The deliberate difference from a source file: in markdown a double quote is
  // ordinary punctuation around ordinary prose, so it grants nothing.
  test("a double quote grants nothing in markdown", () => {
    expect(docKindsIn(`The badge reads "Datos incompletos" once due.\n`)).toEqual(["prose"]);
  });

  // The docs hard-wrap at 80 columns, so a backticked term wraps. The source
  // scanner has had a test for this shape since it was a live false positive;
  // the markdown one needed the same, and did not have it.
  test("a backticked term still reads as data when it wraps", () => {
    expect(docKindsIn("The label is the whole sentence, as `Nota de\nrecepción` shows.\n")).toEqual(
      [],
    );
  });

  test("a fenced block is code, whatever language it carries", () => {
    expect(
      docKindsIn("Before.\n\n```ts\nconst turno = 1; // El turno no se libera.\n```\n\nAfter.\n"),
    ).toEqual([]);
  });

  test("a link target is an address", () => {
    expect(docKindsIn(`See [the rules](./obras-sociales/coberturas.md).\n`)).toEqual([]);
  });

  // The one shape whose double-quoted value is data by definition: it is the
  // term this very script parses out of `GLOSSARY.md`.
  test("the glossary row's own `ui:` value is data", () => {
    expect(docKindsIn(`**\`appointmentType\`** — ui: "Tipo de turno"\n`)).toEqual([]);
  });

  // What `de` is in the list for: a term-by-term sweep translates a word out of
  // the middle of a label, and both halves of what is left are English.
  test("catches a label a sweep translated a word out of", () => {
    expect(docKindsIn(`It is registered with a capacity de schedule.\n`)).toEqual(["prose"]);
  });
});

describe("comment-language guardrail, YAML", () => {
  const yamlPath = ".github/workflows/ci.yml";

  function yamlKindsIn(contents: string): string[] {
    return findSpanishProseInYaml({
      contents,
      filePath: yamlPath,
      glossaryNouns,
    }).map((violation) => violation.kind);
  }

  test("catches a Spanish YAML comment, on its own line or trailing a value", () => {
    expect(yamlKindsIn("# El default local es 5433.\n")).toEqual(["comment"]);
    expect(yamlKindsIn("uses: pnpm/action-setup@v5 # versión desde el manifiesto\n")).toEqual([
      "comment",
    ]);
  });

  test("stays quiet on an English comment and on ordinary YAML", () => {
    expect(
      yamlKindsIn(
        "# The local default is 5433.\nTEST_DATABASE_URL: postgres://localhost:5432/db\n",
      ),
    ).toEqual([]);
  });

  // A `#` only opens a comment at line start or after whitespace, so neither of
  // these is one.
  test("does not read a `#` inside a value as a comment", () => {
    expect(yamlKindsIn('name: "Corre la suite #305"\n')).toEqual([]);
    expect(yamlKindsIn("color: '#fff' # el color de la marca\n")).toEqual(["comment"]);
  });

  // A shell comment inside a `run: |` block is read by the same contributor as
  // the YAML comment above it, so the rule does not stop at the block scalar.
  test("reads a shell comment inside a `run:` block", () => {
    expect(yamlKindsIn("      - run: |\n          # Corre la suite completa.\n")).toEqual([
      "comment",
    ]);
  });

  test("marks data in a YAML comment the way a source comment does", () => {
    expect(yamlKindsIn("# the step is named `Corre la suite de turnos`\n")).toEqual([]);
  });
});

describe("comment-language guardrail, shell", () => {
  const shellPath = ".agents/hooks/stop-typecheck-lint.sh";

  function shellKindsIn(contents: string): string[] {
    return findSpanishProseInShell({
      contents,
      filePath: shellPath,
      glossaryNouns,
    }).map((violation) => violation.kind);
  }

  test("catches a Spanish comment, on its own line or trailing a command", () => {
    expect(shellKindsIn("# Bloquea el compilador directo.\n")).toEqual(["comment"]);
    expect(shellKindsIn("exit 2 # así el agente lo lee\n")).toEqual(["comment"]);
  });

  test("stays quiet on an English comment and on ordinary shell", () => {
    expect(shellKindsIn("# Blocks the compiler called directly.\nexit 2\n")).toEqual([]);
  });

  // The hook's whole output is the message it hands back to the agent.
  test("catches a Spanish message written to stderr", () => {
    expect(shellKindsIn("  echo \"Usá 'pnpm typecheck'.\" >&2\n")).toEqual(["error message"]);
    expect(shellKindsIn("  echo \"Use 'pnpm typecheck' instead.\" >&2\n")).toEqual([]);
  });

  // Spanish in a string that is not the hook's output is data, the way a quoted
  // literal is in source.
  test("leaves a quoted string that is not written to stderr alone", () => {
    expect(shellKindsIn('label="necesita revisión"\n')).toEqual([]);
  });

  test("catches a single-quoted message written to stderr", () => {
    expect(shellKindsIn("  echo 'Usá pnpm typecheck.' >&2\n")).toEqual(["error message"]);
  });

  // `stop-typecheck-lint.sh`'s shape, and the reason the scan does not stop at
  // the redirect line: the sentence the agent reads is assembled several lines
  // above the `>&2` that prints it.
  test("catches a message assembled into a variable stderr reads", () => {
    const hook = [
      'instruction="Arreglá esto antes de terminar el turno."',
      `printf '%s\\n' "$instruction" >&2`,
      "",
    ].join("\n");

    expect(shellKindsIn(hook)).toEqual(["error message"]);
    expect(
      shellKindsIn(
        hook.replace(
          "Arreglá esto antes de terminar el turno.",
          "Fix this before ending the turn.",
        ),
      ),
    ).toEqual([]);
  });

  // A command substitution is the command's output, not prose this file wrote.
  test("leaves a captured command's output alone", () => {
    expect(
      shellKindsIn(['output="$(pnpm typecheck 2>&1)"', `printf '%s' "$output" >&2`, ""].join("\n")),
    ).toEqual([]);
  });

  // A `#` only opens a comment at line start or after whitespace, the same rule
  // the YAML scan reads it by.
  test("does not read a `#` inside a value as a comment", () => {
    expect(shellKindsIn('issue="#305 la suite"\n')).toEqual([]);
  });
});

describe("comment-language guardrail, SQL", () => {
  function sqlKindsIn(contents: string): string[] {
    return findSpanishProseInSql({
      contents,
      filePath: "src/db/migrations/0099_example.sql",
      glossaryNouns,
    }).map((violation) => violation.kind);
  }

  // A migration is immutable once applied, so this is the one place a Spanish
  // comment can never be fixed after merge.
  test("catches a Spanish `--` comment, on its own line or trailing a statement", () => {
    expect(sqlKindsIn("-- Una fila por sede.\n")).toEqual(["comment"]);
    expect(sqlKindsIn("ALTER TABLE room ENABLE ROW LEVEL SECURITY; -- para la sede\n")).toEqual([
      "comment",
    ]);
  });

  test("reads a `--` comment with no space before it", () => {
    expect(sqlKindsIn("ALTER TABLE room ENABLE ROW LEVEL SECURITY;-- para la sede\n")).toEqual([
      "comment",
    ]);
  });

  test("does not read `--` inside a string literal as a comment", () => {
    expect(sqlKindsIn("SELECT 'por -- la sede de turno';\n")).toEqual([]);
  });
});

describe("comment-language guardrail, files without a scannable extension", () => {
  // The scan-root tests list tracked files by extension, so a file with none, or
  // with one no scanner reads, is invisible to them. This walks a repo laid out
  // like this one and checks the default collection reaches each such file.
  test("the default scan reads the git hooks, the Dockerfile, the env example and SQL", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "comment-language-"));
    const write = (relativePath: string, contents: string) => {
      mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
      writeFileSync(path.join(root, relativePath), contents);
    };
    const roots = [
      ...scannedDirectories,
      ...scannedDocDirectories,
      ...scannedShellDirectories,
      ...scannedYamlDirectories,
      ...scannedSqlDirectories,
      ...gitHookDirectories,
    ];

    for (const directory of roots) mkdirSync(path.join(root, directory), { recursive: true });
    write("GLOSSARY.md", "");
    write(`${gitHookDirectories[0]}/pre-commit`, "# Corre la suite antes del commit.\n");
    for (const fileName of hashCommentRootFiles) write(fileName, "# Se copia la app.\n");
    write("src/db/migrations/0001_example.sql", "-- Una fila por cada tenant.\n");

    try {
      const reported = (await checkCommentLanguage(root)).map((violation) => violation.filePath);

      expect(reported.sort()).toEqual(
        [
          ".env.example",
          ".vite-hooks/pre-commit",
          "Dockerfile",
          "src/db/migrations/0001_example.sql",
        ].sort(),
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
