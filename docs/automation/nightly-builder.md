# Friday nightly builder

A scheduled Claude Code session that runs once a night, picks the next
ready item from [`BACKLOG.md`](BACKLOG.md), and opens one pull request for it.
It exists to keep small, well-scoped Friday work moving without the owner
having to start each task.

## What it may do

- Read the repository, `AGENTS.md`, `CODEX.md`, `FRIDAY_SHARED_MEMORY.md`
  and the routed repo skill, exactly as any other agent must.
- Work on **one** backlog item per night, on a branch named
  `bot/nightly-<item-id>`.
- Write tests first, run `make verify`, and open a pull request against
  `main` assigned to the owner.
- On later nights, fix CI failures and answer Codex review comments on its
  own open `bot/nightly-*` pull requests before starting anything new.

## What it must never do

- Merge any pull request, approve a review, or push to `main`.
- Deploy, SSH, or touch VM102, VM100, VM132, Proxmox, Cloudflare,
  networking, DNS, Omada, or any live service.
- Turn on a feature flag by default, add write paths, privileged actions,
  or AI tools that reach infrastructure.
- Start an item whose status is anything other than `ready`, or one
  marked `needs-approval`.
- Store secrets anywhere, or use `VITE_*` for anything privileged.
- Skip, disable, or weaken a test to get green CI.

## Nightly routine

1. If two or more `bot/nightly-*` pull requests are already open, only
   tend those (CI fixes, Codex replies) and stop. The owner reviews at
   their own pace; the queue should not pile up.
2. Otherwise tend any open bot pull request first, then take the first
   item in `BACKLOG.md` with status `ready` whose id does not already have
   an open `bot/nightly-<id>` pull request.
3. Claim it in `FRIDAY_SHARED_MEMORY.md` (Active work row, owner
   `Claude nightly builder`) on the branch, and set the item's status to
   `in-review` in `BACKLOG.md` in the same pull request.
4. Build it within the item's scope. If the item turns out to need
   anything on the "never" list, stop, set it to `needs-approval` with a
   one-line reason in a docs-only pull request, and say so in the summary.
5. Run `make verify`. Only open the pull request when it passes.
6. Add an Activity log entry, update `docs/codex/BUILD_STATUS.md` when a
   capability lands, open the pull request, and end with a short summary
   (item, PR link, verification, anything the owner must decide).

## Adding work

Add an item to `BACKLOG.md` with a unique id, `ready` status, a scope, and
acceptance criteria. Items the owner has not approved yet go in with
`needs-approval`; the builder will leave them alone.
