import { createDonationsController } from './donations-controller.mjs';
import { DONATIONS_CONFIG } from './donations-config.mjs';

// Browser UI for the contract donation app. It renders the live contract state
// (read by Taquito) and drives the review -> wallet-approve flow (the op is
// signed and injected by octez.connect via the connected wallet). This is a
// self-contained, self-initializing module: the page loads it as
// <script type="module" src="./donations-ui.js"> and it wires up the
// #donations-app section on its own.
const $ = (id) => document.getElementById(id);
const config = DONATIONS_CONFIG;
let controller = null;
let loading = false;

const status = $('donations-status');
const total = $('donations-total');
const count = $('donations-count');
const list = $('donations-list');
const account = $('donations-account');
const connect = $('donations-connect');
const disconnect = $('donations-disconnect');
const refresh = $('donations-refresh');
const memo = $('donations-memo');
const amount = $('donations-amount');
const consent = $('donations-consent');
const review = $('donations-review');
const summary = $('donations-summary');
const confirm = $('donations-confirm');
const cancel = $('donations-cancel');
const operation = $('donations-operation');
const presets = [...document.querySelectorAll('.donations-preset')];

const fmt = (mutez) => {
  const n = Number(mutez) / config.mutezPerTez;
  const whole = Math.trunc(n);
  const frac = (n - whole).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return whole.toString() + (frac ? '.' + frac : '');
};
const short = (a) => (typeof a === 'string' && a.length > 14 ? a.slice(0, 6) + '…' + a.slice(-4) : a || '');

function render(model = { account: null, state: null, review: null, busy: false, error: null, hash: null, uncertain: false }) {
  const busy = model.busy || loading;
  const blocked = busy || Boolean(model.hash) || model.uncertain;
  connect.disabled = busy || Boolean(model.account);
  connect.textContent = busy && !model.account ? 'Waiting for wallet…' : (model.account ? 'Connected' : 'Connect wallet');
  disconnect.hidden = !model.account; disconnect.disabled = blocked;
  refresh.hidden = !model.account; refresh.disabled = blocked;
  memo.disabled = blocked; amount.disabled = blocked;
  consent.disabled = busy || !model.account;
  account.textContent = model.account?.address || 'Not connected';

  if (model.state) {
    total.textContent = fmt(model.state.totalDonatedMutez) + ' ꜩ';
    count.textContent = String(model.state.nextDonationId);
    list.innerHTML = '';
    if (model.state.donations.length === 0) {
      const li = document.createElement('li');
      li.className = 'donation-row';
      li.textContent = 'No donations yet — be the first!';
      list.appendChild(li);
    }
    for (const d of model.state.donations.slice().reverse()) {
      const li = document.createElement('li');
      li.className = 'donation-row';
      const when = d.timestamp ? new Date(d.timestamp).toLocaleString() : (d.level ? 'level ' + d.level : '');
      li.textContent = '#' + d.id + ' · ' + short(d.sender) + ' · ' + fmt(d.amountMutez) + ' ꜩ' + (d.memoText ? ' · "' + d.memoText + '"' : '') + (when ? ' · ' + when : '');
      list.appendChild(li);
    }
  } else {
    total.textContent = 'Not loaded';
    count.textContent = '—';
    if (list.firstChild) list.textContent = '';
  }

  review.disabled = !model.account || !model.state || !consent.checked || !amount.value || blocked;
  summary.hidden = !model.review;
  confirm.disabled = !model.review || !consent.checked || blocked;
  cancel.disabled = busy;
  for (const preset of presets) {
    preset.disabled = blocked;
    preset.setAttribute('aria-pressed', String(amount.value === preset.dataset.donationsAmount));
  }
  if (model.review) {
    $('donations-review-source').textContent = model.review.source;
    $('donations-review-target').textContent = model.review.destination;
    $('donations-review-amount').textContent = model.review.amountXTZ + ' ꜩ';
    $('donations-review-memo').textContent = model.review.memo;
  }
  operation.hidden = !model.hash;
  if (model.hash) { operation.href = 'https://tzkt.io/' + model.hash; operation.textContent = 'View the submitted operation on TzKT'; }

  let reason;
  if (model.account) reason = model.state ? 'Set an amount and an optional memo, acknowledge the gift and review. Nothing is sent until you approve it in your wallet.' : 'Reading the donations contract…';
  else reason = 'Connect a ' + config.network + ' wallet to see live donations and give. Connecting only pairs your wallet — it does not send anything.';
  if (model.hash) reason = 'The wallet returned an operation hash. Inclusion/success is not yet verified by this page — check your wallet or explorer.';
  else if (model.uncertain) reason = 'Check your wallet and explorer before reconnecting. The previous request may have been submitted. No automatic retry.';
  status.textContent = model.error || (busy ? 'Working… signing happens only if you approve in your wallet.' : reason);
}

async function act(fn) {
  try { await fn(); }
  catch (e) { status.textContent = e?.message || 'Wallet action failed. Check your wallet before retrying.'; }
}

async function connectWallet() {
  if (loading || controller?.model.busy || controller?.model.account) return;
  loading = true; render(controller?.model);
  try {
    if (!controller) {
      const { makeDonationClient } = await import('./octez-client.mjs');
      controller = createDonationsController({ client: makeDonationClient(DONATIONS_CONFIG), onChange: render });
    }
    consent.checked = false;
    await controller.connect();
  } catch (e) {
    controller = null;
    throw e;
  } finally {
    loading = false; render(controller?.model);
  }
}

document.addEventListener?.('visibilitychange', () => render(controller?.model));

connect.addEventListener('click', () => act(connectWallet));
disconnect.addEventListener('click', () => act(async () => { await controller.disconnect(); consent.checked = false; render(controller.model); }));
refresh.addEventListener('click', () => act(async () => { consent.checked = false; await controller.refresh(); }));
consent.addEventListener('change', () => { controller?.cancelReview(); render(controller?.model); });
memo.addEventListener('input', () => { controller?.cancelReview(); render(controller?.model); });
amount.addEventListener('input', () => { controller?.cancelReview(); render(controller?.model); });
for (const preset of presets) preset.addEventListener('click', () => act(async () => {
  if (preset.disabled) return;
  amount.value = preset.dataset.donationsAmount;
  consent.checked = false;
  controller?.cancelReview();
  render(controller?.model);
  if (!controller?.model.account) await connectWallet();
  amount.focus();
}));
review.addEventListener('click', () => act(() => controller.review(memo.value.trim(), amount.value, consent.checked)));
confirm.addEventListener('click', () => act(() => controller.submit(consent.checked)));
cancel.addEventListener('click', () => controller.cancelReview());
render();
