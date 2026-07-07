# Release Flow

## Environments

- Test: `https://dev.dongbimao.org`
- Production: `https://www.dongbimao.org`

Dev and production frontend files are separated:

- Test root: `/var/www/dongbimao-dev`
- Production root: `/var/www/dongbimao-prod`

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

The market data refresh now deploys automatically after product DB validation,
release gate tests, and package creation pass:

```bash
./scripts/automated_refresh.sh
```

By default it deploys to `https://dev.dongbimao.org` only. For a dry refresh
that stops before deploy:

```bash
DEPLOY_AFTER_REFRESH=0 ./scripts/automated_refresh.sh
```

Production promotion is blocked unless explicitly enabled:

```bash
ALLOW_PROD_PROMOTE=1 PROMOTE_PROD_AFTER_DEPLOY=1 ./scripts/automated_refresh.sh
```

For approved recurring data refresh jobs, set those two flags in
`~/.dongbimao/refresh.env` so the scheduled refresh can promote the validated
product DB without manual reruns.

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
