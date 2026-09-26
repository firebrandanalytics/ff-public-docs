# Skills Service — Operations

How to enable the Skills Service for your application's environment, verify your bundle can reach it, the limits to design around, and caller-side troubleshooting.

## Enabling the Service

The Skills Service ships as the `skills-service` subchart of `firefoundry-core` and is **disabled by default**. Enable it in your environment's `firefoundry-core` values and set the environment it serves:

```yaml
skills-service:
  enabled: true
  configMap:
    enabled: true
    data:
      # The environment UUID whose custom skills and installations agents see
      ENVIRONMENT_ID: "<environment-uuid>"
```

If you create environments with `ff-cli`, the built-in `full-self-contained` environment template enables the Skills Service together with the MCP Gateway.

Two things are required for full functionality:

- **`ENVIRONMENT_ID`** — Without it, agents see only registry skills; custom skills and installations are not served. Use the same UUID as the `environment_id` in your admin calls.
- **Blob storage configured in your environment** — Skill uploads, file reads, and downloads require it. Your environment administrator configures it.

With the default release name, the service is reachable in-cluster at:

```
http://firefoundry-core-skills-service.<namespace>.svc.cluster.local:8080
```

### Exposing Skills over MCP

To give MCP-capable agents the `skills_list`, `skills_read`, and `skills_read_file` tools, point the MCP Gateway's skills adapter at the service:

```yaml
mcp-gateway:
  secret:
    data:
      SKILLS_SERVICE_URL: "http://firefoundry-core-skills-service:8080"
```

See [MCP Gateway — Operations](../mcp-gateway/operations.md).

## Verifying from Your Bundle

1. **Service is up:** `GET /health` returns `{"status":"healthy",...}`.
2. **Identity and grants work:** from your bundle (or a pod in the same namespace), call

   ```bash
   curl -s "http://firefoundry-core-skills-service:8080/v1/skills" \
     -H "X-On-Behalf-Of: app=<your-app-id>; bundle=<your-bundle-id>"
   ```

   You should see your active custom skills and any registry skills your app can see. From a workstation, `ff-cli skills svc-list` with `FF_ON_BEHALF_OF` set does the same check (see [ff-cli skills](../../../../ff-cli/skills.md)).
3. **Content is readable:** `GET /v1/skills/<name>/files` lists the skill's files. A `500` here means blob storage is not configured in your environment.
4. **Over MCP:** call `skills_list` through the MCP Gateway and confirm the same skills appear.

`/ready` reports only that the service is listening; use a real `/v1` call to confirm end-to-end access.

## Limits and Behavior to Design Around

| Item | Behavior |
|------|----------|
| Skill zip size | 50 MB per upload |
| JSON request body | 10 MB |
| Consumer listings | Not paginated; return every visible skill. Omit `include=content` in listings and read content per skill. |
| Version selection | Single-skill reads return the most recently uploaded version, not the highest semver and not the installed version. Upload versions in order and treat "latest upload" as live. |
| Draft skills | Hidden from listings, but a read by exact name still returns them. Don't rely on `draft` to keep a skill secret. |
| Name collisions | If a registry skill and a custom skill share a name, reads return the registry skill. Use distinctive custom names. |
| First grant | Granting an application its first skill hides all other non-system skills from it. |
| Deleting | Deleting a custom skill removes all its versions. |

## Security

- **Identity header** — The consumer API trusts `X-On-Behalf-Of` as sent. It should be set by your bundle or the MCP Gateway, never passed through from end users.
- **Admin API** — Has no per-caller authorization. Anyone who can reach `/admin` can upload, delete, and grant skills. The service is cluster-internal by default (no ingress); call the admin API only from trusted tooling such as the FF Console or your CI scripts.
- **Skill content is agent instructions** — Treat the ability to upload or activate a skill as equivalent to the ability to change your agents' behavior, and review skills before activating them.
- **Agents that publish skills** — A bundle that writes skills (the [learning loop](./concepts.md#skills-as-a-learning-loop)) holds the same power as any admin client. Keep the write in a deterministic, validated step, publish to a candidate skill when you want human review, and don't expose the admin API to the model as a free-form tool.

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---------|--------------|------------|
| `GET /v1/skills` returns `[]` | No `X-On-Behalf-Of` header, or it lacks `app` or `bundle` | Send `X-On-Behalf-Of: app=<id>; bundle=<id>` |
| `403 Access denied` on a single skill | No identity, or your application has grants that don't include this skill | Add identity; grant the skill to your application |
| Agent suddenly sees fewer skills | The application received its first grant, so only granted skills are visible | Grant every skill the app needs |
| Custom skill not listed | `status` is `draft` or `deprecated`, or it has no uploaded version | `PUT /admin/custom/:id` with `{"status":"active"}`; upload a version |
| Custom skills or installations never appear | The service's `ENVIRONMENT_ID` is unset or differs from the `environment_id` you used | Use the configured environment UUID; ask your environment administrator to set it if missing |
| Read returns a newer version than the one installed | Reads use the latest upload; installations only pin listings | Expected in this release; see [Current Limitations](./concepts.md#current-limitations) |
| Read returns a different skill than your custom one | A registry skill has the same name | Rename your custom skill |
| Upload returns `500` | Invalid zip or missing `SKILL.md`, duplicate version or name, malformed `metadata` JSON, file over 50 MB, or blob storage not configured | See the checklist in [Reference — Error Responses](./reference.md#error-responses) |
| `POST /admin/custom` with a file returns `500` but the skill exists | The skill was created but its first version failed to upload | Fix the cause, then upload with `POST /admin/custom/:id/versions` |
| File read or download returns `500` | Blob storage is not configured in your environment | Ask your environment administrator to configure blob storage |
| MCP `skills_*` tools missing | The MCP Gateway's skills adapter is not configured | Set `SKILLS_SERVICE_URL` on the MCP Gateway |
| `skills_list` returns `[]` for LLM tool calls but not for direct calls | The caller identity isn't reaching the gateway on that path | Ask your environment administrator how the broker forwards `X-On-Behalf-Of` to the gateway |
| A bundle's SDK skill provider yields no skills | Provider misconfigured or not sending identity; SDK providers log a warning and return nothing | See [Skills in Agent Bundles — Troubleshooting](../../../sdk/agent_sdk/feature_guides/skills.md#troubleshooting) |
| An agent-published version isn't picked up | A bundle-side cache is holding the old skill | Clear the cache; the service and gateway always return the latest upload |
