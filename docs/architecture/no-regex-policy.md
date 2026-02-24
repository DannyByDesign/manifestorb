# No-Regex Authority Policy

For orchestration-critical agent code paths, regex must not be used for:

- intent classification
- tool gating or policy matching
- approval/decision parsing
- canonical rule execution semantics

Regex may exist elsewhere for low-risk parsing, but the files guarded by
`scripts/no-regex-ast-check.mjs` are treated as authority logic and must remain
regex-free. Those files use model-planned structured outputs and explicit
schema/policy controls.
