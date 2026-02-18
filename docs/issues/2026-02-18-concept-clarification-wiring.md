# Concept Clarification Wiring (Email)

## Context
We removed concept-specific boolean filters (e.g. recruiter-only) and introduced general concept fields:
- `fromConcept`, `toConcept`, `ccConcept`

Email search now returns `clarification.kind = concept_definition_required` when these fields are used.

## Remaining Work
- Add eval-style multi-turn tests that assert:
  - User: "List unread emails from recruiters only" -> model/tool uses `fromConcept: "recruiters"` and asks for definition.
  - User supplies concrete domains/emails -> tool executes deterministically via `fromDomains`/`fromEmails`.
- Ensure turn-compiler/routing prompt guidance strongly biases the model to emit `fromConcept` when it sees role-like sender language.
  - This should be prompt-based (not hardcoded recruiter heuristics).
- Optional: Improve clarification UX in Slack sidecar by suggesting `email.facetThreads` candidates as interactive actions.

## Acceptance
- We can run a local eval that demonstrates concept clarification for at least 3 role-like concepts (recruiters, investors, vendors) with deterministic execution after clarification.
