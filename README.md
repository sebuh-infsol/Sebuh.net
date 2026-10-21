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

### Public restart-funding progress

The masthead's full-width progress bar reads the fixed baker address through
`https://rpc.tzkt.io/mainnet`, independently of the wallet connector. It validates
mainnet, a fresh pinned block and integer-mutez spendable/own-staked values. The
numerator is spendable balance plus own stake only: external delegated/staked
funds and pending exchange withdrawals are excluded. It is NOT donations raised.
The 3800 XTZ goal is the earlier restart-plan own-funds target, configured in
`src/restart-progress.mjs`; it is not the 600 XTZ own-stake minimum or the 6000 XTZ
baking-power requirement. Reaching it does not automatically stake, activate or
qualify the baker. Check actual protocol eligibility separately.

Data loads without wallet pairing, with paced GETs and bounded read-only
rate-limit retries, once on page load or an explicit
manual refresh. There is no interval or tab-visibility polling. Unknown/error values
are never presented as zero. Failed/stale updates hide the bar and explicitly
label any retained last-verified figures. No private node endpoint, signer,
API credential or SDK operation request is used. This intentional public-RPC
request occurs on page load; it is disclosed in the widget's privacy caption.

### Visual design and typography

The current local redesign adapts the owner's Claude Design broadsheet export:
large masthead, CMYK process-plate headlines, code table and governance section.
Existing wallet controls, delegation guards and donation disclosures are retained;
export placeholders and stale claims that no wallet connection exists are removed.
Connect sits at the top-right, replacing the old navigation row and strapline.
After explicit connection, its header details show the visitor address as the
first six and last six characters, with the full address available accessibly,
and exact spendable XTZ balance (not stake or frozen funds). Unavailable, stale,
uncertain or post-submission balances are not advertised as current available
funds. There is no automatic interval or tab-return balance polling. Read the
connected account on explicit Connect or Refresh account; label retained old
amounts Last checked rather than hiding them or implying current availability.
Funding reads once per page load or explicit Refresh balance. Fresh checks before
an explicitly requested transaction remain mandatory. No wallet operation is
polled or retried.
Delegate / Stake / Donate remain directly after the hero. Staking is
explicitly unavailable in the connector, not a working form.

The hero Tezos mark is a tightly bounded, self-hosted SVG of the same Noto Sans
U+A729 glyph previously selected by the browser, with all three CMYK layers.
This avoids font-leading/descender overflow and platform-dependent glyph fallback.
On desktop, CSS subgrid puts its invisible containment area in the same row as
the entire left headline; object-fit preserves the full artwork inside that band,
without clipping, borders, outlines or layout JavaScript. Smaller screens retain
a stacked, contained mark. The source-font hash, outline provenance and SIL OFL
license are in `site/images/`. There is no new runtime dependency or remote asset.

Source Serif 4 is self-hosted in `site/fonts/`, with roman and italic variable
WOFF2 files from `@fontsource-variable/source-serif-4@5.3.1`. The package tarball's
SHA-512 integrity was verified before extraction. `PROVENANCE.json` records source
paths and per-file SHA-256 values; `OFL.txt` preserves the font license. No remote
font stylesheet, font service, install hook or new runtime dependency is used.

The donation buttons offer 10, 100 or 1000 XTZ, with an editable amount for other
gifts. A suggestion prefills the amount and opens Connect only if disconnected;
it never automatically reviews or sends. Visitors separately acknowledge the
permanent gift, review the fixed mainnet recipient and amount, then explicitly
open their wallet for final approval. Amounts use exact BigInt mutez conversion
(up to six XTZ decimal places), not floating-point arithmetic. A new pinned
mainnet account read and final synchronous freshness/account/review checks occur
before requesting exactly one fixed-recipient transfer. Only spendable balance
counts; staked/frozen funds are never withdrawn. Network fees are additional,
estimated by the wallet, and not promised by this page. Delegation and donation
share one pending/uncertain/submitted-operation lock. There are no automatic
wallet-request retries. Recipient copying/manual Send remains available.
Donations transfer ownership, with no repayment/reward entitlement or automatic
staking, activation or baking-rights guarantee. No real donation is signed as a
development test.

Node22.17 or newer is required for the pinned Wrangler CLI. The site uses static HTML/CSS and a small client-side wallet module, with no
runtime server, remote fonts or remote JavaScript. The optional connector uses
pinned Octez Connect5.0.3 (modern @tezos-x namespace) and operation-request-only
permissions. It is lazy-loaded after Connect. WalletConnect and SDK metrics are
disabled. This is not an extension-only picker: extension and Matrix-supported
wallets can pair. Only ordinary delegation and explicitly reviewed one-time
fixed-recipient donation transfers are supported; no raw signing or staking.

Version5.0.4 was inspected but introduced older WalletConnect dependencies with
known low/moderate advisories. Version5.0.3 was separately inspected and tested;
the resulting dependency tree had zero npm-audit findings at implementation
time. Do not blindly override crypto/decoder dependencies or treat an audit
result as a permanent security guarantee.

```sh
npm ci --ignore-scripts
npm run build
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
- Preview command for the configured Worker Previews build:
  `npx wrangler preview`

Worker Previews requires an explicit `"previews": {}` block in `wrangler.json`.
`preview_urls: true` alone only enables version URLs and does not satisfy the
new Preview command. This site has no preview-specific bindings or secrets,
so the block is deliberately empty. Assets remain top-level.
`npx wrangler versions upload` is a separate version-URL workflow, not the
command used by this project's connected preview build.

The exact build/deploy setting names and preview behavior should be checked
against the connected Worker’s current Cloudflare dashboard. Wrangler is pinned
in package-lock.json; dependencies must be installed before the commands run.
`wrangler.json` names the existing Worker and serves `./site`, with preview URLs
enabled. It has NO Worker entrypoint: static requests do not need custom code.
The `_headers` file denies framing, browser hardware APIs, worker creation and
script evaluation. The connector needs inline styles for its shadow-DOM picker;
only style policy is relaxed. `connect-src` permits only the verified public
mainnet RPC and eight bundled Matrix relay origins. Remote wallet-list JSON
updates are intentionally blocked: the SDK uses its bundled fallback catalogue
and may issue an expected CSP warning. No telemetry, WalletConnect relay,
external script or private node origin is permitted.

`npm run build` uses esbuild to produce the small UI module and lazy SDK chunks.
Generated assets are ignored by Git and built before deployment through
Wrangler's top-level `build.command`; production and preview builds therefore
have the same prerequisite. CI installs with scripts disabled, bundles, and
runs the tests. esbuild's lexical Buffer shim supplies the browser API expected
by SDK modules without an inline script or unsafe-eval. Legal comments are
preserved alongside the generated chunks.

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
- The optional connector signs nothing locally. Connect and Review never send
  operations. Request wallet approval performs new mainnet/account/stake checks
  and asks the visitor's wallet for exactly one fixed-target delegation or an
  explicitly reviewed donation transfer. Only donations transfer XTZ ownership
  to the baker. For delegation, existing staked or frozen unstaking funds and
  existing delegation to this baker block requests. For both operations, wrong
  accounts/networks, missing/broader permissions and stale/unavailable RPC data
  block submission. Read-only RPC
  requests are paced with bounded429 retries; wallet requests are never retried.
- Returned hashes are labeled submitted/unverified, not successful on-chain
  operations. Ambiguous wallet outcomes block further requests until the visitor
  checks their wallet/explorer and deliberately reconnects.
- Connection data and pairing keys live in the visitor's browser, managed by
  Octez Connect. Public RPC/Matrix services may see network metadata. The Worker
  has no account database, signer, secrets, payout process or private RPC access.
- Wallet-prompt cancellation was exercised by the agent with the real SDK;
  transaction paths use non-signing test doubles. The owner also reported a
  successful spare-wallet connection, account-state display and correct blocking
  of an already-delegated account. That is owner-reported pairing evidence, not
  a newly signed delegation test. No mainnet transaction was signed by the agent.
  Remaining wallet acceptance checks and fresh production-release approval are
  required before promotion.

A local test or dry run is not proof of a remote deployment. Keep GitLab commit,
Cloudflare build and actual served production content as separate checks.
