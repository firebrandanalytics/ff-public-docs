# Identity Management Service

## Overview

The Identity Management Service (IMS) gives your FireFoundry application one place to model **who** its users and workloads are and **what** they may do. Your app registers its users, service accounts, and agent bundles as **principals**; organizes them with **groups** and **roles**; attaches allow/deny **permissions** using action and resource names your app chooses; and then asks IMS "is this principal allowed to do this?" through a policy check endpoint. IMS can also sign your app's end users in as an **OpenID Connect provider**, with email sign-in links and authenticator-app (TOTP) multi-factor authentication.

IMS is a REST service. There is no SDK client for it yet; apps and agent bundles call it over HTTP.

## Purpose and Role in Platform

Without a shared identity store, each part of an app tends to represent "a user" differently: an IdP object ID here, an OIDC subject there, an email address somewhere else. IMS gives your app:

- **One stable ID per user or workload** — a platform-minted principal ID you can store in your own data (for example, on an [Entity Service](../entity-service/README.md) node) regardless of how the user signed in
- **Authorization data you don't have to build** — hierarchical groups, roles, expirable role assignments, and allow/deny permissions, optionally scoped per environment
- **A policy decision endpoint** — `POST /v1/check` evaluates direct, group-inherited, and role-derived permissions with deny-overrides-allow semantics, so your app and agent bundles can authorize actions with one call
- **End-user sign-in** — each realm is its own OpenID Provider (authorization code + PKCE), so your web app or CLI can sign users in without running its own login system
- **A tenancy boundary** — a **realm** isolates one app's (or one customer's) users and grants from everyone else's
- **An audit trail** — grants, denials, and sign-in events are recorded per realm

IMS does not replace an identity provider you already use. If your app authenticates users elsewhere (for example against a corporate IdP), your backend calls `POST /v1/principals/ensure` to turn that authenticated identity into an IMS principal, then uses IMS for authorization.

## Key Features

- **Principal types** — `HumanUser`, `Developer`, `ServiceAccount`, `Application`, `AgentBundle`, `FaaSFunction`, with `active` / `invited` / `deprovisioned` status
- **Idempotent user onboarding** — `ensure` finds or creates a principal for an externally authenticated identity
- **RBAC with inheritance** — nested groups, roles, role assignments with optional expiry, and permissions attachable to principals, groups, or roles
- **Wildcard patterns** — `action` and `resource` support `*` glob matching (`cases:*`, `case:restricted-*`)
- **Environment scoping** — a principal can be an admin in `dev` and read-only in `prod`
- **Deny-overrides-allow** — default deny; any matching deny beats any allow
- **Batch checks** — up to 100 decisions per request
- **Realms** — isolated directories, each with its own login policy and OIDC issuer
- **Native sign-in** — email magic link plus TOTP MFA with one-time recovery codes; MFA required by default
- **OIDC provider** — per-realm discovery, authorization code flow with mandatory PKCE S256, refresh tokens, and logout

## Architecture Overview

```
  End user's browser / CLI                 Your app backend, agent bundle,
            │                              or FaaS function
            │ OIDC sign-in                        │
            │ (authorization code + PKCE)         │ X-API-Key: manage principals,
            ▼                                     │ groups, roles, permissions
 ┌──────────────────────────────────────┐         │
 │   Identity Management Service (IMS)  │◄────────┤
 │                                      │         │ POST /v1/check (internal
 │  /realms/{realm}/...   OIDC provider │◄────────┘ network): "may principal P
 │  /v1/...               principals,   │            do action A on resource R?"
 │                        RBAC, checks  │
 └──────────────────────────────────────┘
            │ ID token (sub = principal ID)
            ▼
  Your app uses the principal ID as the key
  for its own data (e.g. Entity Service nodes)
  and for policy checks
```

- Browsers reach only the realm's OIDC paths (`/realms/{realm}/...`).
- Your backend and bundles call the management API with an API key, and call `/v1/check` from inside the cluster.
- The principal ID in the ID token's `sub` claim is the same ID you pass to `/v1/check`.

## Documentation

- **[Concepts](./concepts.md)** — Principals, groups, roles, permissions, realms, environment scope, how checks are evaluated, and how to secure your app's use of IMS
- **[Getting Started](./getting-started.md)** — Model an app's authorization, check a permission from a bundle, and sign a user in
- **[Reference](./reference.md)** — REST endpoints, OIDC endpoints, required `ims:*` permissions, and errors
- **[Operations](./operations.md)** — Enabling IMS for your app, verifying it, limits, and troubleshooting

## Version and Maturity

- **Current Version**: 0.1.0
- **Maturity**: Preview. The principal, RBAC, and policy-check API is functional. Native end-user sign-in works in development environments but is **not yet available in production environments**, because sign-in email delivery is still in development. IMS is opt-in (`identity-service.enabled: false` by default in `firefoundry-core`). See [Operations — Current limitations](./operations.md#current-limitations).

## Repository

Source code: [ff-services-identity](https://github.com/firebrandanalytics/ff-services-identity) (private)

## Related

- [Platform Services Overview](../README.md)
- [Platform Architecture](../../architecture.md)
- [Entity Service](../entity-service/README.md) — domain "person" entities can reference an IMS principal ID
- [Notification Service](../notification-service/README.md) — planned delivery channel for sign-in emails
