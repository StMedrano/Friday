# FRIDAY HTTPS + Private Routing Foundation Design

Date: 2026-08-20
Status: Approved design, pending implementation plan
Scope: Infrastructure foundation only

## 1. Purpose

Build the private HTTPS access foundation that FRIDAY will require before Owner authentication and any approval-gated infrastructure mutation are introduced.

The target user-facing URL is:

`https://friday.mytechtactics.com`

FRIDAY must be reachable from the home LAN and through Twingate, while remaining unavailable as a public Internet service. Nginx Proxy Manager (NPM) on VM100 becomes the standard private HTTPS gateway for FRIDAY and future homelab applications.

This design intentionally does not add authentication, Supabase integration, break-glass access, remediation APIs, Docker mutation authority, or Proxmox mutation authority. Those are separate follow-on specs.

## 2. Current State

### VM100

- Address: `192.168.1.124`
- Runs Nginx Proxy Manager and AdGuard Home.
- NPM has been repaired after Apache took TCP/80 during the 2026-08-17 VM100 boot.
- Apache is disabled and is no longer intended to own TCP/80.
- NPM currently uses host mappings `80:80`, `81:81`, and `4443:443`.
- NPM persistent state is bind-mounted under `/home/stalin/docker/nginx-proxy-manager/data` and `/home/stalin/docker/nginx-proxy-manager/letsencrypt`.
- AdGuard Home is installed and its administrative login is working, but it is not yet the authoritative DNS resolver for the LAN.

### VM102

- Address: `192.168.1.64`
- Hosts the FRIDAY controller.
- FRIDAY currently publishes host TCP/3010 through Docker using `${FRIDAY_UI_PORT:-3010}:3010`.
- FRIDAY is currently reachable directly over the LAN at `http://192.168.1.64:3010`.
- Existing production behavior is read-only infrastructure observation plus FRIDAY-owned monitoring/diagnostic state changes.

### External services

- Public DNS zone: `mytechtactics.com` in Cloudflare.
- Remote private access: Twingate.
- No public FRIDAY router forwarding is desired.

## 3. Architectural Decisions

1. NPM on VM100 is the standard private HTTPS gateway for FRIDAY and future private homelab applications.
2. FRIDAY uses the single canonical URL `https://friday.mytechtactics.com` on both LAN and Twingate.
3. AdGuard Home provides private DNS on the LAN and resolves `friday.mytechtactics.com` to VM100 (`192.168.1.124`).
4. Cloudflare is used for the public authoritative zone and DNS-01 certificate validation only. It does not proxy or route user traffic to FRIDAY.
5. NPM obtains a publicly trusted Let's Encrypt certificate for `friday.mytechtactics.com` using a least-privilege Cloudflare API token scoped to the `mytechtactics.com` zone.
6. NPM moves from host HTTPS port `4443` to standard host HTTPS port `443`.
7. NPM admin TCP/81 remains private and is available only from the LAN and authorized Twingate access. It is never publicly forwarded.
8. VM102 TCP/3010 becomes a backend-only service path. VM100 (`192.168.1.124`) is the only permitted remote source.
9. VM102 uses UFW for host policy plus Docker-aware filtering because Docker-published ports can bypass ordinary UFW input rules.
10. Twingate exposes the FRIDAY FQDN as a private Resource. Twingate's Connector resolves the FQDN inside the remote network using private DNS; remote clients do not require direct access to the AdGuard resolver for normal FRIDAY use.
11. There will be no public router forwarding to FRIDAY, NPM TCP/81, or VM102 TCP/3010.

## 4. Target Architecture

### LAN path

```text
LAN client
    |
    | DNS
    v
AdGuard Home - VM100
friday.mytechtactics.com -> 192.168.1.124
    |
    | HTTPS :443
    v
Nginx Proxy Manager - VM100
    |
    | private backend HTTP :3010
    v
FRIDAY - VM102
192.168.1.64
```

### Remote path

```text
Remote device
    |
    v
Twingate Client
    |
    | authorized FQDN Resource
    v
Twingate Connector on private network
    |
    | Connector-side private DNS resolution
    v
AdGuard Home -> 192.168.1.124
    |
    | HTTPS :443
    v
Nginx Proxy Manager - VM100
    |
    | private backend HTTP :3010
    v
FRIDAY - VM102
```

The browser sees one URL and one trusted certificate in both cases.

## 5. Component Responsibilities

### 5.1 AdGuard Home

AdGuard is the private LAN resolver for the homelab namespace.

Required FRIDAY rewrite:

```text
friday.mytechtactics.com -> 192.168.1.124
```

AdGuard must prove ordinary upstream resolution before LAN DHCP is changed to use it. Clients must not be configured with a public secondary resolver alongside AdGuard for this private namespace, because a public resolver could bypass the private rewrite unpredictably.

For Twingate, the Connector must be able to resolve `friday.mytechtactics.com` through private DNS. Normal remote users do not need to send DNS queries directly to AdGuard; Twingate performs Resource interception and Connector-side resolution.

### 5.2 Cloudflare

Cloudflare remains authoritative for the public `mytechtactics.com` zone.

Its role in this design is certificate validation only. The implementation uses a dedicated API token with the minimum DNS permissions required for the DNS-01 challenge and scopes that token to the `mytechtactics.com` zone.

The token must not be stored in FRIDAY frontend code, `VITE_*` variables, git, shell history, screenshots, or documentation.

No public Cloudflare proxy route to FRIDAY is created as part of this spec.

### 5.3 Nginx Proxy Manager

NPM is the HTTPS gateway.

Current host mappings:

```text
80:80
81:81
4443:443
```

Target host mappings:

```text
80:80
81:81
443:443
```

NPM will define a proxy host:

```text
Host: friday.mytechtactics.com
Upstream: http://192.168.1.64:3010
TLS: Let's Encrypt via Cloudflare DNS-01
Force SSL: enabled
WebSocket support: enabled when required by FRIDAY
```

TCP/80 is retained on the private network for normal HTTP-to-HTTPS behavior and NPM operation. The design does not require public TCP/80 exposure because certificate validation uses DNS-01.

TCP/81 is an administrative surface and must remain private.

### 5.4 VM102 Host Firewall

UFW remains the human-readable host firewall policy, but published Docker traffic requires a Docker-aware enforcement layer.

The implementation must inspect the actual Docker firewall backend on VM102 before writing rules. It must use a Docker-supported filtering path that is evaluated for published container traffic, rather than relying on UFW INPUT rules alone. If the host exposes a supported `DOCKER-USER` path, that is the preferred policy insertion point; otherwise the implementation plan must select the equivalent supported nftables path and test it before rollout.

Required effective policy:

```text
192.168.1.124 -> VM102:3010    ALLOW
other LAN IPs -> VM102:3010    DROP
Twingate direct -> VM102:3010  DROP
LAN/Twingate -> VM100:443      ALLOW via private routing
LAN/Twingate -> VM100:81       ALLOW only as administrative access
Internet -> VM100:81           NOT EXPOSED
Internet -> FRIDAY             NOT EXPOSED
```

SSH access to VM102 must be preserved throughout implementation.

The Docker daemon firewall behavior must not be disabled globally. In particular, the design does not set Docker's `iptables` or `ip6tables` daemon options to `false`.

### 5.5 Twingate

FRIDAY is represented as a private FQDN Resource for `friday.mytechtactics.com`, with access granted only to the intended Twingate users/groups.

The Connector must be able to resolve the FQDN inside the private network and route to VM100 TCP/443. Twingate performs remote client Resource interception; the remote client does not need the real `192.168.1.124` address and does not need direct access to AdGuard for ordinary browser access.

The design keeps one canonical FRIDAY URL. No separate remote hostname is introduced.

## 6. Rollout Sequence

Implementation must proceed in the following order and stop at the first failed validation:

1. Confirm VM100 host TCP/443 is unused.
2. Back up NPM Compose configuration and persistent data.
3. Change NPM host HTTPS mapping from `4443:443` to `443:443` only.
4. Recreate only the NPM container without pulling a new image unless a separate upgrade is explicitly approved.
5. Verify NPM TCP/80, TCP/81, TCP/443, admin UI, database, existing proxy hosts, outbound DNS, and container networking.
6. Create a least-privilege Cloudflare DNS API token for `mytechtactics.com` without exposing the token in logs or shell history.
7. Obtain the trusted certificate for `friday.mytechtactics.com` using NPM DNS-01.
8. Create the NPM proxy host to `http://192.168.1.64:3010`.
9. Validate the NPM-to-FRIDAY path while VM102 direct access is still available.
10. Inspect VM102's UFW state, Docker firewall backend, SSH rule, and current Docker published-port behavior.
11. Add VM102 host policy and Docker-aware filtering so only `192.168.1.124` can reach TCP/3010 remotely.
12. Verify VM100 can still reach FRIDAY TCP/3010.
13. Verify an ordinary LAN client can no longer reach VM102 TCP/3010 directly.
14. Verify `https://friday.mytechtactics.com` still succeeds through NPM.
15. Validate AdGuard upstream DNS and the FRIDAY private rewrite through explicit queries.
16. Move one test LAN client to AdGuard DNS and validate ordinary Internet DNS plus FRIDAY HTTPS.
17. Change LAN DHCP/DNS to use AdGuard only after the test client passes.
18. Define/validate the Twingate private FQDN Resource and confirm Connector-side resolution reaches VM100.
19. Validate FRIDAY HTTPS from a remote Twingate client.
20. Run final FRIDAY regression checks through the canonical HTTPS URL.

## 7. Fail-Closed Rules

### NPM

- Do not change NPM data, database, certificates, or unrelated proxy hosts while changing the host port mapping.
- If TCP/443 cannot bind, restore the previous port mapping and stop.
- If NPM recreation loses persistent configuration, stop and restore from the timestamped backup before continuing.
- Do not pull or upgrade the NPM image as part of the port-mapping change unless separately approved.

### VM102 firewall

- Do not apply the TCP/3010 restriction until the NPM-to-FRIDAY proxy path passes.
- Preserve SSH connectivity before applying any firewall change.
- After each firewall change, prove `192.168.1.124 -> 192.168.1.64:3010` still succeeds.
- If that backend path fails, roll back the new filtering rule immediately rather than widening access globally.
- Never disable Docker's firewall management globally as a workaround.

### AdGuard

- Do not make AdGuard authoritative for LAN clients until its upstream DNS and private rewrite both pass.
- Roll out first to one client, then DHCP/network-wide.
- If ordinary name resolution fails after LAN rollout, revert DHCP DNS to the previous resolver while diagnosing AdGuard.

### Twingate

- Do not expose FRIDAY publicly to compensate for Twingate or private-DNS failure.
- If the FQDN Resource does not resolve at the Connector, fix Connector-side/private DNS resolution rather than adding a public FRIDAY record that reveals the private destination.

## 8. Acceptance Criteria

Spec 1 is complete only when all of the following are true:

```text
https://friday.mytechtactics.com
  PASS trusted browser certificate
  PASS certificate matches friday.mytechtactics.com
  PASS no :4443 required
  PASS no :3010 required
  PASS HTTP redirects to HTTPS
  PASS works from LAN
  PASS works through authorized Twingate access

Direct backend
  PASS VM100 can reach VM102:3010
  PASS ordinary LAN clients cannot reach VM102:3010 directly
  PASS Twingate users cannot bypass NPM to VM102:3010

Gateway management
  PASS NPM admin TCP/81 remains private
  PASS no public router forwarding exists for NPM TCP/81
  PASS no public router forwarding exists for VM102 TCP/3010

DNS
  PASS AdGuard resolves friday.mytechtactics.com to 192.168.1.124 on LAN
  PASS ordinary upstream DNS continues to resolve
  PASS Twingate Connector resolves the private FRIDAY FQDN to the private destination path

FRIDAY regression
  PASS /healthz through NPM
  PASS /api/health through NPM
  PASS /api/overview through NPM
  PASS monitoring/incidents still load
  PASS read-only diagnostic re-run still works
```

## 9. Testing Strategy

### Repository tests

Where the FRIDAY repository changes, implementation must add automated tests before implementation code/config changes when practical. At minimum, CI must continue to validate:

- Compose syntax.
- FRIDAY image build.
- Existing diagnostics/observer/monitoring safety boundaries.
- No new Docker mutation or remediation endpoint is introduced by Spec 1.
- No secret is moved into browser-visible frontend configuration.

### Live infrastructure validation

Network policy must be verified from the relevant trust boundaries, not inferred from configuration alone:

- VM100 tests backend access to VM102 TCP/3010.
- VM102 tests local FRIDAY health and confirms firewall state.
- A normal LAN client tests direct TCP/3010 rejection and HTTPS success through NPM.
- A Twingate client tests the canonical HTTPS URL remotely.
- NPM is verified for TCP/80, TCP/81, TCP/443, certificate state, proxy-host state, and existing configuration preservation.
- AdGuard is tested directly before any DHCP change and then from a single test client before network-wide rollout.

## 10. Security Invariants

Spec 1 must preserve the following invariants:

- FRIDAY remains an infrastructure control plane with no public Internet exposure.
- NPM is the only normal user-facing path to FRIDAY.
- VM102 TCP/3010 is not a general LAN service after rollout.
- Cloudflare credentials remain server-side and least-privilege.
- NPM administrative access remains private.
- Docker socket authority is not expanded.
- Observer authority remains read-only.
- Proxmox authority remains read-only.
- No start/stop/restart/delete/update infrastructure API is introduced.
- No approval endpoint is introduced.
- Authentication is not introduced in this spec.
- No unrelated VM100 service is restarted or modified as part of FRIDAY routing changes.

## 11. Rollback Targets

Implementation must capture enough pre-change state to return to these known-good boundaries:

- NPM previous Compose mapping `4443:443` and its timestamped persistent-data backup.
- Previous LAN DHCP/DNS configuration before AdGuard becomes authoritative.
- VM102 pre-change UFW and Docker-aware firewall state.
- Existing FRIDAY Compose deployment and health behavior.

Rollback must be component-local. A failure in DNS, NPM, Twingate, or VM102 filtering must not trigger unrelated service changes.

## 12. Follow-On Specs

After Spec 1 is implemented and production-validated, proceed separately with:

1. Owner authentication + Supabase/PostgreSQL infrastructure database.
2. SSH-activated single-use break-glass Owner access on VM102.
3. Approval-gated restart of one existing VM100 Docker container with proposal, Owner approval, execution, verification, and audit.

No follow-on authority should be implemented before this routing foundation passes its acceptance criteria.

## 13. External Technical References

- Docker packet filtering and UFW behavior: https://docs.docker.com/engine/network/packet-filtering-firewalls/
- Twingate Resource and private DNS behavior: https://www.twingate.com/docs/resources
- Twingate DNS resolution flow: https://www.twingate.com/docs/how-dns-works-with-twingate
- Twingate private DNS best practices: https://www.twingate.com/docs/private-dns-best-practices
- Cloudflare API token creation and zone scoping: https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
