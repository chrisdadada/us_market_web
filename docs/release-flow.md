# Release Flow

## Environments

- Test: `https://dev.dongbimao.org`
- Production: `https://www.dongbimao.org`

Dev and production frontend files are separated:

- Test root: `/var/www/dongbimao-dev`
- Production root: `/var/www/dongbimao-prod`

## Branches

- `master` is the stable production baseline.
- New work starts from a `codex/...` branch.
- Deploy code only after `npm run check` passes and the branch has a commit.
- Deploy to dev first. Merge back to `master` only after dev is confirmed.
- Deploy production code from `master` only after the user explicitly asks for that prod deploy.
- Tag important production releases as `prod-YYYY-MM-DD-short-name`.

## Deploy To Test

Code deploy does not rebuild `data/product.db` by default. Data refresh is owned
by the automated refresh jobs.

```bash
./scripts/deploy_dev.sh
```

Check `https://dev.dongbimao.org` first.

To force a product DB rebuild during a manual deploy:

```bash
BUILD_PRODUCT_DB=1 ./scripts/deploy_dev.sh
```

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

Production promotion is blocked unless explicitly enabled in the manual command
for that run:

```bash
MANUAL_PROD_APPROVAL=1 ALLOW_PROD_PROMOTE=1 PROMOTE_PROD_AFTER_DEPLOY=1 ./scripts/automated_refresh.sh
```

Do not put prod promotion approval in `~/.dongbimao/refresh.env`. Scheduled
refresh jobs may deploy dev, but production data and production site promotion
still require the user to manually request that specific production update.

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

## Promote To Production

Manual promotion is still available when a build has already been checked on
the test domain:

```bash
./scripts/promote_prod.sh
```

## HTTPS

After the domain `clientHold` status is removed and public DNS resolves normally, issue certificates for:

- `https://dev.dongbimao.org`
- `https://www.dongbimao.org`
- `https://admin.dongbimao.org`
