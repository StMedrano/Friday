# Friday Phase 2C — Group Skills, Plugin Descriptors and Context Builder

**Implementation state:** development-only; production runtime remains unchanged and Phase 2C is default off. This is not an MCP bridge, external ChatGPT/Claude/Kimi integration, plugin executor, approval engine, or autonomous scheduler.

## Authoritative sources

- Immutable Git-release manifests: `groups/*.json`, `skills/{engineering,shared,security}/*/manifest.json` with adjacent `SKILL.md`, `plugin-catalog/*.json`, `agent-assignments/*.json`.
- Legacy `skills/` directories used by older Friday development are ignored by the Phase 2C loader; only the three designated Phase 2C catalog categories are trusted.
- Phase 1 Supabase agent registry identifies registered/enabled agents, retaining Agent Spec v1.1 and advisory Ollama behavior.
- Phase 2B Supabase work state, accepted decisions and bounded memory remain authoritative, each queried under trusted `ActorContext`.
- Manifest SOP text gives process guidance, **never** credentials or tool rights. A plugin connection does not imply permission.

## Access control

The internal policy resolver requires all of: global grants, organization grants, an enabled catalog plugin, group allow, agent assignment allow, task allow and trusted actor-specific allow, with every explicit deny overriding. A write/high-risk capability stays non-executable even if all static allow layers permit its *descriptor*. Exact `scope:ownerId` memory authorization is intersected across all policy layers and the work-item project. Phase 2C does not add write endpoints or an invocation surface.

Work-item state and accepted decisions are transmitted as authoritative structured records. Handoff and memory are labelled advisory and cannot change permissions. Mandatory context state never silently truncates. Optional records are omitted on secret detection or budget exhaustion. Character bounds are enforced on the serialized result, not estimated text lengths. Absence of catalog, trusted actor, backend, or scope grants must fail closed; do not fall back to another user's cached packet.

## Validation

```sh
npm run validate:fabric-catalog
node --test server/fabric/*.test.mjs
npm test
npm run build
npm run validate:agent-registry-schema
npm run validate:shared-work-schema
npm run test:shared-work-db
docker compose config
docker compose -f compose.yaml -f compose.live.yaml config
```

The first command reports only a catalog digest and metadata counts. No private keys, HTTP listener, network connector or Supabase credentials are needed to validate catalog content.

## Operational gates and rollback

Development is in an isolated feature worktree. Implementer reviews are **not** independent; an external reviewer and verified exact-head CI are required before merge. The Phase 2C runtime is not imported into live Friday HTTP startup and remains disabled by default. Do not change VM102, database tables/grants or existing Docker tags until separately authorized. For a future approved rollout, disable the optional Phase 2C composition or revert its app image; do not drop Phase 2B historical records.
