# Friday Local Agent Platform

## Goal

Friday must be able to operate its core agent platform entirely inside the homelab without requiring OpenAI, Anthropic, Groq, Gemini, Azure AI, or another third-party AI service.

`local-first` means cloud-independent, not literally protocol-free. Friday may use private/local interfaces such as Ollama HTTP on the LAN/localhost, SSH, Docker, Proxmox CLI/API, PostgreSQL, systemd, and approved internal services.

Cloud AI may remain an optional operator-enabled escalation path, but Friday's core operation must not depend on it.

## Target architecture

```text
Operator
  -> Friday UI
  -> Friday Controller / Orchestrator
  -> Agent Registry
       -> Proxmox Agent
       -> Infrastructure Agent
       -> Network Agent
       -> Identity Agent
       -> Media Agent
       -> Development Agent
       -> Production Agent
       -> Database Agent
       -> Security Agent
       -> Backup Agent
  -> Local Ollama model provider
  -> Policy + Approval Engine
  -> Controlled Tool Executor
  -> Homelab targets
  -> Durable audit + local memory
```

Agents are not separate LLM instances. An agent is a portable definition containing instructions, scope, tools, permissions, memory scope, and workflows. Multiple agents may share one Ollama model.

## Agent specification direction

A future Friday Agent Specification v1 should support definitions similar to:

```yaml
name: infrastructure-agent
description: Operates approved infrastructure services
model:
  provider: ollama
  profile: local-coder
scope:
  hosts:
    - vm100
tools:
  - ssh.read
  - docker.inspect
  - docker.logs
  - systemd.status
  - journal.read
permissions:
  observe: automatic
  safe_action: automatic_logged
  configuration_change: approval_required
  destructive: forbidden
memory:
  namespace: infrastructure
```

Agent definitions must remain model-provider independent so a local Ollama model can be replaced without rewriting the agent.

## Local model layer

Ollama is the default model runtime for local agents. Its HTTP interface is considered an internal Friday dependency when restricted to the controller/LAN; it is not a cloud dependency.

Friday should support model profiles rather than hard-coding a different model per agent, for example:

- `local-router`: lightweight intent classification and agent routing.
- `local-general`: routine reasoning, summaries, diagnostics, and planning.
- `local-coder`: code/configuration analysis and implementation planning.

Do not require one Ollama process/model per agent.

## Controlled tool execution

The LLM must never receive unrestricted root shell access. Models propose structured tool calls; Friday validates scope and policy before execution.

Example request:

```json
{
  "tool": "docker.restart",
  "target": "nginx-proxy-manager",
  "host": "vm100"
}
```

The executor resolves that request to an allowlisted implementation. Raw shell execution, if ever introduced, must be separately permissioned, tightly constrained, audited, and disabled by default.

Preferred local integrations include:

- SSH with dedicated service identities and least privilege.
- Docker CLI/approved observer or executor service.
- Proxmox `qm`, `pct`, `pvesh`, and narrowly scoped Proxmox credentials.
- `systemctl`, `journalctl`, `df`, `lsblk`, `ip`, and `ss` through allowlisted tools.
- Git and Ansible for versioned, repeatable configuration changes.
- PostgreSQL for durable state, inventory, audit, and memory metadata.

## Permission levels

Friday agents use four operational levels:

| Level | Meaning | Default behavior |
| --- | --- | --- |
| 0 Observe | Inventory, health, logs, metrics, diagnostics | Automatic |
| 1 Safe action | Low-risk reversible action such as an approved service restart | Automatic only when explicitly allowlisted; always logged |
| 2 Configuration | Compose/configuration/resource/network changes | Operator approval required |
| 3 Destructive | Delete VM/container/data, format storage, destructive database operations | Explicit approval plus required precondition/backup; may be forbidden by agent policy |

The existing repository safety boundary remains authoritative while execution infrastructure is incomplete. Do not grant mutation tools merely because this document describes the target architecture.

## Initial agent catalog

1. **Friday Orchestrator** — classify intent, select agents, coordinate workflows, and enforce policy.
2. **Proxmox Agent** — VM/LXC inventory, health, snapshots, resource diagnostics, and eventually approved lifecycle operations.
3. **Infrastructure Agent** — VM100 services, Docker, reverse proxy, DNS, monitoring, and infrastructure diagnostics.
4. **Network Agent** — Omada, VLAN/routing/DNS/DHCP visibility and eventually approved network changes.
5. **Identity Agent** — Authentik and identity-service health/configuration workflows.
6. **Media Agent** — media VM/Umbrel, Emby, SABnzbd, storage, and media-service health.
7. **Development Agent** — development environments, builds, tests, and deployments.
8. **Production Agent** — production health and controlled release workflows.
9. **Database Agent** — PostgreSQL/Supabase-compatible workloads where appropriate, backup verification, and database health.
10. **Security Agent** — security events, certificates, exposure checks, and recommendations.
11. **Backup Agent** — snapshot/backup scheduling state, verification, restore readiness, and pre-change protection.

## Local memory and knowledge

Friday should maintain local durable knowledge for:

- hosts and exact infrastructure identifiers;
- VMs/LXCs and service ownership;
- IP addresses, VLANs, ports, and service mappings;
- containers and dependencies;
- runbooks and local skills;
- incidents and diagnostic findings;
- approved configuration history;
- action/approval/audit records.

PostgreSQL is the preferred durable store. Vector retrieval may be added locally (for example pgvector) when it provides measurable value. Redis is optional and must not become a durability dependency.

The agent must preserve exact infrastructure IDs/names from authoritative Friday state rather than inventing or renumbering resources.

## Local skills

Agents should be strengthened with repository-controlled operational skills/runbooks rather than relying only on model knowledge.

Example layout:

```text
skills/
  docker-troubleshooting/
    SKILL.md
    metadata.yaml
    checks.sh
```

A troubleshooting skill should define ordered observations, allowed tools, stop conditions, remediation options, approval requirements, and verification steps.

## Offline requirement

The target end state is:

```text
Internet unavailable          -> Friday core works
Cloud AI unavailable          -> Friday core works
Ollama available locally      -> AI agents work
Local infrastructure reachable -> tools/diagnostics work
Cloud provider enabled        -> optional escalation only
```

GitHub synchronization may be unavailable offline; Friday's runtime must not depend on GitHub availability. Local Git can remain the source-control mechanism on the controller.

## Implementation phases

### Phase 1 — Local-only advisory agents

- Make Ollama the default/required AI path for local mode.
- Add agent registry and Agent Specification v1.
- Implement orchestrator routing.
- Keep all infrastructure tools read-only.
- Add local agent memory/inventory interfaces.
- Add tests proving operation with all cloud provider credentials absent.

### Phase 2 — Controlled safe actions

Only after authentication, role policy, durable audit, approval infrastructure, and a global automation kill switch are implemented and tested:

- Add structured tool registry/executor.
- Add allowlisted Level 1 actions.
- Require before/after verification.
- Record every action and result.

### Phase 3 — Approved configuration workflows

- Add Level 2 approval workflow.
- Prefer Git/Ansible/versioned configuration over ad-hoc shell mutation.
- Require diff/plan preview before configuration changes.
- Add rollback metadata and verification.

### Phase 4 — Restricted destructive workflows

- Add only explicitly justified Level 3 operations.
- Require explicit approval and backup/snapshot preconditions.
- Keep high-risk operations forbidden when safe automation cannot be proven.

## Non-negotiable safety rules

- No unrestricted LLM-to-root-shell path.
- No secrets in prompts, browser variables, Git, or agent definitions.
- No Docker TCP API exposure.
- No destructive action without policy enforcement and explicit approval.
- No silent network/firewall/DNS/DHCP/VLAN changes.
- No AI provider may bypass Friday's tool executor or approval engine.
- Every mutating action must be attributable, logged, and verifiable.
- The global automation kill switch must override all autonomous actions.

## Definition of success

Friday is local-first when an operator can disconnect cloud AI services and still use the Friday controller, local Ollama-backed agents, local memory, diagnostics, agent routing, approved local tools, and automation policies without loss of core functionality.
