# Identity Management Service

## Overview

The Identity Management Service (IMS) is FireFoundry's canonical identity and authorization store. It mints a stable, platform-owned **principal ID** for every user, developer, service, and workload; maps external identities (IdP subjects, API keys) onto those principals; manages groups, roles, and permissions; and answers "is this principal allowed to do this?" through a policy decision endpoint. IMS can also act as an **OpenID Provider** for human sign-in, with per-realm user directories, email magic links, and TOTP multi-factor authentication.

IMS is a REST service (Express 5 on Node.js) backed by its own PostgreSQL database.

## Purpose and Role in Platform

Before IMS, "a user" was represented differently by each surface — an IdP object ID in one place, an OIDC subject in another, an email address elsewhere. IMS gives the platform one ID that every service can agree on and a single place to store what that ID may do:

- **Canonical identity** — one `principal.id` per person or workload, regardless of how many external identities point at it
- **Authorization data** — groups (hierarchical), roles, role assignments, and allow/deny permissions, scoped by environment
- **Policy decisions** — `POST /v1/check` evaluates direct, group-inherited, and role-derived permissions with deny-overrides-allow semantics
- **Human login** — realm-scoped OpenID Connect provider (authorization code + PKCE) intended for first-party clients such as the CLI and Console
- **Audit trail** — every security-relevant mutation and denial is written to an append-only audit log

IMS does not replace your corporate IdP. When an upstream service has already authenticated a user against an external IdP, it calls `POST /v1/principals/ensure` to turn that authenticated identity into a canonical principal. IMS trusts the calling service to have done that authentication.

## Key Features

- **Canonical principals** — Six principal types (`HumanUser`, `Developer`, `ServiceAccount`, `Application`, `AgentBundle`, `FaaSFunction`) with `active` / `invited` / `deprovisioned` lifecycle
- **External identity mapping** — Idempotent `ensure` (find-or-create by `(source, external_value)`), plus a guarded link protocol that requires proof of control of both identities and never re-points an identity to a different principal
- **RBAC with inheritance** — Hierarchical groups, roles, expirable role assignments, and standalone permissions attachable to principals, groups, or roles
- **Wildcard permissions** — `action` and `resource` patterns support `*` glob matching
- **Environment scoping** — Grants can be limited to one environment (for example `prod`) or made global; global grants need a separate, more privileged permission
- **Deny-overrides-allow evaluation** — Default deny; any matching deny rule wins over any allow
- **Realms** — Isolated identity namespaces, each with its own principals, groups, roles, permissions, login policy, and OIDC issuer
- **Native login** — Email magic link plus TOTP MFA (with one-time recovery codes), MFA required by default
- **OIDC provider** — Per-realm issuer, discovery, authorization code flow with mandatory PKCE S256, refresh tokens, RP-initiated logout, and allow-listed token introspection
- **Self-gated admin API** — IMS's own management endpoints are authorized by IMS permissions (`ims:manage-*`), evaluated against the calling service's own principal
- **Audit log** — Append-only, realm-attributed record of mutations, denials, and login events
- **Fenced role handoff** — Generation-fenced API for safely transferring a scoped role (for example, a bootstrap operator role) from one principal to another

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        HTTP Layer (Express 5)                │
│   requestId  →  entitlement guard  →  JSON / form parsers    │
└──────┬──────────────────────┬──────────────────────┬─────────┘
       │                      │                      │
┌──────▼───────────┐ ┌────────▼──────────┐ ┌─────────▼──────────┐
│ Principal & PDP  │ │   RBAC Routes     │ │ Realm Admin Routes │
│ /v1/principals   │ │ /v1/groups        │ │ /v1/realms         │
│ /v1/check(-batch)│ │ /v1/roles         │ │ clients, users,    │
│ /v1/audit-log    │ │ /v1/permissions   │ │ sessions, MFA      │
│                  │ │ /v1/role-assign.. │ │                    │
└──────┬───────────┘ └────────┬──────────┘ └─────────┬──────────┘
       │   permission gate: X-API-Key → caller principal →        │
       │   IMS evaluates "ims:*" permission on resource "ims"     │
┌──────▼──────────────────────▼──────────────────────▼──────────┐
│                  IdentityProvider (business logic)            │
│  ensure / link · evaluation engine · RBAC CRUD · audit writer │
└──────────────────────────────┬────────────────────────────────┘
                               │
┌──────────────────────────────┴────────────────────────────────┐
│              OIDC layer  (/realms/{realm}/...)                 │
│  RealmProviderFactory (one OpenID Provider per realm)         │
│  Interaction routes: magic link → TOTP / recovery code        │
│  PostgreSQL adapter for sessions, grants, codes, tokens       │
└──────────────────────────────┬────────────────────────────────┘
                               │
┌──────────────────────────────▼────────────────────────────────┐
│                PostgreSQL — database "ims", schema "ims"       │
│ realm · principal · external_identity · group · role ·        │
│ role_assignment · permission · *_permission · audit_log ·     │
│ local_account · totp_credential · recovery_code ·             │
│ oidc_client · oidc_model · interaction_state                  │
└───────────────────────────────────────────────────────────────┘
```

**Core components:**

- **RouteManager** — Standard endpoints (`/health`, `/ready`, `/status`), principal lifecycle, external identities, `/v1/check`, and the audit log
- **RbacRoutes** — Group, role, role-assignment, permission, and mapping CRUD
- **RealmAdminRoutes** — Realm, OIDC client, and realm-user lifecycle administration
- **Permission gate** — Middleware that resolves the `X-API-Key` header to a caller principal and checks the required `ims:*` permission
- **IdentityProvider** — Business logic and the permission evaluation engine
- **RealmProviderFactory** — Builds and caches one OpenID Provider per realm
- **InteractionRoutes** — The HTML sign-in flow (email, TOTP enrolment/verification, recovery codes)

## Documentation

- **[Concepts](./concepts.md)** — Principals, external identities, groups, roles, permissions, realms, environment scope, and evaluation
- **[Getting Started](./getting-started.md)** — Bootstrap an admin key, create a realm, grant a permission, check it, and sign a user in
- **[Security Model](./security-model.md)** — Authentication, IMS's own authorization, realm isolation, token and session model, and bootstrap
- **[Reference](./reference.md)** — Every REST endpoint, OIDC endpoints, error codes, and environment variables
- **[Operations](./operations.md)** — Helm deployment, required secrets, health checks, scaling limits, monitoring, and troubleshooting

## Version and Maturity

- **Current Version**: 0.1.0
- **Maturity**: Preview. The principal, RBAC, and policy-decision API is functional. Native human login is a tested development path, not yet production-ready: the production email transport is not implemented, and the service must run as a single replica. The Helm chart is opt-in (`identity-service.enabled: false` by default in `firefoundry-core`). See [Operations](./operations.md#current-limitations).

## Repository

Source code: [ff-services-identity](https://github.com/firebrandanalytics/ff-services-identity) (private)

## Related

- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
- [Notification Service](../notification-service/README.md) — Planned delivery channel for sign-in emails
- [Entity Service](../entity-service/README.md) — Domain "person" entities can reference an IMS principal ID
