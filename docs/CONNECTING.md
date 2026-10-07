# Connect a private 3DEXPERIENCE runtime

The browser talks only to the local NOVA server. That server owns platform authentication and executes individually reviewed semantic reads. There is no generic REST executor, browser-cookie scraping, password collection, login bypass or arbitrary URL field in a mission.

## 1. Verify the release and operation contracts

Use the [official developer guides](https://www.3ds.com/support/documentation/developer-guides) for the precise tenant release and deployment. During the initial research, inspected cloud guides redirected to sign-in. An entitlement-gated guide may document a public API; its content must still be reviewed through an authorized account before admitting an operation.

For each operation record the supported method, path, request/response schema, authentication, security context, CSRF requirement, permissions and product/role licensing. Record the official documentation link and reviewer. Treat the manifest as an operator attestation, **not independent proof** that an API is supported. Do not mark booleans true just to unlock a button.

This adapter currently implements only read-only GET contracts with simple path and query mappings. It supports a pre-provisioned bearer token or a documented Basic credential pair; it does not assert either is valid for your tenant. The configured mechanism must match the reviewed contract. CAS/session authentication and credential renewal require a future adapter.

## 2. Create private configuration

```bash
cp .env.example .env
mkdir -p .private
cp config/contract.template.json .private/verified-contract.json
```

The template is intentionally invalid for admission. Replace its review placeholders with verified values, and add only operations actually reviewed. Keep it in `.private/`; never commit a completed tenant contract or `.env`.

Set these private variables:

| Variable                               | Meaning                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| `NOVA_TENANT_ORIGIN`                   | One exact HTTPS service origin, with no path, query, fragment or embedded credentials |
| `NOVA_RELEASE`                         | Exact release identifier, matching the contract                                       |
| `NOVA_SECURITY_CONTEXT`                | Authorized security context supplied in the `SecurityContext` header                  |
| `NOVA_CONTRACT_FILE`                   | Private path to the reviewed JSON manifest                                            |
| `NOVA_AUTH_MODE`                       | `bearer` or `basic`, matching documented authentication                               |
| `NOVA_ACCESS_TOKEN`                    | Bearer token, only for a verified bearer contract                                     |
| `NOVA_CLIENT_ID`, `NOVA_CLIENT_SECRET` | Credential pair, only for a verified Basic contract                                   |

The supported private deployment is on a trusted operator machine. OS access controls must protect its configuration and local processes. Keep bearer tokens fresh using the approved provisioning mechanism; NOVA never silently refreshes credentials or changes identity.

## 3. Bind semantic fields

The executable schema is [`server/config.ts`](../server/config.ts). A manifest has `schemaVersion: 1`, the exact `release`, `authenticationVerified: true`, `authMode`, a nonempty `reviewedBy`, a past/current `verifiedAt` date, and `operations` keyed by admitted semantic names.

Each admitted operation requires:

- `classification: PUBLIC_SUPPORTED`, `method: GET`, `readOnly: true`, `csrf: NOT_REQUIRED`.
- An official HTTPS documentation URL under `3ds.com`, a documented `operationId`, `requiredRole` and `requiredLicense`.
- `requestSchemaReviewed: true` and `responseSchemaReviewed: true`.
- An exact relative `path`. `{id}` is the only supported path placeholder and is encoded from a restricted object identifier.
- For search, a documented `queryParameter`. Search input is passed as one encoded query value. Do not bind this adapter to an advanced query grammar without reviewing and implementing its escaping and semantic restrictions.
- `rowsPath`, where needed, and `fields` mapping semantic field names to dot-separated upstream property paths. Bracket syntax and arbitrary expressions are not supported.
- A documented `totalPath` or Boolean `completePath` for coverage when available. Without evidence of completeness, a search has `unknown` coverage. NOVA does not invent pagination links or follow them in this version.

Engineering search and detail mappings require string fields `id`, `identifier`, `title` and `revision`. Optional normalized fields are `state`, `superseded` (Boolean), `owner`, `material`, `connector`, `pinCount` and `voltage` (numbers). Normalize only when the upstream meaning matches; translating an arbitrary tenant maturity value into `REVIEW_ELIGIBLE` is not an authorized policy.

Structure records can map `occurrence`, `reference`, `included` (Boolean), `quantity` (number) and `configuration`. Knowledge records can map `id`, `title`, `statement`, `scope`, `status`. Requirement records can map `id`, `text`, `linkedFields` (string). Identity reads can map `id` and `displayName`. Extra fields are discarded. Unexpected types or missing required engineering fields stop processing.

The initial live readiness gate requires both `search_engineering_items` and `get_engineering_item`. The Connections test additionally requires `get_current_user`; it makes only that reviewed identity read and does not prove authorization for other operations.

This first adapter has one service origin. Cross-service missions that need different origins require explicit service-specific credential and contract bindings in a future version. Do not point the current adapter at a generic forwarding proxy to circumvent this boundary.

## 4. Restart and test

```bash
npm run build
npm start
```

Open Connections, refresh status and inspect every readiness item. If available, run **Test verified connection**. Select **My 3DEXPERIENCE** and start with a narrow read of an authorized test item, for example `Find ITEM-100` using your own identifier. Do not use production mutations as a connection test.

The runtime never redirects authenticated requests, retries a permission denial, changes principal or sends raw upstream errors to the browser. A 401 or 403 must be resolved by the platform owner through the legitimate access process. Live revision eligibility remains `insufficient_evidence` until an approved tenant review-policy adapter is implemented.

## Optional local intent model

The deterministic router covers the supported mission families without an LLM. To classify otherwise unrecognized mission wording through a local Ollama instance, set:

```dotenv
NOVA_MODEL_PROVIDER=ollama
NOVA_MODEL_URL=http://127.0.0.1:11434
NOVA_MODEL_NAME=your-installed-compatible-model
NOVA_MODEL_EGRESS=true
```

This sends only the mission text and a fixed intent schema to the configured loopback model. Retrieved platform evidence and credentials are not included. The model must support [structured outputs](https://docs.ollama.com/capabilities/structured-outputs). The runtime checks the returned intent and refuses invented identifiers; model output cannot override tool admission or write policy. Test the selected model and hardware locally. No model benchmark or hardware-fit claim is made here.

Remote model endpoints, hosted multi-user operation, automatic browser SSO and live write workflows are outside this implementation's scope.
