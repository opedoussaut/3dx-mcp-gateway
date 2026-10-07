# ITEROP live read — authentication analysis and minimum access request

## 1. What the R2026x-FD04 OpenAPI declares

- **Authentication:** one scheme, `BasicAuth` (HTTP Basic). It is applied globally, and none of the three operations overrides it.
- **No other schemes declared:** no OAuth, bearer token, API key, cookie or `SecurityContext` header appears for these operations.
- **Two server templates:** `https://{baseUrl}/businessprocess/v2/api/v2` and `{APIGateway}/api/businessprocess/v2` ("Cloud API Gateway"). The base paths differ, and the first template's default already contains `https://`, so the templates are inconsistent. **Neither is a usable tenant address.**
- **Human-user semantics:** `getAllStartableProcesses` is documented "For Human User" and returns processes for "the currently logged in user". Passing `login` is forbidden.
- **`getTasksByUser`:** returns tasks "for the given user". The default when `user` is omitted is not documented.
- **Errors:** for status ≥ 400 the body is `{ code, message }`.

## 2. What remains deployment-specific (not answered by the spec)

| Question                                                                                                                                                                                   | Why it matters                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which route is sanctioned for this tenant: the 3DEXPERIENCE **API Gateway** (public notes say the PFI role is mandatory), or a **direct ITEROP REST** identity issued by an administrator? | Decides the base URL, entitlement and credential type.                                                                                                                                                                                                                                            |
| The exact **service base URL** and base path for that route                                                                                                                                | The spec's templates are placeholders and differ.                                                                                                                                                                                                                                                 |
| Does that route really accept **HTTP Basic**, or does the gateway require another mechanism (for example, a gateway-issued token or agent credentials)?                                    | The spec declares Basic; the gateway may wrap or replace it.                                                                                                                                                                                                                                      |
| Which **identity** do the credentials represent?                                                                                                                                           | `getAllStartableProcesses` is defined for the logged-in human user. A shared robot or service account would return _its own_ startable processes and tasks, not Olivier's. NOVA will not pass `login` or `user` to impersonate anyone. **The credential must act as Olivier himself, read-only.** |
| Required **role / licence** and any extra **headers** (tenant, security context)                                                                                                           | Not in the spec.                                                                                                                                                                                                                                                                                  |
| Is a credential limited to **read** possible?                                                                                                                                              | The API includes writes (`startProcess`, task completion, deployments); the credential should not be able to perform them.                                                                                                                                                                        |
| One **non-sensitive test process** and permission to process responses locally                                                                                                             | Needed to verify results independently.                                                                                                                                                                                                                                                           |

**Not a substitute:** being able to sign in to ITEROP Play shows UI entitlement only. It is not REST access, and NOVA will not use Olivier's browser session, password, cookies or tokens, or probe undocumented endpoints.

## 3. Message to send to the ITEROP / 3DEXPERIENCE administrator

> **Subject: Read-only API access for 3 ITEROP Business Process read operations (personal test)**
>
> Hello,
>
> I am evaluating a local, read-only assistant against our ITEROP Business Process application. It is documented by the official _Business Process API v2_ OpenAPI for 3DEXPERIENCE R2026x-FD04. I am asking for the smallest possible access so it can call **only these three GET operations, as myself**:
>
> 1. `GET /repository/processes/startable/list` (`getAllStartableProcesses`): the processes I can start.
> 2. `GET /runtime/tasks` (`getTasksByUser`), called **without** the `user` parameter: my current tasks.
> 3. `GET /repository/processes/{processKey}/basic` (`getBasicProcessInfo`): basic information for one known process.
>
> I do **not** need: administration, Designer access, process start, task completion, reassignment, deployment, history, data tables or access to other users' tasks. Please do not grant these unless one is technically unavoidable — and if so, tell me which and why.
>
> Could you please tell me:
>
> 1. **Supported route:** the 3DEXPERIENCE API Gateway, or a direct ITEROP REST integration identity? If the API Gateway requires the Enterprise Integration Architect (PFI) role, is a narrower option available?
> 2. **Service base URL and base path** for our tenant. The specification lists `…/api/businessprocess/v2` and `…/businessprocess/v2/api/v2`.
> 3. **API version** deployed (I expect Business Process API **2.0.0**) and our platform release.
> 4. **Required role or licence** for these three reads.
> 5. **Authentication mechanism** for that route. The specification declares HTTP Basic; please confirm, or tell me what the gateway requires instead.
> 6. **A read-only credential that acts as my own user**, not a shared robot account, because the startable-process operation is defined for the logged-in human user. I will store it only on my workstation, outside any code repository.
> 7. **Any required headers** (for example, tenant or security context).
> 8. **One non-confidential test process** (its process key) whose name, version and description I can compare.
> 9. **Confirmation** that I may process these API responses locally on my workstation. No data will be sent to external services.
>
> I will make no write calls, and the tool cannot send them.
>
> Thank you.

## 4. What NOVA needs back (stored only in the private `.env` and `.private/iterop-contract.json`)

- **Settings:** `NOVA_ITEROP_ORIGIN` (HTTPS origin only), the contract's `basePath`, and `NOVA_ITEROP_RELEASE`.
- **Credential:** `NOVA_ITEROP_AUTH_MODE` set to `basic` with `NOVA_ITEROP_ACCESS_KEY` / `NOVA_ITEROP_SECRET_KEY`, or the mechanism the administrator confirms.
- **Headers:** `NOVA_ITEROP_SECURITY_CONTEXT`, only if a header is required.
- **Contract:** the three bindings, with the role and licence confirmed by the administrator. `taskStartDateUnit` stays `unverified` until Test 2.
