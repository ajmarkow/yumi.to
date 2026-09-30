# Cutover: l.ajm.codes from Vercel to AWS

## Context

Staging (`l-next.ajm.codes`) is live on AWS and verified. The parity test gives 57/57 against Vercel, and AJ has tested dashboard login and the iOS Shortcut. This plan moves the real domain.

Chosen approach: **simplest, with 5–15 min of downtime.** Route 53 does not allow an A/alias record next to the existing CNAME. So the CNAME is deleted first, then CI deploys the new domain (new ACM cert + CloudFront update + alias records). Links are down during that window.

Current state:

- `l.ajm.codes` is a CNAME to `cname.vercel-dns.com`, TTL 60. Snapshot: `yumi.to-migration-data/route53-l.ajm.codes-before.json`.
- Zone `Z098186129R7PSNUH0GK`. CloudFront `E3KW9KEFAGHBRV`. Table `yumi-to-production-ShortlinksTable-bcxhevvv`.
- DynamoDB has 51 links. The Supabase backup has 52. Only `mc → http://192.168.0.217` is missing, probably deleted during testing.
- Todoist: task `6hffcgjw4rhGF7v8` (parent) and the cutover subtask.

## Decisions

- `mc → http://192.168.0.217`: **keep** (AJ, 2026-09-30). The re-import in step 3 restores it.
- No Vercel URL is needed. Post-cutover verification checks each link against its stored destination.

## Preparation (any time before T-0)

1. **Cutover PR (opened, not merged).** Branch `feat/cutover`, one change in `sst.config.ts`:
   - `const domainName = "l.ajm.codes";`
   - `dns: sst.aws.dns({ override: true })`
   - Update the comment. `BASE_URL` and the OAuth redirect URL follow `domainName` on their own.
   - The CI build check must pass.
2. **Update reconcile tooling.** Add `--prune` to `scripts/import-links.py`: delete DynamoDB items whose `short` is not in the export. It prints what it would delete and asks for confirmation. Without it, only the known diff (`mc`) matters, so this step is optional.

## Cutover run (T-0)

| Step | Who                       | Action                                                                                                                                                                                                                                                                 |
| ---- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | AJ                        | Freeze: no link creates or edits in the Vercel dashboard or the Shortcut until step 9.                                                                                                                                                                                 |
| 2    | Claude                    | Fresh Supabase export → `shortlinks-<date>-final.json`. Diff it against DynamoDB and show the result.                                                                                                                                                                  |
| 3    | Claude                    | `uv run scripts/import-links.py …-final.json`. It is idempotent. Check that `mc` is back and that the count equals the final export.                                                                                                                                   |
| 4    | Claude                    | Final parity check: Vercel vs `l-next.ajm.codes`, expecting 0 mismatches. **Go/no-go.**                                                                                                                                                                                |
| 5    | Claude (approved aws cmd) | Delete the CNAME. **Downtime starts.** Save `/tmp/del-cname.json` first:<br>`aws route53 change-resource-record-sets --hosted-zone-id Z098186129R7PSNUH0GK --change-batch file:///tmp/del-cname.json`<br>(DELETE `l.ajm.codes.` CNAME TTL 60 `cname.vercel-dns.com`)   |
| 6    | Claude                    | Merge the cutover PR. Watch the CI deploy with `gh run watch`.                                                                                                                                                                                                         |
| 7    | AJ                        | GitHub OAuth App callback → `https://l.ajm.codes/auth/github`. Set the Shortcut domain back to `l.ajm.codes`.                                                                                                                                                          |
| 8    | Claude                    | Check: `dig l.ajm.codes` shows alias A/AAAA to CloudFront, and HTTPS works (cert is valid). **Downtime ends.**                                                                                                                                                         |
| 9    | Claude                    | Destination check: for every row in the final export, `curl` `https://l.ajm.codes/<short>` and confirm a 302 whose Location is the stored `link` (trailing-slash normalized). Plus the edge cases from the step-4 run and robots.txt `Disallow: /`. Expect 0 failures. |
| 10   | AJ                        | Smoke test: dashboard login, one create/edit/delete, one Shortcut run. Unfreeze.                                                                                                                                                                                       |

`l-next.ajm.codes` stops working after step 6. That is expected: its records and alias are removed.

## Rollback

Two triggers: the CI deploy in step 6 fails, or parity fails in step 9. Either way, restore the CNAME. That one approved command ends the downtime right away:

```
aws route53 change-resource-record-sets --hosted-zone-id Z098186129R7PSNUH0GK \
  --change-batch '{"Changes":[{"Action":"UPSERT","ResourceRecordSet":{"Name":"l.ajm.codes.","Type":"CNAME","TTL":60,"ResourceRecords":[{"Value":"cname.vercel-dns.com"}]}}]}'
```

If SST already created A/AAAA records, delete them in the same batch first. Then revert the cutover PR. Vercel keeps `l.ajm.codes` attached until decommission, so it serves again as soon as DNS resolves.

## Aftercare

- Day 0: move the Todoist task to Testing. Watch Lambda errors in CloudWatch for a few days.
- Day 30, if clean: remove the domain from Vercel, delete the Vercel project, pause and then delete the Supabase project (keep the exports), and delete the old Supabase GitHub OAuth app. Then mark the task Done.
- Separately: `ajm.codes/blog/dictionary.json` returns 404, so `/blog/*` links go to the default page on both hosts.

## Verification summary

- Link count in DynamoDB = final Supabase export, including `mc`.
- Every short on l.ajm.codes redirects to its stored link (0 failures).
- `curl -sI https://l.ajm.codes/verge` shows CloudFront headers and a 302 to `https://theverge.com/`.
- Login and the Shortcut work on `l.ajm.codes`.
