import { DONATIONS_NETWORKS, DEFAULT_DONATIONS_NETWORK } from './donations-config.mjs';

// Lightweight boot for the donations section. This file deliberately imports
// ONLY the plain network registry — never Taquito — so eagerly loading it
// costs almost nothing. The 180 KB Taquito app (./donations-ui.js) is fetched
// with a dynamic import() ONLY on the visitor's first explicit interaction
// with the section: a click on the "Load the live donations app" control or
// on "Connect wallet". Scrolling the section into view never loads it.
//
// The boot owns the always-visible network switch, the active-network badge
// and the section kicker/copy; the lazily loaded app owns everything else.
// CSP note: script-src is 'self' only — all handlers are bound here with
// addEventListener, no inline handlers and no eval.
const $ = (id) => document.getElementById(id);
const kicker = $('donations-kicker');
const copy = $('donations-copy');
const badge = $('donations-network-badge');
const fees = $('donations-fees');
const amountLabel = $('donations-amount-label');
const status = $('donations-status');
const loadBtn = $('donations-load');
const connect = $('donations-connect');
const switches = [...document.querySelectorAll('.donations-network-option')];

let selected = DEFAULT_DONATIONS_NETWORK;
let appPromise = null;
let app = null;

const deployed = (cfg) => typeof cfg.contractAddress === 'string' && cfg.contractAddress.length > 0;

function renderNetwork() {
  const cfg = DONATIONS_NETWORKS[selected];
  // Prominent honest badge: testnet tez are worthless, mainnet tez are real.
  badge.textContent = cfg.realValue ? 'MAINNET — real XTZ' : 'TESTNET — no real value';
  badge.dataset.network = cfg.network;
  kicker.textContent = 'Contract donations · Tezos ' + cfg.label;
  copy.textContent = deployed(cfg)
    ? 'Live totals and a per-donor ledger are read straight from the donations smart contract on ' + cfg.label + ' by Taquito. A give is a contract call your wallet signs — the contract, not a single address, holds the funds.'
    : 'The donations contract is not deployed on ' + cfg.label + ' yet — use the Donate panel above for direct mainnet gifts. The same UI goes live here once the contract has a mainnet address.';
  fees.textContent = cfg.realValue
    ? 'Mainnet ꜩ are real funds and a donation is a permanent gift. Network fees are extra and estimated by your wallet.'
    : 'Shadownet testnet ꜩ have no real-world value. Network fees are extra and estimated by your wallet.';
  amountLabel.textContent = 'Amount · ꜩ (' + cfg.label + ')';
  for (const option of switches) option.setAttribute('aria-pressed', String(option.dataset.network === selected));
  if (!app) {
    // Pre-load gating is the boot's job; once the app is initialized its own
    // render owns these controls (and keeps mainnet fail-closed itself).
    const ok = deployed(cfg);
    loadBtn.disabled = !ok;
    connect.disabled = !ok;
    status.textContent = ok
      ? 'Load the live donations app to read the ' + cfg.label + ' contract. Connecting only pairs your wallet — it does not send anything.'
      : cfg.label + ' contract not deployed yet — use the Donate panel above for direct mainnet gifts.';
  }
}

function loadApp() {
  // Single-load idempotence: every trigger funnels into one import promise.
  if (!appPromise) {
    appPromise = import('./donations-ui.js').then((mod) => {
      app = mod.initDonationsApp(selected);
      loadBtn.hidden = true;
      renderNetwork();
      return app;
    }).catch((e) => {
      appPromise = null;
      status.textContent = 'Could not load the donations app: ' + (e?.message || e) + '. Click again to retry.';
      throw e;
    });
  }
  return appPromise;
}

loadBtn.addEventListener('click', () => {
  if (loadBtn.disabled || !deployed(DONATIONS_NETWORKS[selected])) return;
  loadApp().catch(() => {});
});

connect.addEventListener('click', () => {
  // Only the FIRST connect click belongs to the boot: it loads the app and
  // forwards the intent. Afterwards the app's own listener handles connects.
  if (app || appPromise || connect.disabled || !deployed(DONATIONS_NETWORKS[selected])) return;
  loadApp().then((a) => a.connect()).catch(() => {});
});

for (const option of switches) option.addEventListener('click', () => {
  const key = option.dataset.network;
  if (!DONATIONS_NETWORKS[key] || key === selected) return;
  // The app (if loaded) hard-resets its state fail-closed, or REFUSES the
  // switch while a wallet request/operation is pending (it then explains why
  // in its own status). Commit the selection, aria-pressed and badge only
  // when the switch was explicitly accepted. Switching never imports.
  if (app && app.setNetwork(key) !== true) return;
  selected = key;
  renderNetwork();
});

renderNetwork();
