# Approvals (`src/server/features/approvals`)

Human-in-the-loop (HITL) approvals for sensitive actions (notably email `send`, and other guarded mutations).

## Key Files

- `service.ts`: create/list/find approval requests; attach external context and request payloads
- `execute.ts`: execute an approved request (replay the captured intent through a safe executor)
- `action-token.ts`: signed action tokens used in approval links (prevents tampering)
- `policy.ts`: approval policy rules used by the AI runtime
- `structured-execution.ts`: helpers for executing structured actions safely
- `types.ts`: shared approval types

## How It Fits

- The AI runtime proposes actions; DANGEROUS actions must be approved before execution.
- Approvals are persisted so execution can be replayed deterministically after the user clicks an approval link/button.
- Approval links are authenticated with signed tokens (do not accept raw IDs).

