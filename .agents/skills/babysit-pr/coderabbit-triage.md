# Review triage

The rubric step 3 of [SKILL.md](SKILL.md) applies to every finding, whether it comes
from CodeRabbit, a human reviewer or the in-session review. CodeRabbit reads the diff
and the standards in `docs/agents/coding-standards.md`; it has neither the issue nor
the domain, so each claim is checked against the code before it is acted on.

## The three verbs

- **fix**: the claim holds on the branch and the change is in the PR's scope. Fix it,
  reply with the SHA, resolve.
- **decline**: the code disproves the claim, or it matches a pattern below. Reply with
  the disproof (a `file:line`, a test, the invariant that covers it) and resolve.
  "Intentional" alone is not a reason.
- **ask**: the call is the user's. Leave the thread open and bring it to them.

Always **ask**, whatever a pattern says, when the finding touches patient data or
clinical records, tenancy or row-level security, auth, a migration, a destructive data
path, a term defined in `GLOSSARY.md`, or a product decision; and when a person, not a
bot, opened the thread.

A finding backed by `docs/agents/coding-standards.md` or `docs/agents/style-guide.md` is
never declined on the triager's judgement alone: it is a **fix**, or an **ask** when the
code is a deliberate exception the user rules on. A comment in the code is the
implementer's claim, not a ruling.

## Patterns

Add one when the same shape was declined on two PRs, and delete one that starts hiding
real findings.

### An invariant elsewhere already covers it

- Decline when: the guarantee the finding asks for is enforced by a shared component, a
  server-function guard, a schema constraint or a type, and you can cite its `file:line`.
- Not when: the invariant is assumed rather than enforced, or it depends on timing
  across an async boundary.
- Signal: "missing null check", "could be undefined", "add validation" on a value a
  schema or a loader already constrains.

## Commands

The thread ids come from the review thread's `id` in GraphQL.

```bash
gh api graphql -f query='mutation($id:ID!,$body:String!){
  addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){ comment{url} } }' \
  -F id=<THREAD_ID> -F body=@reply.md

gh api graphql -f query='mutation($id:ID!){
  resolveReviewThread(input:{threadId:$id}){ thread{isResolved} } }' -F id=<THREAD_ID>

gh pr comment <PR> --body-file answer.md
```
