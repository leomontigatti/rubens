import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { collectSourceFiles } from "./source-files.ts";

// Engineering prose stays English.
//
// Ported from en-escena, a sibling project, where the rule lived only in
// the coding standards until a sweep took 2,198 lines of Spanish comments back to
// zero and reviews kept finding new ones defended with "the file around it is
// already Spanish". Rubens starts at zero, so this runs over the whole tree
// expecting zero, with no diff scoping and no allowlist for old debt.
//
// It reads prose through three instruments, because none of them reaches what
// the others do. Function words are *grammar* — the part of the language that
// only shows up when the whole sentence is Spanish. Accents are *morphology* — a
// mark on one word, whatever the sentence is doing. Glossary nouns are
// *vocabulary* — a term the repo has already agreed an English identifier for.
// Measured over en-escena's tree, each instrument found hundreds of passages the
// other two missed.
//
// The glossary grants no exemption: prose is governed like an identifier
// (docs/agents/coding-standards.md § Code language), so a Spanish term the
// glossary names is written as data, quoted or backticked, never bare.
//
// The scopes it reads are comments, test names, the argument of a
// `new …Error(…)` and what a shell script writes to stderr. Arbitrary string
// literals are left alone on purpose — Spanish UI copy lives in literals — but
// an error message is engineering prose by the coding standards' own rule. See
// `findErrorMessages` and `stderrMessagesIn` for why each predicate is exactly
// this narrow.

// Every directory in the repo that holds `.ts`/`.tsx`/`.mts`/`.mjs`, plus the
// root-level configs `collectScannedFiles` adds. `.github` is here because a
// workflow step is read by a contributor, not by an end user, the same way
// `scripts/` is.
export const scannedDirectories = [".github", "src", "scripts", "tests"];
const sourceFilePattern = /\.(ts|tsx|mts|mjs)$/;

// The docs are engineering prose too: a design note read by a contributor is not
// something a user reads. `.agents` and `.claude` hold the agent hooks and
// settings, which are ours, and `tests` its READMEs.
export const scannedDocDirectories = [".agents", ".claude", ".github", "docs", "tests"];
const docFilePattern = /\.md$/;

// Records of something external, which a sweep may not rewrite. An ADR is the
// decision as it was taken, `docs/research` cites sources by their own titles,
// and the WhatsApp templates are the Spanish text submitted to Meta, verbatim.
export const excludedDocDirectories = [
  "docs/adr",
  "docs/research",
  "docs/operations/whatsapp-templates.md",
];

// YAML is on the same rule: a `#` comment is trivially extractable and the word
// lists already exist. `.github` plus the root-level files `collectScannedYaml`
// adds; the scan-root test fails when a tracked YAML sits outside both.
export const scannedYamlDirectories = [".agents", ".github"];
const yamlFilePattern = /\.(yml|yaml)$/;

// Shell is on the rule for the same reason: a hook's output is read by an agent,
// not by a user, so it is engineering prose end to end.
export const scannedShellDirectories = [".agents", "scripts"];
const shellFilePattern = /\.sh$/;

// Generated, not written: no contributor reads a lockfile as prose, and nobody
// may rewrite it by hand anyway. File by file rather than by directory on
// purpose: a new YAML outside the scanned roots should fail the scan-root test on
// arrival and be recorded here deliberately.
export const excludedYamlFiles = ["pnpm-lock.yaml"];

// Root files that are not YAML but comment the same way, with `#` at line start
// or after whitespace, and are read by a contributor.
export const hashCommentRootFiles = ["Dockerfile", ".env.example"];

// Git hooks carry no extension, so every file in these directories is shell.
export const gitHookDirectories = [".vite-hooks"];

// SQL `--` comments. A migration matters most: once applied it is immutable
// (`pnpm check:migrations`), so a Spanish comment merged there stays forever.
export const scannedSqlDirectories = ["docker", "src/db/migrations"];
const sqlFilePattern = /\.sql$/;

// Spanish function words with no English homograph. Deliberately absent:
// `todo`/`todos` (the TODO comment marker), `sea`, `era`, `son`, `sin`, `solo`,
// `algo` (short for algorithm) and `con` (pro/con) — each collides with ordinary
// English technical prose.
//
// Known false positive: `Los Angeles` matches `los`. No such string is in the
// tree; if one arrives, quote it and it becomes data.
const spanishFunctionWords = [
  "además",
  "allí",
  "antes",
  "aquí",
  "así",
  "aunque",
  "cada",
  "como",
  "cómo",
  "cuando",
  "cuándo",
  "cuál",
  "cuyo",
  "debe",
  "deben",
  "del",
  "desde",
  "después",
  "donde",
  "dónde",
  "esa",
  "ese",
  "eso",
  "esta",
  "estas",
  "este",
  "estos",
  "está",
  "están",
  "entonces",
  "entre",
  "fue",
  "hace",
  "hacen",
  "hacer",
  "hasta",
  "hay",
  "las",
  "los",
  "más",
  "menos",
  "mientras",
  "misma",
  "mismo",
  "muy",
  "nada",
  "nunca",
  "otra",
  "otro",
  "para",
  "pero",
  "por",
  "porque",
  "puede",
  "pueden",
  "que",
  "qué",
  "queda",
  "quedan",
  "quien",
  "quién",
  "según",
  "siempre",
  "sino",
  "sobre",
  "sólo",
  "sus",
  "también",
  "tiene",
  "tienen",
  "toda",
  "todas",
  "una",
  "unas",
  "unos",
  "ya",
];

// Short Spanish words with no English homograph, kept apart because they need
// one extra guard: matched case-insensitively they would also hit the acronyms
// `UN`, `SE` and `ES`, so an all-caps occurrence is rejected below.
//
// Without this tier the floor sits too high for ordinary short Spanish:
// `// Se ejecuta al montar el componente.` and `test("cierra la sesión activa")`
// are built almost entirely out of words this short, and both were live in the
// tree until it was added.
//
// `de` earns its place by catching the one failure a term-by-term sweep
// reliably produces: translating a word out of the middle of a Spanish label,
// which leaves `type de appointment` or `copy de clinical record` behind. Nothing
// else sees those — both halves are English and `de` is the only Spanish left.
// In en-escena 22 of its 27 findings were exactly that. Known false
// positive: `de facto`, and a name like `Robert de Niro`; the hyphen guard
// already keeps `de-allocation` out.
const shortSpanishWords = ["al", "de", "el", "es", "la", "lo", "ni", "se", "su", "un", "sí"];

const spanishFunctionWordPattern = new RegExp(
  `(?<![\\p{L}\\d-])(?:${[...spanishFunctionWords, ...shortSpanishWords].join("|")})(?![\\p{L}\\d-])`,
  "giu",
);

/**
 * `SE` is southeast, `UN` is the United Nations, `DEL` is a key and `LOS` is
 * line-of-sight; `se`, `un`, `del` and `los` are Spanish. An all-caps match is
 * an acronym at any length — the long list holds `del`, `los` and `sus` too, so
 * the two-letter guard this used to apply was not enough.
 *
 * The cost is a Spanish comment written entirely in capitals, which this cannot
 * see. Prose in caps is rare enough to trade against acronyms in English, which
 * are not.
 */
function isAcronym(match: string): boolean {
  return match === match.toUpperCase() && match !== match.toLowerCase();
}

// The second instrument: morphology. A word carrying an accent or `ñ` is
// Spanish, whatever the sentence around it is doing.
//
// It exists because the function-word list has a shape of blind spot it can
// never cover on its own. `// Meta respondió y no aprobó.` is a whole Spanish
// sentence built from a proper noun and two conjugated verbs, and no list of
// function words will ever hold `respondió`.
const accentedWordPattern = /(?<![\p{L}-])[\p{L}-]*[áéíóúñü][\p{L}-]*/giu;

// Proper nouns are not prose. A place name keeps its accent in an English
// sentence the same way `São Paulo` does, so matching one says nothing about the
// language of the comment. Everything here is a name of something real; a word
// that merely looks foreign does not belong on this list — quote it instead.
const accentedProperNouns = new Set(["córdoba"]);

function isProperNoun(match: string): boolean {
  return accentedProperNouns.has(match.toLowerCase());
}

/** `**\`identifier\`** — ui: "Término"`, the one shape every glossary row has. */
const glossaryTermPattern = /—\s*ui:\s*"([^"]+)"/g;

// The third instrument: vocabulary. Every Spanish noun the glossary names is a
// term the codebase has already agreed an English identifier for, so writing it
// bare in a comment is the same choice the identifier rule forbids — and it is
// where the volume is: `turno`, `sede` and `consultorio` carry neither a
// function word nor an accent. A glossary noun is backticked or quoted if it must
// be named.

// Glossary words that are not evidence of Spanish. Each is here for one of two
// reasons, and a word without one of them does not belong:
//
//   - an English word spelled the same: `social` (from "Obra social");
//   - a proper noun: `whatsapp` (from "Acepta WhatsApp").
const glossaryNounExceptions = new Set(["social", "whatsapp"]);

const testFunctionNames = new Set(["describe", "it", "test"]);
const quoteCharacters = new Set(['"', "'", "`"]);

export type CommentLanguageViolation = {
  filePath: string;
  kind: "comment" | "error message" | "prose" | "test name";
  lineNumber: number;
  markers: string[];
  text: string;
};

type SourceSpan = {
  startIndex: number;
  text: string;
};

/** The glossary's `ui:` values, read from `GLOSSARY.md` so the two cannot drift. */
export function readGlossaryTerms(rootDirectory: string): string[] {
  const contents = readFileSync(path.join(rootDirectory, "GLOSSARY.md"), "utf8");

  return Array.from(contents.matchAll(glossaryTermPattern)).map((match) => match[1]!);
}

/** `evolución` → `evolucion`, the spelling a URL and a hurried hand use. */
function withoutAccents(word: string): string {
  return word.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/**
 * The Spanish nouns the glossary names, one word at a time. Multi-word `ui:`
 * values are split because prose borrows the noun, not the label: `Tipo de
 * turno` is where `turno` comes from. Words of three letters or fewer are
 * dropped — they are `de`, `que`, `se`, and the grammar rule already holds
 * the ones that matter.
 */
export function readGlossaryNouns(rootDirectory: string): string[] {
  const nouns = new Set<string>();

  for (const term of readGlossaryTerms(rootDirectory)) {
    for (const word of term.split(/[^\p{L}]+/u)) {
      const noun = word.toLowerCase();

      if (noun.length > 3 && !glossaryNounExceptions.has(noun)) {
        nouns.add(noun);

        // A Spanish plural in `-ón`/`-ín` drops the accent: `asignación` becomes
        // `asignaciones`, which neither the accent rule nor the closed suffix
        // tail can reach. Both instruments miss it, so the plural is listed.
        const plural = noun.replace(
          /([áéíóú])(n)$/u,
          (_, vowel: string, n) => `${"aeiou"["áéíóú".indexOf(vowel)]}${n}es`,
        );

        if (plural !== noun) {
          nouns.add(plural);
        }

        // And the accent-stripped spelling, because URLs write it that way and
        // prose follows the URL: no accent for morphology to find, and not the
        // spelling the glossary lists.
        nouns.add(withoutAccents(noun));
      }
    }
  }

  // Longest first, so `turnos` is matched whole rather than `turno` leaving a
  // bare `s` behind.
  return [...nouns].sort((left, right) => right.length - left.length);
}

/**
 * The tail catches the inflection the glossary does not list — `profesionales`
 * for `profesional`, `sedes` for `sede` — but it is a closed set of Spanish
 * endings and not `\p{L}*`. An open tail reads the English `notable` and
 * `notation` as inflections of `nota`. The trailing boundary is what makes the
 * closed set bite: without it `nota` matches the first four letters of
 * `notation` and the tail is simply skipped.
 */
function glossaryNounPatternFor(nouns: string[]): RegExp {
  return new RegExp(
    `(?<!\\p{L})(?:${nouns.map(escapeForPattern).join("|")})(?:es|as|os|s|a|o)?(?!\\p{L})`,
    "giu",
  );
}

function escapeForPattern(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blankTo(match: string): string {
  return match.replace(/[^\n]/g, " ");
}

/**
 * Blanks out the spans of a passage that are data rather than prose: quoted UI
 * copy, backticked code, route paths and URLs.
 * Blanking to spaces of the same width keeps every offset and line break intact,
 * so a match still reports the line it was found on.
 *
 * A `${…}` interpolation is blanked because it is an expression, not prose —
 * `${insurer}` in an error message names a variable, and reading it as
 * vocabulary would report the identifier rather than the sentence around it.
 *
 * The route alternative ends on a segment rather than on a slash, because
 * `/obras-sociales/nueva` has no trailing one and would leave `nueva` behind as
 * bare prose.
 */
function blankDataSpans(text: string): string {
  return text.replace(
    /\$\{[^}]*\}|`[^`]*`|"[^"]*"|«[^»]*»|“[^”]*”|https?:\/\/\S+|(?<![\p{L}\d])\/[\p{L}\d$_.-]+(?:\/[\p{L}\d$_.-]*)*/giu,
    blankTo,
  );
}

/**
 * Comments and string literals, found with a scanner rather than a line match.
 * A line match cannot tell `//` in a comment from `//` in
 * `"http://localhost/..."`, and it splits a backticked term wrapping across two
 * lines into halves that no longer look like data. Both were real false
 * positives while this was built.
 *
 * A regex literal is skipped whole: a quote or backtick inside one (`/`/g`)
 * would otherwise open a string that runs to the end of the file and hide every
 * comment after it.
 */
function scanSource(contents: string): {
  comments: SourceSpan[];
  strings: SourceSpan[];
} {
  const comments: SourceSpan[] = [];
  const strings: SourceSpan[] = [];
  let index = 0;

  while (index < contents.length) {
    const token = tokenAt(contents, index);

    if (token === null) {
      index += 1;
      continue;
    }

    if (token.kind === "comment") {
      comments.push({
        startIndex: index,
        text: contents.slice(index, token.stop),
      });
    } else if (token.kind === "string") {
      strings.push({
        startIndex: index + 1,
        text: contents.slice(index + 1, Math.max(index + 1, token.stop - 1)),
      });
    }

    index = token.stop;
  }

  return { comments: mergeAdjacentLineComments(comments, contents), strings };
}

/** The comment, string or regex literal opening at `index`, and where it ends. */
function tokenAt(
  contents: string,
  index: number,
): { kind: "comment" | "regex" | "string"; stop: number } | null {
  const character = contents[index]!;

  if (character !== "/") {
    return quoteCharacters.has(character)
      ? {
          kind: "string",
          stop: skipStringLiteral({ contents, quote: character, start: index }),
        }
      : null;
  }

  const next = contents[index + 1];

  if (next === "/") {
    return { kind: "comment", stop: indexOfOrEnd(contents, "\n", index) };
  }

  if (next === "*") {
    return {
      kind: "comment",
      stop: Math.min(indexOfOrEnd(contents, "*/", index + 2) + 2, contents.length),
    };
  }

  return opensRegex(contents, index)
    ? { kind: "regex", stop: skipRegexLiteral(contents, index) }
    : null;
}

// A `/` after one of these, or at the start, begins a regex; after an operand it
// is division. The keywords are the ones an expression can follow. Left out:
// `<`, for a JSX closing tag `</p>`; `}`, for `<Foo a={b} />`; `+` and `-`, for
// `x++ / 2`. A regex after one of them is misread as division: harmless unless it
// holds a quote, which hides the rest of the line, or a backtick, which hides
// every comment up to the next backtick. Rare, and none is in the tree.
const regexPrecedingCharacters = new Set("(,=:[!&|?{;*%>~^".split(""));
const regexPrecedingKeyword =
  /(?:^|[^\p{L}\d$_])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/u;

function opensRegex(contents: string, index: number): boolean {
  const before = skipBackwardsWhile(contents, index - 1, /\s/);

  return (
    before < 0 ||
    regexPrecedingCharacters.has(contents[before]!) ||
    regexPrecedingKeyword.test(contents.slice(Math.max(0, before - 10), before + 1))
  );
}

// A regex literal: escapes and `[…]` classes may hold a `/`, the flags follow.
const regexLiteralPattern = /\/(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])*\/[a-z]*/y;

/** Past the closing `/` and its flags, or the end of the line if it never closes. */
function skipRegexLiteral(contents: string, start: number): number {
  regexLiteralPattern.lastIndex = start;

  return regexLiteralPattern.test(contents)
    ? regexLiteralPattern.lastIndex
    : indexOfOrEnd(contents, "\n", start);
}

/** Where `needle` starts, or the end of `contents` when it never does. */
function indexOfOrEnd(contents: string, needle: string, from: number): number {
  const found = contents.indexOf(needle, from);
  return found === -1 ? contents.length : found;
}

function skipStringLiteral(input: { contents: string; quote: string; start: number }): number {
  let index = input.start + 1;

  while (index < input.contents.length) {
    const character = input.contents[index];

    if (character === "\\") {
      index += 2;
      continue;
    }

    if (character === input.quote) {
      return index + 1;
    }

    // An unterminated `'` or `"` is an apostrophe in prose, not a literal; a
    // template literal is the only one that legitimately spans lines.
    if (character === "\n" && input.quote !== "`") {
      return index;
    }

    index += 1;
  }

  return input.contents.length;
}

/**
 * A run of `//` lines is one comment, so a backticked term wrapping across two
 * of them is still recognised as the single data span it is.
 */
function mergeAdjacentLineComments(spans: SourceSpan[], contents: string): SourceSpan[] {
  return spans.reduce<SourceSpan[]>((merged, span) => {
    const previous = merged.at(-1);

    if (!previous?.text.startsWith("//") || !span.text.startsWith("//")) {
      return [...merged, span];
    }

    const between = contents.slice(previous.startIndex + previous.text.length, span.startIndex);

    if (!/^\n[ \t]*$/.test(between)) {
      return [...merged, span];
    }

    previous.text += `${between}${span.text}`;
    return merged;
  }, []);
}

/**
 * The callee of the call a string literal opens, so `test("…")` is recognised by
 * what it is rather than by a regex over the file. That distinction matters
 * here: this guardrail's own tests carry `test("…")` inside fixture strings, and
 * a regex would read those fixtures as real test names.
 */
function calleeBefore(contents: string, stringStartIndex: number): string | null {
  const openParen = skipBackwardsWhile(contents, stringStartIndex - 2, /\s/);

  if (contents[openParen] !== "(") {
    return null;
  }

  // `test.each([…])("…")`: step back over the argument group of the first call.
  const beforeParen = skipBackwardsWhile(contents, openParen - 1, /\s/);
  const afterGroup =
    contents[beforeParen] === ")"
      ? skipBackwardsWhile(contents, skipBalancedParenthesesBackwards(contents, beforeParen), /\s/)
      : beforeParen;

  const chainStart = skipBackwardsWhile(contents, afterGroup, /[\w$.]/);
  const chain = contents.slice(chainStart + 1, afterGroup + 1);

  return chain.length > 0 ? chain : null;
}

function skipBackwardsWhile(contents: string, from: number, pattern: RegExp): number {
  let index = from;

  while (index >= 0 && pattern.test(contents[index]!)) {
    index -= 1;
  }

  return index;
}

/** From a closing `)`, the index just before its opening `(`. */
function skipBalancedParenthesesBackwards(contents: string, from: number): number {
  let depth = 0;

  for (let index = from; index >= 0; index -= 1) {
    if (contents[index] === ")") {
      depth += 1;
    } else if (contents[index] === "(") {
      depth -= 1;

      if (depth === 0) {
        return index - 1;
      }
    }
  }

  return -1;
}

function findTestTitles(contents: string, strings: SourceSpan[]): SourceSpan[] {
  return strings.filter((span) => {
    const callee = calleeBefore(contents, span.startIndex);
    return callee !== null && testFunctionNames.has(callee.split(".")[0]!);
  });
}

/**
 * `new` followed by a constructor whose name ends in `Error`: the built-ins and
 * any subclass named the usual way.
 *
 * The `new` is load-bearing, not decoration. A refusal builder named for what it
 * refuses, `updateError("Ingresá el nombre visible.")`, carries the copy a user
 * reads; in en-escena, matching any `…Error(` call reported 22 such correct
 * Spanish findings. Requiring `new` separates the two.
 */
const errorConstructorPattern = /(?<![\p{L}\d$_.])new\s+[\p{L}\d$_]*Error\s*\(/gu;

/**
 * The string literals a `new Error(…)` call holds.
 *
 * Comments, test names and markdown are gated; string literals are left alone
 * on purpose: Spanish UI copy lives in literals, so flagging them wholesale
 * would be wrong. The gap that leaves is that a Spanish `throw new Error("…")`
 * passes, even though it is engineering prose by the standard's own definition —
 * a user-facing refusal in this codebase is a structured result, never a thrown
 * `Error`. In en-escena eleven such messages outlived a sweep that reported zero.
 *
 * `new Error` is the whole predicate because it is the one call whose argument
 * is engineering prose by construction. Any other literal may be user copy, and
 * must stay Spanish.
 *
 * Matching on the *call* rather than on the literal that opens it is what makes
 * a concatenated message — `"… van " + "las tres juntas o ninguna."` — checked
 * in both halves rather than only the first.
 */
function findErrorMessages(
  contents: string,
  comments: SourceSpan[],
  strings: SourceSpan[],
): SourceSpan[] {
  const calls = errorCallSpans(contents, comments, strings);

  return strings.filter((span) =>
    calls.some((call) => span.startIndex > call.open && span.startIndex < call.close),
  );
}

function errorCallSpans(
  contents: string,
  comments: SourceSpan[],
  strings: SourceSpan[],
): { close: number; open: number }[] {
  return Array.from(contents.matchAll(errorConstructorPattern)).flatMap((match) => {
    // This guardrail's own tests carry `new Error("…")` inside fixture
    // strings, and the fixtures are not code. Same reasoning as `test("…")`.
    if (isInsideAnySpan(match.index, [...comments, ...strings])) {
      return [];
    }

    const open = match.index + match[0].length - 1;
    const close = indexOfMatchingParenthesis(contents, open);

    return close === -1 ? [] : [{ close, open }];
  });
}

function isInsideAnySpan(index: number, spans: SourceSpan[]): boolean {
  return spans.some(
    (span) => index >= span.startIndex && index < span.startIndex + span.text.length,
  );
}

/** From an opening `(`, the index of the `)` that closes it. */
function indexOfMatchingParenthesis(contents: string, openIndex: number): number {
  let depth = 0;
  let index = openIndex;

  while (index < contents.length) {
    // A parenthesis inside a literal or a comment does not nest.
    const token = tokenAt(contents, index);

    if (token !== null) {
      index = token.stop;
      continue;
    }

    if (contents[index] === "(") {
      depth += 1;
    } else if (contents[index] === ")") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }

    index += 1;
  }

  return -1;
}

function lineNumberAt(contents: string, index: number): number {
  return contents.slice(0, index).split("\n").length;
}

/** The three instruments, over prose whose data spans are already blanked. */
function spanishMarkersIn(prose: string, glossaryNouns: string[]): RegExpExecArray[] {
  return [
    ...Array.from(prose.matchAll(spanishFunctionWordPattern)).filter(
      (match) => !isAcronym(match[0]),
    ),
    ...Array.from(prose.matchAll(accentedWordPattern)).filter((match) => !isProperNoun(match[0])),
    ...(glossaryNouns.length === 0
      ? []
      : Array.from(prose.matchAll(glossaryNounPatternFor(glossaryNouns)))),
  ].sort((left, right) => left.index - right.index);
}

/**
 * Markdown is prose end to end, so there is no comment to find: the file is the
 * passage, and a line is the unit worth reporting. The only difference from a
 * source file is what counts as data: the backtick, because the coding standards
 * name it and it is what `docs/domain` uses and what renders as the name it is, where a
 * double quote in markdown is ordinary punctuation around ordinary prose.
 */
export function findSpanishProseInMarkdown(input: {
  contents: string;
  filePath: string;
  /** Empty turns the vocabulary instrument off; say so rather than omit it. */
  glossaryNouns: string[];
}): CommentLanguageViolation[] {
  const { glossaryNouns } = input;
  const lines = input.contents.split("\n");

  return blankMarkdownDataSpans(input.contents)
    .split("\n")
    .flatMap((line, index) => {
      const matches = spanishMarkersIn(line, glossaryNouns);

      if (matches.length === 0) {
        return [];
      }

      return [
        {
          filePath: input.filePath,
          kind: "prose" as const,
          lineNumber: index + 1,
          markers: [...new Set(matches.map((match) => match[0].toLowerCase()))],
          text: lines[index]!.trim().slice(0, 120),
        },
      ];
    });
}

/**
 * Fenced blocks are code whatever language they carry, link targets are
 * addresses, and a backticked run is the name of something. The glossary row is
 * the one shape whose double-quoted value is data by definition: `ui: "Sede"` is
 * the UI term this very file parses out of `GLOSSARY.md`, so it is blanked here
 * rather than rewritten into backticks that `readGlossaryTerms` would then have
 * to learn.
 */
function blankMarkdownDataSpans(contents: string): string {
  return contents
    .replace(/^ {0,3}```[^\n]*\n[\s\S]*?^ {0,3}```/gmu, blankTo)
    .replace(/—\s*ui:\s*"[^"\n]*"/gu, blankTo)
    .replace(/\]\([^)\n]*\)/gu, blankTo)
    .replace(
      /`[^`\n]*(?:\n[^`\n]*)?`|https?:\/\/\S+|(?<![\p{L}\d])\/[\p{L}\d$_.-]+(?:\/[\p{L}\d$_.-]*)*/giu,
      blankTo,
    );
}

/**
 * A `#` opens a YAML comment when it starts the line or follows whitespace and
 * is not inside a quoted scalar. That is the YAML rule, and the two guards are
 * what keep `#` inside a value out of it — a colour, a URL fragment, or the
 * `#305/#391` an issue reference carries.
 *
 * It is shell's rule too, which is why this is not named for YAML: a `#` inside
 * a `run: |` block was already being read as a comment — deliberately, since a
 * shell comment in a workflow step is read by the same contributor as the YAML
 * comment above it — and a `.sh` file is that same block without the workflow
 * around it.
 */
function hashCommentAt(line: string): string | null {
  return lineCommentAt(line, { marker: "#", markerFollows: /\s/, quotes: ['"', "'"] });
}

/**
 * SQL's `--` comment, outside a `'…'` literal; a `"…"` is an identifier there. It
 * opens anywhere, `;-- note` included, unlike a `#` that must follow whitespace.
 */
function sqlCommentAt(line: string): string | null {
  return lineCommentAt(line, { marker: "--", markerFollows: /[^]/u, quotes: ["'"] });
}

function lineCommentAt(
  line: string,
  syntax: { marker: string; markerFollows: RegExp; quotes: string[] },
): string | null {
  const { marker, markerFollows, quotes } = syntax;
  let quote: string | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;

    if (quote !== null) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (quotes.includes(character)) {
      quote = character;
      continue;
    }

    if (line.startsWith(marker, index) && (index === 0 || markerFollows.test(line[index - 1]!))) {
      return line.slice(index);
    }
  }

  return null;
}

/**
 * YAML is prose only in its comments, so unlike markdown there is no question of
 * what counts as a passage: the comment is the unit, and the line is where it is
 * reported. Data is marked the way it is in a source comment — this is code, and
 * `# versión desde \`packageManager\`` is the shape the tree actually carries.
 */
export function findSpanishProseInYaml(input: {
  contents: string;
  filePath: string;
  /** Empty turns the vocabulary instrument off; say so rather than omit it. */
  glossaryNouns: string[];
}): CommentLanguageViolation[] {
  return findSpanishLineComments(input, hashCommentAt);
}

export function findSpanishProseInSql(input: {
  contents: string;
  filePath: string;
  glossaryNouns: string[];
}): CommentLanguageViolation[] {
  return findSpanishLineComments(input, sqlCommentAt);
}

function findSpanishLineComments(
  input: { contents: string; filePath: string; glossaryNouns: string[] },
  commentAt: (line: string) => string | null,
): CommentLanguageViolation[] {
  return input.contents.split("\n").flatMap((line, index) => {
    const comment = commentAt(line);

    if (comment === null) {
      return [];
    }

    const matches = spanishMarkersIn(blankDataSpans(comment), input.glossaryNouns);

    if (matches.length === 0) {
      return [];
    }

    return [
      {
        filePath: input.filePath,
        kind: "comment" as const,
        lineNumber: index + 1,
        markers: [...new Set(matches.map((match) => match[0].toLowerCase()))],
        text: comment.trim().slice(0, 120),
      },
    ];
  });
}

/**
 * Shell is the YAML scope plus one more: what the script writes to stderr. A
 * hook's stderr is the sentence Claude Code feeds back to the agent — the same
 * engineering prose a `new Error(…)` message is.
 *
 * The scope is the quoted strings a line hands to stderr, which is narrow the
 * way `findErrorMessages` is narrow: every other literal in a shell script is
 * data — a label, a path, a `jq` filter — and reading those as prose would
 * report `label="necesita revisión"` as a violation.
 *
 * A line redirecting to `>&2` is only half of that. The repo's other
 * agent-facing hook writes `printf '%s\n\n%s\n' "$output" "$instruction" >&2`
 * and assembles the sentence three lines earlier in `instruction="…"`, so
 * reading the redirect line alone would have let a Spanish `instruction` through
 * the gate. `stderrVariableNamesIn` is what closes that:
 * a variable this file interpolates into stderr carries a message, so its
 * literal assignments are read as one wherever they sit.
 *
 * Two shapes stay out of reach, both absent from the tree and both a miss rather
 * than a spurious failure: a heredoc body redirected to stderr, and a message
 * built across a line break, since `hashCommentAt` reads quoting one line at a
 * time. This is `decodePem`'s gap in the error-message scan, one language over.
 */
export function findSpanishProseInShell(input: {
  contents: string;
  filePath: string;
  /** Empty turns the vocabulary instrument off; say so rather than omit it. */
  glossaryNouns: string[];
}): CommentLanguageViolation[] {
  const lines = input.contents.split("\n");
  const messageVariables = stderrVariableNamesIn(lines);

  return lines.flatMap((line, index) => {
    const comment = hashCommentAt(line);
    const code = comment === null ? line : line.slice(0, line.length - comment.length);
    const passages: { kind: CommentLanguageViolation["kind"]; text: string }[] = [
      ...(comment === null ? [] : [{ kind: "comment" as const, text: comment }]),
      ...stderrMessagesIn(code, messageVariables).map((text) => ({
        kind: "error message" as const,
        text,
      })),
    ];

    return passages.flatMap(({ kind, text }) => {
      const matches = spanishMarkersIn(blankDataSpans(text), input.glossaryNouns);

      if (matches.length === 0) {
        return [];
      }

      return [
        {
          filePath: input.filePath,
          kind,
          lineNumber: index + 1,
          markers: [...new Set(matches.map((match) => match[0].toLowerCase()))],
          text: text.trim().slice(0, 120),
        },
      ];
    });
  });
}

/**
 * The messages a line of shell hands to stderr: every quoted string on a line
 * that redirects to it, and the literal assigned to a variable the file later
 * interpolates into such a line.
 *
 * A command substitution is excluded from the assignment half — `output="$(pnpm
 * typecheck 2>&1)"` is the command's output, not prose written here.
 */
function stderrMessagesIn(line: string, messageVariables: Set<string>): string[] {
  if (line.includes(">&2")) {
    return quotedRunsIn(line);
  }

  const assignment = line.match(/^\s*([A-Za-z_]\w*)=(.*)$/u);

  if (
    assignment === null ||
    !messageVariables.has(assignment[1]!) ||
    assignment[2]!.includes("$(")
  ) {
    return [];
  }

  return quotedRunsIn(assignment[2]!);
}

/**
 * Single quotes as well as double, because shell reads both as a string and
 * `echo 'Usá pnpm typecheck' >&2` is the same sentence as its double-quoted
 * twin. The inner text rather than the literal, because `blankDataSpans` blanks
 * a `"…"` span as data — right for a comment quoting UI copy, wrong for the
 * message itself.
 */
function quotedRunsIn(text: string): string[] {
  return Array.from(text.matchAll(/"([^"\n]*)"|'([^'\n]*)'/gu), (match) => match[1] ?? match[2]!);
}

/**
 * The variables a file interpolates into a line that redirects to stderr. Names
 * only: which assignment wins at runtime is not something a scanner can know, so
 * every literal assigned to the name is read as a message.
 */
function stderrVariableNamesIn(lines: string[]): Set<string> {
  return new Set(
    lines
      .filter((line) => line.includes(">&2"))
      .flatMap((line) => Array.from(line.matchAll(/\$\{?([A-Za-z_]\w*)/gu), (match) => match[1]!)),
  );
}

export function findSpanishProseInSource(input: {
  contents: string;
  filePath: string;
  /** Empty turns the vocabulary instrument off; say so rather than omit it. */
  glossaryNouns: string[];
}): CommentLanguageViolation[] {
  const { glossaryNouns } = input;
  const { comments, strings } = scanSource(input.contents);
  const scopes: {
    kind: CommentLanguageViolation["kind"];
    spans: SourceSpan[];
  }[] = [
    { kind: "comment", spans: comments },
    {
      kind: "error message",
      spans: findErrorMessages(input.contents, comments, strings),
    },
    { kind: "test name", spans: findTestTitles(input.contents, strings) },
  ];

  return scopes.flatMap(({ kind, spans }) =>
    spans.flatMap((span) => {
      const prose = blankDataSpans(span.text);
      const matches = spanishMarkersIn(prose, glossaryNouns);

      if (matches.length === 0) {
        return [];
      }

      return [
        {
          filePath: input.filePath,
          kind,
          lineNumber: lineNumberAt(input.contents, span.startIndex + matches[0]!.index),
          markers: [...new Set(matches.map((match) => match[0].toLowerCase()))],
          text: span.text.trim().split("\n")[0]!.slice(0, 120),
        },
      ];
    }),
  );
}

type Scanner = (input: {
  contents: string;
  filePath: string;
  glossaryNouns: string[];
}) => CommentLanguageViolation[];

/** Every file the guardrail reads, repo-relative, with the scanner it reads it by. */
export function scannedFilesIn(rootDirectory: string): { filePath: string; scan: Scanner }[] {
  const byScanner: [string[], Scanner][] = [
    [collectScannedFiles(rootDirectory), findSpanishProseInSource],
    [collectScannedDocs(rootDirectory), findSpanishProseInMarkdown],
    [collectScannedShell(rootDirectory), findSpanishProseInShell],
    [collectScannedYaml(rootDirectory), findSpanishProseInYaml],
    [collectScannedSql(rootDirectory), findSpanishProseInSql],
  ];

  return byScanner.flatMap(([files, scan]) =>
    files.map((filePath) => ({ filePath: path.relative(rootDirectory, filePath), scan })),
  );
}

export async function checkCommentLanguage(
  rootDirectory = process.cwd(),
): Promise<CommentLanguageViolation[]> {
  const glossaryNouns = readGlossaryNouns(rootDirectory);

  return scannedFilesIn(rootDirectory).flatMap(({ filePath, scan }) =>
    scan({
      contents: readFileSync(path.join(rootDirectory, filePath), "utf8"),
      filePath,
      glossaryNouns,
    }),
  );
}

/**
 * The documented directories plus the markdown sitting at the repo root, minus
 * the records `excludedDocDirectories` exempts. The exclusion is by path prefix rather than
 * by a list of files, so a new ADR is covered the day it is written.
 */
function collectScannedDocs(rootDirectory: string): string[] {
  const rootDocs = readdirSync(rootDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && docFilePattern.test(entry.name))
    .map((entry) => path.join(rootDirectory, entry.name));

  return [
    ...rootDocs,
    ...scannedDocDirectories.flatMap((directory) =>
      collectSourceFiles({
        directoryPath: path.join(rootDirectory, directory),
        keeps: (fileName) => docFilePattern.test(fileName),
      }),
    ),
  ].filter((filePath) => {
    const relativePath = path.relative(rootDirectory, filePath);

    return !excludedDocDirectories.some(
      (excluded) => relativePath === excluded || relativePath.startsWith(`${excluded}/`),
    );
  });
}

/**
 * The shell directories plus any `.sh` sitting at the repo root. There is none
 * today; picking them up is what keeps the scan-root test's "at the repo root"
 * exemption honest.
 */
function collectScannedShell(rootDirectory: string): string[] {
  const rootShell = readdirSync(rootDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && shellFilePattern.test(entry.name))
    .map((entry) => path.join(rootDirectory, entry.name));

  return [
    ...rootShell,
    ...scannedShellDirectories.flatMap((directory) =>
      collectSourceFiles({
        directoryPath: path.join(rootDirectory, directory),
        keeps: (fileName) => shellFilePattern.test(fileName),
      }),
    ),
    // The hooks themselves sit at the top; `.vite-hooks/_/` is generated and untracked.
    ...gitHookDirectories.flatMap((directory) =>
      readdirSync(path.join(rootDirectory, directory), { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(rootDirectory, directory, entry.name)),
    ),
  ];
}

function collectScannedYaml(rootDirectory: string): string[] {
  const keeps = (fileName: string) =>
    yamlFilePattern.test(fileName) && !excludedYamlFiles.includes(fileName);

  const rootYaml = readdirSync(rootDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && keeps(entry.name))
    .map((entry) => path.join(rootDirectory, entry.name));

  return [
    ...rootYaml,
    ...hashCommentRootFiles
      .map((fileName) => path.join(rootDirectory, fileName))
      .filter((filePath) => existsSync(filePath)),
    ...scannedYamlDirectories.flatMap((directory) =>
      collectSourceFiles({
        directoryPath: path.join(rootDirectory, directory),
        keeps,
      }),
    ),
  ];
}

function collectScannedSql(rootDirectory: string): string[] {
  return scannedSqlDirectories.flatMap((directory) =>
    collectSourceFiles({
      directoryPath: path.join(rootDirectory, directory),
      keeps: (fileName) => sqlFilePattern.test(fileName),
    }),
  );
}

/** The scanned directories plus the configs at the repo root, `vite.config.ts` among them. */
function collectScannedFiles(rootDirectory: string): string[] {
  const rootFiles = readdirSync(rootDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && sourceFilePattern.test(entry.name))
    .map((entry) => path.join(rootDirectory, entry.name));

  return [
    ...rootFiles,
    ...scannedDirectories.flatMap((directory) =>
      collectSourceFiles({
        directoryPath: path.join(rootDirectory, directory),
        keeps: (fileName) => sourceFilePattern.test(fileName),
      }),
    ),
  ];
}

async function runCommentLanguageGuardrail(): Promise<void> {
  const violations = await checkCommentLanguage();

  if (violations.length === 0) {
    return;
  }

  const lines = [
    `Comment-language guardrail found ${violations.length} Spanish ${
      violations.length === 1 ? "passage" : "passages"
    }:`,
    ...violations.map(
      (violation) =>
        `- ${violation.filePath}:${violation.lineNumber} (${violation.kind}, matched ${violation.markers.join(", ")})\n  ${violation.text}`,
    ),
    "",
    "Engineering prose is English (docs/agents/coding-standards.md § Code language): Spanish is for what a user reads, and the file around it being Spanish is not a reason.",
    "Naming a Spanish term is still fine: mark it as the data it is. In code, double-quote UI copy and backtick a name; in markdown, backtick both.",
  ];

  throw new Error(lines.join("\n"));
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  runCommentLanguageGuardrail().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
