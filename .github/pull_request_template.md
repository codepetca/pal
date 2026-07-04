# What & why

<!-- One or two sentences: what does this PR change, and why? -->

## Checklist

- [ ] Branch uses a domain prefix (`events/`, `economy/`, `world/`, `frontend/`) or `infra/` for repo-wide changes
- [ ] AI review run: `/code-review --comment` (fix findings before requesting human review)
- [ ] Docs updated if this PR changes behavior a doc describes (`docs/`, `CLAUDE.md`)
- [ ] No migrations bundled with logic changes (migrations ship in their own PR)
- [ ] No learner state mutated outside the rule engine (`packages/engine/src/evaluate.ts`)
- [ ] No PII touches the API or DB (no names, emails, raw student IDs, grades, scores, student writing)

## How I tested it

<!-- e.g. engine unit tests, fired events in the dev sandbox, manual check at localhost:3000 -->
