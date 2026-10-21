# Sebuh.net

A lightweight supporter site for Sebuh Honarchian’s independent Tezos development.
Original static HTML/CSS/JavaScript implementation; no portal code or assets were
imported. The public site has no connection to the private baker control plane.

## Reward policy

- Ordinary delegators receive **no delegation reward payouts**. Retained baking
  income supports development; this is not a yield service.
- Direct stakers receive protocol-distributed staking rewards under the actual
  on-chain staking parameters, including the baker’s commission. Website copy
  does not set or modify that commission and makes no zero-fee promise.
- Ordinary delegation does not transfer ownership of funds. Direct staking has
  different slashing and withdrawal rules, explained separately on the page.
- The baker is restarting. No live uptime, baking-rights, APY or reward claims
  are made. Update the status copy deliberately when the underlying facts change.

The delegate address is public. No credentials, hardware references, keys, private
RPC addresses or management controls belong in this repository or Worker.

## Development

Node22.17 or newer is required for the pinned Wrangler CLI. The site itself has
no JavaScript framework, remote fonts, runtime packages or third-party scripts.

```sh
npm ci --ignore-scripts
npm test
npm run check:deploy
npm run dev
```

`npm run dev` binds to `127.0.0.1:8790`. `check:deploy` is a Wrangler dry run:
it validates the deployment configuration without uploading a version.

Static assets are in `site/`. Serve ONLY this directory, never the repository
root with its Git metadata, test files and development dependencies.

## Cloudflare Workers Builds

This is **Workers Static Assets**, not a Pages project. The existing Worker is
`sebuh-net`; its main provider URL is `sebuh-net.sebuh.workers.dev`.
The custom domain `sebuh.net` is managed in the Cloudflare dashboard. This
repository deliberately contains no DNS records, zone routes or account IDs.

Suggested connected-GitLab settings:

- Repository: `sebuh/sebuh.net`
- Root directory: repository root
- Production branch: `main` (verify in the dashboard before merging)
- Build command: `npm test`
- Production deploy command: `npx wrangler deploy`
- Non-production deploy command, if preview builds are enabled:
  `npx wrangler versions upload`

The exact build/deploy setting names and preview behavior should be checked
against the connected Worker’s current Cloudflare dashboard. Wrangler is pinned
in package-lock.json; dependencies must be installed before the commands run.
`wrangler.json` names the existing Worker and serves `./site`, with preview URLs
enabled. It has NO Worker entrypoint: static requests do not need custom code.
The `_headers` file sets a restrictive CSP and denies framing and hardware APIs.

Cloudflare generates concrete version/branch preview URLs. The displayed
`*-sebuh-net.sebuh.workers.dev` is a pattern, not a literal URL. Do not guess a
preview URL or claim deployment succeeded until reading the actual deployment
output and fetching that exact URL.

Do not add Cloudflare API tokens to Git. Use Cloudflare’s connected-repository
integration. A production-branch push may automatically replace the live custom
site; review a feature-branch preview before merging. Never change production
DNS or make an unrequested paid-plan upgrade as part of a website build.

## Verification

- `npm test`: deployment boundary, reward disclosure, address, local assets,
  accessibility hooks and absence of public operational endpoints.
- `npm run check:deploy`: real Wrangler static-assets dry run.
- Browser checks: desktop and mobile rendering, anchor links, FAQ controls,
  clipboard success and selected-text fallback when clipboard access is denied.
- Security and API/data logic are intentionally small: no wallet connection,
  signing requests, statistics API, cookies, trackers or stored wallet data.

A local test or dry run is not proof of a remote deployment. Keep GitLab commit,
Cloudflare build and actual served production content as separate checks.
