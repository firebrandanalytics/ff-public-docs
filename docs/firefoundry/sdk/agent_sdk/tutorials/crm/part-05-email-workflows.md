# Part 5: Email Workflows & Notification Service

In [Part 4](./part-04-bff-and-authentication.md) you added an Express BFF with OIDC login and actor identity. Now we'll connect the agent bundle to the **notification service** so that emails are AI-generated and sent as part of entity graph workflows — never composed by the GUI.

**What you'll learn:**
- Integrating the bundle with an external notification service via `fetch`
- Building a `personalize-and-send` endpoint that combines AI personalization with email delivery
- Why emails should flow through the bundle, not the GUI
- Configuring `NOTIF_URL` for service discovery

**What you'll build:** A single-email workflow where the bundle personalizes a template for a contact and sends it via the notification service.

---

## Architecture Principle

```
GUI → BFF → Bundle → Notification Service
                ↑         ↑
           AI generates   Sends the email
           the content
```

The GUI **triggers workflows** by calling bundle endpoints through the BFF. The bundle:
1. Runs an AI bot to generate personalized email content
2. Calls the notification service directly to send it
3. Records the result in the entity graph

The GUI never composes email body text or calls the notification service. Users can provide **customization guidance** (tone, talking points, emphasis) that shapes how the AI generates content, but the actual email content is always AI-generated.

---

## Notification Service Integration

The notification service is a standalone HTTP service that handles email delivery (SMTP, ACS, SendGrid, etc.):

```
POST /send/email
{
  "to": ["recipient@example.com"],
  "subject": "Your personalized subject",
  "html": "<p>Personalized HTML body</p>",
  "from": "sender@company.com",
  "idempotencyKey": "draft-abc123",
  "metadata": { "draft_id": "abc123", "contact_id": "xyz789" }
}
```

The bundle calls this endpoint directly using `fetch`. Add the notification URL as an environment variable:

```bash
# .env for the bundle
NOTIF_URL=http://localhost:8085
```

---

## The Personalize-and-Send Endpoint

This new endpoint combines the existing `personalizeDraft` workflow with email delivery:

```typescript
// In agent-bundle.ts

const NOTIF_URL = process.env.NOTIF_URL || 'http://localhost:8085';

@ApiEndpoint({ method: 'POST', route: 'drafts/personalize-and-send' })
async personalizeAndSend(data: {
  template_id: string;
  contact_id: string;
  actor_id: string;
  customization?: { tone?: string; talking_points?: string[]; emphasis?: string };
}) {
  // 1. Validate the template is approved
  const template = await this.entity_factory.get_entity(data.template_id);
  const templateDto = await template.get_dto();
  if (templateDto.data.status !== 'approved') {
    return { error: `Template not approved (status: ${templateDto.data.status})` };
  }

  // 2. Load contact data
  const contact = await this.entity_factory.get_entity(data.contact_id);
  const contactDto = await contact.get_dto();

  // 3. Create EmailDraftEntity with optional customization
  const draft = await this.entity_factory.create_entity_node({
    app_id: this.get_app_id(),
    name: `draft-${Date.now()}`,
    specific_type_name: 'EmailDraftEntity',
    general_type_name: 'EmailDraftEntity',
    status: 'Pending',
    data: {
      contact_id: data.contact_id,
      template_id: data.template_id,
      contact_name: `${contactDto.data.first_name} ${contactDto.data.last_name}`,
      contact_email: contactDto.data.email,
      contact_company: contactDto.data.company,
      subject_template: templateDto.data.subject_template,
      body_html_template: templateDto.data.body_html,
      subject: null,
      body_html: null,
      status: 'generating',
      actor_id: data.actor_id,
      personalization_notes: data.customization
        ? JSON.stringify(data.customization) : null,
      created_at: new Date().toISOString(),
    },
  });

  // 4. Run EmailPersonalizerBot via BotRunnableEntityMixin
  const personalization = await draft.run();

  // 5. Update draft with personalized content
  const draftDto = await draft.get_dto();
  await draft.update_data({
    ...draftDto.data,
    subject: personalization.subject,
    body_html: personalization.body_html,
    personalization_notes: personalization.personalization_notes,
    status: 'sending',
  });

  // 6. Send via notification service (with timeout + stable idempotency key)
  const idempotencyKey = `send-${data.template_id}-${data.contact_id}-${data.actor_id}`;
  const sendController = new AbortController();
  const sendTimeout = setTimeout(() => sendController.abort(), 30_000);
  let notifResponse: Response;
  try {
    notifResponse = await fetch(`${NOTIF_URL}/send/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: sendController.signal,
      body: JSON.stringify({
        to: [contactDto.data.email],
        subject: personalization.subject,
        html: personalization.body_html,
        from: data.actor_id,
        idempotencyKey,
        metadata: {
          draft_id: draftDto.id,
          contact_id: data.contact_id,
          template_id: data.template_id,
        },
      }),
    });
  } finally {
    clearTimeout(sendTimeout);
  }

  // 7. Update draft status — re-read DTO to avoid overwriting personalized content
  if (!notifResponse.ok) {
    const currentDto = await draft.get_dto();
    await draft.update_data({ ...currentDto.data, status: 'send_failed' });
    return { draft_id: draftDto.id, status: 'send_failed' };
  }

  const sentDto = await draft.get_dto();
  await draft.update_data({ ...sentDto.data, status: 'sent' });

  const finalDto = await draft.get_dto();
  return { draft_id: finalDto.id, status: 'sent', ...finalDto.data };
}
```

**Key design decisions:**
- The `idempotencyKey` is keyed on the stable tuple `(template_id, contact_id, actor_id)` so that retries and double-clicks don't produce duplicate sends
- The `AbortController` with a 30-second timeout prevents the bundle from hanging if the notification service is unreachable
- On send failure, we re-read the DTO before updating status to avoid overwriting personalized content with stale pre-personalization data
- The `customization` parameter lets users guide the AI without providing actual email content
- The existing `personalizeDraft` endpoint stays as a "preview only" option — personalize without sending

---

## BFF Proxy Route

The BFF proxies the new endpoint with actor injection:

```typescript
// In DraftsController.ts
public initializeRoutes(): void {
  this.router.post('/personalize', this.asyncHandler(this.personalize.bind(this)));
  this.router.post('/personalize-and-send',
    this.asyncHandler(this.personalizeAndSend.bind(this)));
}

private async personalizeAndSend(req: Request, res: Response) {
  const body = { ...req.body, actor_id: this.getActorId(req) };
  const result = await this.client.call_api_endpoint(
    'drafts/personalize-and-send', { method: 'POST', body }
  );
  res.json(result);
}
```

---

## GUI Updates

The Personalize & Send tab now offers two actions:

1. **Preview Draft** — calls `personalizeDraft` to show the AI-generated content without sending
2. **Personalize & Send** — calls `personalizeAndSend` to generate and send in one step

```typescript
// In api.ts
export async function personalizeAndSend(data: {
  template_id: string; contact_id: string;
  customization?: { tone?: string; talking_points?: string[]; emphasis?: string };
}) {
  return request<any>('/api/v1/drafts/personalize-and-send', {
    method: 'POST', body: JSON.stringify(data),
  });
}
```

The `sendEmail` function is removed from the API client — the GUI never sends emails directly.

---

## Checkpoint: Verify Email Workflow

1. Create a contact and approve a template (from earlier parts)
2. Call the personalize-and-send endpoint:

```bash
ff-sdk-cli api call drafts/personalize-and-send \
  --method POST \
  --body '{"template_id":"<TEMPLATE_ID>","contact_id":"<CONTACT_ID>","actor_id":"test@example.com"}'
```

3. Verify the response includes `"status": "sent"` and a `draft_id`
4. Check the notification service logs to confirm email delivery
5. Use `ff-eg-read` to verify the EmailDraftEntity was created with status `sent`

---

## Summary

Emails in the CRM are always AI-generated and sent from the bundle as part of entity graph workflows. The GUI triggers workflows; it never composes or sends email directly. This pattern ensures:

- **Content quality** — every email goes through an AI bot
- **Auditability** — every send is recorded in the entity graph
- **Security** — notification service credentials stay in the bundle, not the GUI

[Part 6](./part-06-campaign-execution.md) scales this up to parallel campaign execution — sending personalized emails to hundreds of contacts simultaneously.
