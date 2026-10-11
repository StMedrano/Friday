-- Supabase applies broad default table privileges to service_role in public.
-- A GRANT of fewer privileges is additive and does not undo those defaults.
-- Run this after 202610090001_friday_shared_work.sql to enforce append-only
-- history even when the production DB has broader ALTER DEFAULT PRIVILEGES.
--
-- This migration changes privileges on Friday Phase 2B tables only.
revoke all on public.friday_projects, public.friday_work_items,
  public.friday_work_claims, public.friday_agent_runs, public.friday_decisions,
  public.friday_checkpoints, public.friday_handoffs, public.friday_artifacts,
  public.friday_memories from service_role;

grant select, insert, update on public.friday_projects, public.friday_work_items,
  public.friday_work_claims, public.friday_agent_runs, public.friday_decisions
  to service_role;

grant select, insert on public.friday_checkpoints, public.friday_handoffs,
  public.friday_artifacts, public.friday_memories to service_role;