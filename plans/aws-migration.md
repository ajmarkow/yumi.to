# Move l.ajm.codes (yumi.to) from Vercel + Supabase to AWS

## Context

`l.ajm.codes` is the `ajmarkow/yumi.to` Nuxt 3 URL shortener. Today it runs on three services:

| Part                      | Today                                                                                                            | Evidence                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Nuxt SSR server           | Vercel (`iad1`)                                                                                                  | `server: Vercel`, CNAME `cname.vercel-dns.com` |
| Link data                 | Supabase Postgres table `shortlinks` (`id uuid`, `created_at`, `short` unique, `link`)                           | `types/supabase.ts`, README SQL                |
| Dashboard login           | Supabase Auth, GitHub OAuth, RLS policies pinned to one user ID                                                  | `pages/dashboard.vue`, README                  |
| API create (iOS Shortcut) | `server/api/new.post.ts` → Supabase edge function `newShortlink` (checks `apikey` header against `API_KEY_HASH`) | `supabase/functions/newShortlink`              |
| DNS                       | Route 53 (white-label NS `ns1-4.ajm.codes` → 205.251.x.x)                                                        | `dig`                                          |

Goal: run all of it on AWS, keep the app's behavior and URLs the same, and carry over every existing short link. Decisions made: **everything on AWS, same app** and **SST** for infrastructure.

Because Supabase is also leaving, "same app" means same routes, same UI, same redirect rules — but the data and auth layer in the code must change. No UI or URL changes.

## Behavior that must survive (acceptance contract)

1. `/<short>`, `/<a>/<short>`, `/<a>/<b>/<short>` → 302 to the stored link. Lookup: exact match on the joined path first; else a prefix match (`short LIKE '<path>%'`) that is used **only when exactly one row matches** (Supabase `.maybeSingle()` returns null on >1 rows); else 302 to `https://l.ajm.codes/`.
2. `/` → same RedirectView logic (falls through to the default redirect).
3. `/gh/<x>` → 302 to `https://github.com/ajmarkow/<x>` (no DB).
4. `/blog/<x>` → looks up `https://ajm.codes/blog/dictionary.json` (no DB).
5. `POST /api/new?link=<url>` with header `apikey: <key>` → creates a 2-char nanoid short, returns `{status, message, newShortlink}` in the same JSON shape. The iOS Shortcut must keep working with no change.
6. `/dashboard` → GitHub login; only AJ can list, search, create, edit, delete links.
7. `robots.txt` still disallows everything.

## Target architecture

- **SST v3** app in the repo (`sst.config.ts`), stage `production`, region `us-east-1`.
- **`sst.aws.Nuxt`** component: Nuxt built with Nitro `aws-lambda` preset → Lambda + CloudFront + ACM cert + Route 53 alias for `l.ajm.codes`.
- **DynamoDB** table `Shortlinks` (on-demand):
  - `pk` = `"LINK"` (single partition; the data set is small), `sk` = `short`.
  - Attributes: `id`, `short`, `link`, `created_at` (kept from Supabase).
  - Exact lookup = `GetItem`; prefix lookup = `Query pk="LINK" AND begins_with(sk, :p)` with `Limit 2` → use only if exactly 1 item.
  - Dashboard list = `Query pk="LINK"`, sort by `created_at` desc in the server.
  - Point-in-time recovery on. `removal: "retain"` so a stack teardown never drops the links.
- **Auth**: `nuxt-auth-utils` with GitHub OAuth, sealed-cookie session. Server allows only the GitHub user ID in `ADMIN_GITHUB_ID`. This replaces Supabase Auth + RLS. No Cognito (GitHub is not an OIDC provider for Cognito without a shim; this is simpler and runs fully inside the Lambda).
- **Secrets**: `sst.Secret` (stored in SSM Parameter Store), linked to the Nuxt function.
- **CI**: GitHub Actions → AWS via OIDC role → `sst deploy --stage production`. Replaces the stale Deno Deploy workflow.
- Expected cost at personal traffic: well under $1/month (Lambda, CloudFront, DynamoDB free tiers + Route 53 already paid).

## Secrets

- `GithubClientId` — Required (new GitHub OAuth App, callback `https://l.ajm.codes/auth/github`)
- `GithubClientSecret` — Required
- `SessionPassword` — Required (`NUXT_SESSION_PASSWORD`, 32+ random chars)
- `ApiKeyHash` — Required (copy the current value of the Supabase edge-function secret `API_KEY_HASH`, so the iOS Shortcut keeps working)
- `AdminGithubId` — Required (AJ's numeric GitHub user ID; not really secret, but kept with the rest)
- `AWS_DEPLOY_ROLE_ARN` — Required (GitHub Actions repo variable, not a secret value)

Retired after cutover: `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, Supabase `API_KEY_HASH`.

## Implementation steps

### 0. Tracking and setup

- Todoist task `6hffcgjw4rhGF7v8` exists in Agentic → Queue. Move it to Active when work starts.
- Clone `ajmarkow/yumi.to` to `/var/lib/paseo/projects/yumi.to`, branch `feat/aws-migration`. Copy this plan to `plans/aws-migration.md` in that repo.

### 1. Back up the links first (before any code change)

- Export `shortlinks` two ways and keep both outside the repo (they are the rollback source):
  - Supabase dashboard → Table editor → Export CSV, **and**
  - REST: `curl "$SUPABASE_URL/rest/v1/shortlinks?select=*&order=created_at" -H "apikey: $SUPABASE_KEY"` → `shortlinks-<date>.json` (anon read is allowed by the public select policy).
- Record the row count. Record the current `API_KEY_HASH` value from Supabase → Edge Functions → Secrets (user does this in the dashboard).

### 2. Upgrade the app base

- Bump `nuxt` to latest 3.x (3.7 is too old for current `nuxt-auth-utils` and SST's Nuxt component). Pin `@nuxt/devtools` instead of `latest`.
- Remove `@nuxtjs/supabase`, `@nuxt/typescript`. Add `nuxt-auth-utils`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `sst`.
- `nuxt.config.ts`: drop the `supabase` block, add `nuxt-auth-utils` module, `nitro: { preset: "aws-lambda" }`. Keep robots, tailwind, headlessui.
- Delete `supabase/` and `types/supabase.ts`; keep `Shortlink` in `types/env.d.ts`.

### 3. Server data layer (new)

- `server/utils/links.ts`: DynamoDB DocumentClient; table name from `Resource.Shortlinks.name` (`sst`). Functions: `getExact(short)`, `getUniquePrefix(short)`, `listLinks()`, `createLink({short, link})` (conditional put `attribute_not_exists(sk)`), `updateLink(id, {short, link})`, `deleteLink(id)`.
  - Update where `short` changes = transactional delete old `sk` + put new `sk` (short is the key).
  - `id` lookups for update/delete: dashboard sends `short` alongside `id`; server uses `short` as key and checks `id` matches.
- `server/utils/requireAdmin.ts`: `requireUserSession(event)` then compare `user.githubId === ADMIN_GITHUB_ID`, else 403.

### 4. Server routes

- `server/api/resolve.get.ts?path=<a/b/c>` → `{ link | null }` using rule 1 above.
- `server/api/links.get.ts`, `links.post.ts`, `links/[short].put.ts`, `links/[short].delete.ts` → admin-only CRUD.
- `server/api/new.post.ts`: same inputs/outputs; replace the Supabase edge-function call with: timing-safe compare of `apikey` header to `ApiKeyHash`, URL validation, nanoid(2) loop with `getExact`, then `createLink`. Response JSON shape unchanged.
- `server/routes/auth/github.get.ts`: `defineOAuthGitHubEventHandler` → `setUserSession({ user: { githubId, login } })` if the ID matches admin, else 403; redirect to `/dashboard`.
- `server/routes/auth/logout.post.ts` (optional; only if the current UI has logout — it doesn't, so skip).

### 5. Front-end swaps (same markup, new data calls)

- `components/RedirectView.vue`: replace the two Supabase queries with one `await $fetch('/api/resolve', { query: { path: short } })`; keep `useExternalRedirect` calls and the path-joining switch unchanged. Keep this SSR so the redirect stays a server 302.
- `pages/dashboard.vue`: `useUserSession()` instead of `useSupabaseUser()`; button → `navigateTo('/auth/github', { external: true })`.
- `components/ShortlinkList.vue`, `AddShortlink.vue`, `LinkItem.vue`: replace `useSupabaseClient` calls with `$fetch` to the `/api/links*` routes. Templates unchanged.
- `pages/gh/*`, `pages/blog/*`, `composables/useExternalRedirect.ts`: no change.

### 6. Infrastructure (`sst.config.ts`)

```ts
export default $config({
  app: () => ({
    name: "yumi-to",
    home: "aws",
    providers: { aws: { region: "us-east-1" } },
    removal: "retain",
  }),
  async run() {
    const table = new sst.aws.Dynamo("Shortlinks", {
      fields: { pk: "string", sk: "string" },
      primaryIndex: { hashKey: "pk", rangeKey: "sk" },
      transform: { table: { pointInTimeRecovery: { enabled: true } } },
    });
    const secrets = [
      "GithubClientId",
      "GithubClientSecret",
      "SessionPassword",
      "ApiKeyHash",
      "AdminGithubId",
    ].map((n) => new sst.Secret(n));
    new sst.aws.Nuxt("Web", {
      link: [table, ...secrets],
      domain: { name: "l.ajm.codes", dns: sst.aws.dns({ override: true }) },
      environment: { BASE_URL: "https://l.ajm.codes" },
    });
  },
});
```

- Map linked secrets to the env names `nuxt-auth-utils` reads (`NUXT_OAUTH_GITHUB_CLIENT_ID`, `NUXT_OAUTH_GITHUB_CLIENT_SECRET`, `NUXT_SESSION_PASSWORD`) via `environment:` using `secret.value`.
- First deploy uses a **staging domain** (`l-next.ajm.codes`) so production DNS is untouched. `override: true` is only set for the real cutover in step 9.

### 7. Link import script

- `scripts/import-links.py` — `uv run` script with PEP 723 header (`boto3`). Reads the step-1 JSON, writes items `{pk:"LINK", sk:short, id, short, link, created_at}` with `BatchWriteItem` (25/batch, retries unprocessed). Idempotent (plain puts), so it can run again at cutover.
- Prints: rows read, rows written, and any duplicate/empty `short` values it skipped.

### 8. CI (replace `.github/workflows/deploy.yml`)

- The current workflow deploys to Deno Deploy project `ajm-url`, which is not what serves the site. Replace it (user approval of this change is part of approving this plan):
  - `pull_request`: `npm ci && npx nuxt build` (build check only).
  - `push` to `main`: configure AWS creds via `aws-actions/configure-aws-credentials` with OIDC role `AWS_DEPLOY_ROLE_ARN`, then `npx sst deploy --stage production`.
- IAM: GitHub OIDC provider + role trusted for `repo:ajmarkow/yumi.to:ref:refs/heads/main`, with the permissions SST needs (start with the SST-documented policy).

### 9. Cutover

1. Deploy to staging (`l-next.ajm.codes`); run the verification below against it.
2. Tell AJ to pause creating/editing links (freeze).
3. Re-export from Supabase (step 1), re-run `import-links.py`, re-verify counts.
4. Update the GitHub OAuth App callback to `https://l.ajm.codes/auth/github`.
5. Switch the domain in `sst.config.ts` to `l.ajm.codes` with `override: true`; deploy. SST replaces the `l.ajm.codes` CNAME (`cname.vercel-dns.com`, TTL 60) with an alias to CloudFront.
6. Run verification against `l.ajm.codes`.
7. Remove `l.ajm.codes` from the Vercel project's domains (keep the project for rollback).

### 10. Decommission (after 30 days clean)

- Delete Vercel project, pause then delete the Supabase project (keep the export files), delete the old Supabase GitHub OAuth app, remove `l-next.ajm.codes`.
- Update README (AWS/SST deploy instructions instead of Vercel/Supabase).
- Todoist task → Testing during verification → Done with summary and PR link.

### Rollback

Until step 10, rollback = put the `l.ajm.codes` CNAME back to `cname.vercel-dns.com` and re-add the domain in Vercel. Supabase is untouched until then. Any links made on AWS after cutover can be exported from DynamoDB and inserted into Supabase.

## AWS CLI commands this plan needs (confirm before running)

Most AWS work is done by `sst deploy`. Direct `aws` calls, each run only after your OK:

1. `aws sts get-caller-identity` — confirm the account.
2. `aws route53 list-hosted-zones-by-name --dns-name ajm.codes` — confirm the zone ID.
3. `aws route53 list-resource-record-sets --hosted-zone-id <id> --query "ResourceRecordSets[?Name=='l.ajm.codes.']"` — snapshot the current record before cutover.
4. `aws iam create-open-id-connect-provider ...` + `aws iam create-role ...` / `put-role-policy` — GitHub OIDC deploy role (or define these in a small separate SST stage; either is fine).
5. `aws dynamodb describe-table` / `scan --select COUNT` — verify import count.

`sst secret set <Name> <value> --stage <stage>` for each secret (writes to SSM; values typed by you, not echoed into logs).

## Verification

- **Link parity test** (`scripts/verify-links.sh`): for every `short` in the Supabase export, `curl -s -o /dev/null -w '%{http_code} %{redirect_url}'` against the old host and the new host, and diff. Expect zero differences. Run against staging, then again against `l.ajm.codes` after cutover.
- Edge cases by hand: unknown short → 302 `https://l.ajm.codes/`; a prefix that matches one row → that link; a prefix matching 2+ rows → default; `/gh/nix-server` → GitHub; a `/blog/<x>` key from `dictionary.json`; `/robots.txt` disallows all.
- `POST /api/new` with the real key → new link resolves; with a wrong key → error JSON; iOS Shortcut run end-to-end.
- Dashboard: log in as AJ (works), log in as another GitHub account (403), create / edit (including renaming a short) / delete / search.
- Counts: DynamoDB item count = Supabase row count.
- Response headers show CloudFront (`x-cache`, `via`), not `server: Vercel`.
- `sst diff` clean after deploy; GitHub Actions deploy run green.
