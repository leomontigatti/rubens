---
name: tdd
description: Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests.
---

# Test-Driven Development

TDD is the red → green loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle: consult them before and during the loop, not after.

When exploring the codebase, read `GLOSSARY.md` (if it exists) so test names and interface vocabulary match the project's domain language, and respect ADRs in the area you're touching.

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification: "user can checkout with valid cart" tells you exactly what capability exists, and it survives refactors because it doesn't care about internal structure.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.

## Seams: where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

**Test only at pre-agreed seams.** Before writing any test, write down the seams under test and confirm them with the user. No test is written at an unconfirmed seam. You can't test everything, so agreeing the seams up front is how testing effort lands on the critical paths and complex logic instead of every edge case.

Ask: "What's the public interface, and which seams should we test?" Give each proposed seam a one-line note on what it catches and what it misses.

When the shape of that interface is itself in question (how deep the module is, where the seam belongs, what the interface should expose), call the Skill tool with "codebase-design" for the vocabulary. It is the shared source of the module, interface, depth, seam, adapter, leverage and locality terms, and it is a reference to consult, not a session to run.

## Anti-patterns

- **Implementation-coupled**: mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks when you refactor but behavior hasn't changed.
- **Tautological**: the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived by hand the same way, a constant asserted equal to itself), so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth: a known-good literal, a worked example, the spec.
- **Restating text**: the assertion checks that a document contains a sentence, or that a component shows copy that nothing computes. The text lives in one place, so the test only fails when someone rewords it. Text earns an assertion when code computes it (a plural, a fallback, `"3 de 12 disponibles"`), the law fixes it (`"Historia clínica"`), or a real bug produced the wrong text. A doc is checked against structure, not wording: a link resolves, an index matches its files ([coding-standards.md](../../../docs/agents/coding-standards.md#testing)).
- **Pass-through**: the test mocks a collaborator to return a value, then asserts the code returned that same value. It is the tautology through a mock: assert what the code does with the value instead.
- **Horizontal slicing**: writing all tests first, then all implementation. Bulk tests verify _imagined_ behavior: you test the _shape_ of things rather than user-facing behavior, the tests go insensitive to real changes, and you commit to test structure before understanding the implementation. Work in **vertical slices** instead: one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Name the bug first.** Before writing a test, say which wrong implementation would make it fail. If the only answer is "someone changed the constant, the copy or the doc", do not write it: it is one of the anti-patterns above.
- **Red before green.** Write the failing test first, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** It belongs to the review stage (see the `code-review` skill), not the red → green implementation cycle.

## Keeping the suite lean

- **Extend a fixture before adding one.** Before creating a test-support file, look for the one that already builds those rows or requests (`src/test-support/`, or the `*.test-support.ts` beside the module; where each goes is "Test support files" in `docs/agents/coding-standards.md`) and extend it. A new support file needs a reason no existing one fits.
- **Delete what a better test made redundant.** When a test at a seam covers behaviour that older, shallower tests also cover, delete the older ones in the same change, and list them with the reason in the PR.
