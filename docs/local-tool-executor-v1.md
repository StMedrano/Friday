# Friday Local Tool Executor v1

Friday agents must never receive unrestricted shell access. The local tool executor provides a controlled boundary between an Ollama-backed agent and homelab operations.

## Execution contract

Every tool must be registered with:

- a unique tool name
- a permission action key
- a risk classification
- a concrete execute function

Every agent must separately declare the tool in its `tools` list and declare the corresponding action in its `permissions` map.

The executor then enforces both controls before any tool function can run.

## Permission behavior

- `auto`: execute immediately and audit the result.
- `approval`: return `approval-required` until explicit approval is supplied.
- `forbidden`: never execute.
- missing or invalid permission: treated as `forbidden`.

A tool that is registered globally but not declared by the active agent is also forbidden.

## Example

```js
registry.register({
  name: 'proxmox_read',
  permission: 'list_vms',
  risk: 'observe',
  execute: async ({ context }) => context.proxmox.listVms(),
})
```

An agent can only use this tool when both conditions are true:

```json
{
  "tools": ["proxmox_read"],
  "permissions": {
    "list_vms": "auto"
  }
}
```

## Safety guarantees in v1

The executor does not expose a raw command prompt, does not synthesize shell commands, and does not infer permission from an LLM response. Permission is evaluated independently from the agent model.

Every blocked, approved, completed, and failed tool request can be sent to an audit callback for durable logging.

## Next implementation milestone

Register Friday's existing read-only Proxmox, Docker, VM 100 diagnostic, system-health, and journal adapters as concrete tools. After that, wire structured Ollama tool requests through the executor so the Proxmox Observer can perform real diagnostics while remaining read-only.
