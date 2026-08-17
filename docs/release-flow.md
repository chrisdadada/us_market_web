# Release Flow

## Environments

- Test: `https://dev.dongbimao.org`
- Production: `https://www.dongbimao.org`

Dev and production frontend files are separated:

- Test root: `/var/www/dongbimao-dev`
- Production root: `/var/www/dongbimao-prod`

## Branches

- `master` is the stable production baseline.
- `codex/dev-integration` is the only branch allowed to publish dev code.
- New work starts from a `codex/...` branch.
- Merge confirmed dev work into `codex/dev-integration`, run `npm run check`, commit, then deploy dev from that clean branch.
- Merge the confirmed dev release back to `master` only after dev is accepted.
- Deploy production code from `master` only after the user explicitly asks for that prod deploy.
- Tag important production releases as `prod-YYYY-MM-DD-short-name`.

## Deploy To Test

Use the single dev release entry point. It runs project checks and the complete
release gate once, then reuses that exact result during deployment:

```bash
git switch codex/dev-integration
./scripts/release_dev.sh
```

Code releases reuse the current `data/product.db` test snapshot and do not
rebuild or deploy product data. When the release includes product-data changes,
build, enrich, verify, and deploy one DB snapshot with:

```bash
INCLUDE_PRODUCT_DATA=1 ./scripts/release_dev.sh
```

The release script rejects other branches and uncommitted changes. It also reads
the commit recorded by the current dev site and requires that commit to be an
ancestor of the new release. A partial or older branch therefore cannot replace
the cumulative dev baseline. The deployed commit is available at
`https://dev.dongbimao.org/release.json` for verification.

Check `https://dev.dongbimao.org` first.

## Automated Refresh Deploy

The market data refresh now deploys automatically after product DB validation
and release gate tests pass:

```bash
./scripts/automated_refresh.sh
```

By default it deploys only the rebuilt `data/product.db` to
`https://dev.dongbimao.org`. Automated data refreshes never publish frontend or
backend code. The dev data step preserves the current content and Open holding
runtime tables. Production data remains blocked without explicit approval for
the current run. For a dry refresh that stops before deploy:

```bash
DEPLOY_AFTER_REFRESH=0 ./scripts/automated_refresh.sh
```

To deploy dev but skip the production product DB update:

```bash
DEPLOY_PROD_DATA_AFTER_REFRESH=0 ./scripts/automated_refresh.sh
```

Scheduled refresh jobs may deploy dev and the separately authorized DB-only
product data release. They cannot promote production code. Production code
always uses the manual, commit-bound release flow below.

Options flow refresh is part of this automation by default. It uses Polygon REST
options aggregates, so it intentionally advances slowly to avoid rate limits:

```bash
RUN_OPTIONS_FLOW=1 OPTIONS_MAX_DAYS=1 ./scripts/automated_refresh.sh
```

Useful overrides:

```bash
RUN_OPTIONS_FLOW=0 ./scripts/automated_refresh.sh
OPTIONS_START_DATE=2026-05-18 OPTIONS_END_DATE=2026-05-26 OPTIONS_MAX_DAYS=5 ./scripts/automated_refresh.sh
```

The options step imports aggregates into `data/product.db` and the release gate
checks that the page shell and product API payload are present before deployment.

## Prepare Production Release

After dev is confirmed and the code is committed, build and verify one immutable
release artifact:

```bash
RELEASE_TEST_PRODUCT_DB=/path/to/read-only-product.db ./scripts/prepare_prod_release.sh
```

The artifact is stored under `.release-artifacts/` and is bound to the exact Git
commit. Re-running this command for the same verified commit reuses the artifact.
The snapshot is used only by the release gate and is never packaged or deployed.

## Promote To Production

After the user explicitly approves that exact commit, promote the already
verified artifact. This step does not rebuild or rerun the full test suite:

```bash
COMMIT="$(git rev-parse HEAD)"
MANUAL_PROD_APPROVAL=1 \
ALLOW_PROD_CODE_DEPLOY=1 \
PROD_APPROVED_COMMIT="$COMMIT" \
./scripts/promote_prod.sh
```

The remote step verifies the artifact checksum, skips unchanged components,
checks product DB fingerprints, switches directories atomically, checks public
health endpoints, and automatically restores the previous code if a check
fails. The three most recent code artifacts are retained on the production
server. On the first run, the currently deployed production code is archived
before any switch, so it is immediately available as the first rollback target.

## Roll Back Production

Rollback also requires explicit approval for the exact retained commit:

```bash
TARGET="<full-40-character-commit>"
MANUAL_PROD_APPROVAL=1 \
ALLOW_PROD_CODE_ROLLBACK=1 \
PROD_APPROVED_COMMIT="$TARGET" \
./scripts/rollback_prod.sh "$TARGET"
```

## HTTPS

After the domain `clientHold` status is removed and public DNS resolves normally, issue certificates for:

- `https://dev.dongbimao.org`
- `https://www.dongbimao.org`
- `https://admin.dongbimao.org`

## Production Log Retention

Production system log limits are tracked in:

- `ops/systemd/99-dongbimao-journal-limits.conf`
- `ops/logrotate/dongbimao-system-logs`

They cap persistent journal usage at 512 MB and rotate compressed
`messages/secure/cron` logs daily, retaining seven rotations.
