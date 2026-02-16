# Issue: WS-10 Episodic + Relationship Memory Schema

## Problem
Flat facts cannot satisfy CRM-style interaction recall requirements.

## Approach
Introduce episodic interaction and relationship entities with temporal semantics.

## Atomic Tasks
1. Add models/migrations for people, episodes, participants, commitments, assertions, evidence.
2. Link episodes to email threads and calendar events.
3. Add base write/read APIs and indexes.

## References
- https://help.getzep.com/docs
- https://github.com/getzep/graphiti
- https://arxiv.org/abs/2501.13956

## DoD
- Schema and baseline APIs support episode/person recall queries.
