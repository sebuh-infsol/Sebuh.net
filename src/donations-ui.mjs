import { createDonationsController } from './donations-controller.mjs';
import { readSpendableBalance } from './donations-taquito.mjs';
import { DONATIONS_NETWORKS, DEFAULT_DONATIONS_NETWORK } from './donations-config.mjs';

// Browser UI for the contract donation app. It renders the live contract state
// (read by Taquito) and drives the review -> wallet-approve flow (the op is
// signed and injected by octez.connect via the connected wallet).
//
// This module is LAZY: index.html never loads it eagerly. donations-boot.js
// dynamically import()s it on the visitor's first explicit interaction with
// the donations section and calls initDonationsApp(networkKey) once. Network
// switches then go through the returned api.setNetwork(key), which hard-resets
// ALL app state — wallet session, pending review, consent — so nothing ever
// carries over from one network to another (fail closed). When the selected
// network has no deployed contract (contractAddress null, i.e. mainnet today)
// every control is disabled and the status says so honestly.
export function initDonationsApp(initialNetwork = DEFAULT_DONATIONS_NETWORK, onSession = () => {}) {
  const $ = (id) => document.getElementById(id);
  let config = DONATIONS_NETWORKS[initialNetwork] || DONATIONS_NETWORKS[DEFAULT_DONATIONS_NETWORK];
  let controller = null;
  let loading = false;
  // Network generation: bumped by every accepted setNetwork. Async work
  // captures it when it starts and may only touch controller/loading/status
  // while it still matches, so stale old-network results or errors can never
  // act on, or repaint, the newly selected network.
  let generation = 0;

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

  const signingAllowed = () => config.submissionPolicy === 'enabled' || (
    config.submissionPolicy === 'verified-testnet' && controller?.model.state?.network === config.network &&
    controller?.model.state?.chainId === config.chainId && controller?.model.state?.contractAddress === config.contractAddress &&
    typeof config.expectedRecipient === 'string' && controller?.model.state?.recipient === config.expectedRecipient);
  const deployed = () => typeof config.contractAddress === 'string' && config.contractAddress.length > 0;
  const fmt = (mutez) => {
    const n = Number(mutez) / config.mutezPerTez;
    const whole = Math.trunc(n);
    const frac = (n - whole).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    return whole.toString() + (frac ? '.' + frac : '');
  };
  const short = (a) => (typeof a === 'string' && a.length > 14 ? a.slice(0, 6) + '…' + a.slice(-4) : a || '');

  function render(model = { account: null, state: null, review: null, busy: false, error: null, hash: null, uncertain: false }) {
    onSession(model);
    if (!deployed()) {
      // Fail-closed state for a network without a deployed donations contract
      // (mainnet today): every connect/give/read control is disabled and the
      // copy is honest about why.
      connect.disabled = true;
      connect.textContent = 'Connect wallet';
      disconnect.hidden = true;
      refresh.hidden = true;
      memo.disabled = true;
      amount.disabled = true;
      consent.disabled = true;
      review.disabled = true;
      summary.hidden = true;
      confirm.disabled = true;
      cancel.disabled = true;
      for (const preset of presets) { preset.disabled = true; preset.setAttribute('aria-pressed', 'false'); }
      account.textContent = 'Not connected';
      total.textContent = 'Not deployed';
      count.textContent = '—';
      if (list.firstChild) list.textContent = '';
      operation.hidden = true;
      status.textContent = config.label + ' contract not deployed yet — use the Donate panel above for direct mainnet gifts.';
      return;
    }
    const busy = model.busy || loading;
    const pairingBlocked = busy || Boolean(model.hash) || model.uncertain;
    const blocked = pairingBlocked || !signingAllowed();
    connect.disabled = pairingBlocked || Boolean(model.account);
    connect.textContent = busy && !model.account ? 'Waiting for wallet…' : (model.account ? 'Connected' : 'Connect wallet');
    disconnect.hidden = !model.account; disconnect.disabled = pairingBlocked;
    refresh.hidden = !model.account; refresh.disabled = pairingBlocked;
    memo.disabled = blocked; amount.disabled = blocked;
    consent.disabled = blocked || !model.account;
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
      $('donations-review-target').textContent = model.review.destination + (config.submissionPolicy === 'verified-testnet' ? ' · beneficiary test5: ' + config.expectedRecipient : '');
      $('donations-review-amount').textContent = model.review.amountXTZ + ' ꜩ';
      $('donations-review-memo').textContent = model.review.memo;
    }
    operation.hidden = !model.hash;
    if (model.hash) { operation.href = config.explorerUrl + model.hash; operation.textContent = 'View the submitted operation on TzKT'; }

    let reason;
    if (model.account) reason = model.state ? 'Set an amount and an optional memo, acknowledge the gift and review. Nothing is sent until you approve it in your wallet.' : 'Reading the donations contract…';
    else reason = 'Connect a ' + config.network + ' wallet to see live donations and give. Connecting only pairs your wallet — it does not send anything.';
    if (model.hash) reason = 'The wallet returned an operation hash. Inclusion/success is not yet verified by this page — check your wallet or explorer.';
    else if (model.uncertain) reason = 'Check your wallet and explorer before reconnecting. The previous request may have been submitted. No automatic retry.';
    status.textContent = model.error || (!signingAllowed() ? config.submissionDisabledReason : busy ? 'Working… signing happens only if you approve in your wallet.' : reason);
  }

  async function act(fn) {
    const gen = generation;
    try { await fn(); }
    catch (e) {
      // A stale error from work started on another network must never
      // overwrite the current network's (honest) status.
      if (gen === generation) status.textContent = e?.message || 'Wallet action failed. Check your wallet before retrying.';
    }
  }

  async function connectWallet() {
    if (!deployed() || loading || controller?.model.busy || controller?.model.account || controller?.model.hash || controller?.model.uncertain) return;
    // Bind this attempt to the network it started on BEFORE any await.
    const gen = generation;
    const cfg = config;
    loading = true; render(controller?.model);
    try {
      let ctl = controller;
      if (!ctl) {
        const { makeDonationClient } = await import('./octez-client.mjs');
        // The network switched while the wallet chunk loaded: abandon this
        // attempt. No client is created and no wallet prompt is opened.
        if (gen !== generation || config !== cfg || !deployed()) return;
        // The onChange guards keep a discarded controller (after a network
        // switch) from repainting the UI with stale state.
        const created = createDonationsController({ client: makeDonationClient(cfg), config: cfg, loadBalance: (address) => readSpendableBalance(address, cfg), onChange: (m) => { if (controller === created && gen === generation) render(m); } });
        ctl = created;
        controller = ctl;
      }
      consent.checked = false;
      await ctl.connect();
    } catch (e) {
      if (gen !== generation) return; // stale: never touch the new network's state
      const failed = controller;
      if (failed) { try { await failed.disconnect(); } catch {} }
      if (gen !== generation) return;
      controller = null;
      throw e;
    } finally {
      if (gen === generation) { loading = false; render(controller?.model); }
    }
  }

  const SWITCH_REFUSED = 'Finish or cancel the pending wallet request before switching networks.';

  // Returns true when the switch is applied (or already current) and false
  // when it is refused; donations-boot.mjs commits its selection only on true.
  function setNetwork(key) {
    const next = DONATIONS_NETWORKS[key];
    if (!next) return false;
    if (next === config) return true;
    const model = controller?.model;
    if (model && (model.busy || model.hash || model.uncertain)) {
      // Fail closed: a wallet request is open, or an operation was submitted
      // or has an unknown outcome. Switching would drop its hash/uncertain
      // status (inviting a duplicate gift) and a busy controller cannot even
      // disconnect. Keep the network and everything on screen; explain why.
      render(model);
      status.textContent = SWITCH_REFUSED + ' ' + status.textContent;
      return false;
    }
    // Fail closed: never carry a wallet session, review or consent across
    // networks. Bumping the generation abandons any in-flight connect (e.g.
    // a wallet chunk still loading) and silences its late results/errors.
    generation += 1;
    loading = false;
    const old = controller;
    controller = null;
    if (old) { try { old.disconnect().catch(() => {}); } catch { /* already discarded */ } }
    config = next;
    consent.checked = false;
    memo.value = '';
    amount.value = '1';
    render();
    return true;
  }

  document.addEventListener?.('visibilitychange', () => render(controller?.model));

  connect.addEventListener('click', () => act(connectWallet));
  disconnect.addEventListener('click', () => act(async () => {
    const ctl = controller;
    const gen = generation;
    if (!ctl || ctl.model.busy || ctl.model.hash || ctl.model.uncertain) return;
    await ctl.disconnect();
    // The network may have switched while the wallet was disconnecting.
    if (gen !== generation || controller !== ctl) return;
    consent.checked = false;
    render(ctl.model);
  }));
  refresh.addEventListener('click', () => act(async () => { const ctl = controller; if (!ctl || ctl.model.busy || ctl.model.hash || ctl.model.uncertain) return; consent.checked = false; await ctl.refresh(); }));
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
  review.addEventListener('click', () => act(() => signingAllowed() && controller?.review(memo.value.trim(), amount.value, consent.checked)));
  confirm.addEventListener('click', () => act(() => signingAllowed() && controller?.submit(consent.checked)));
  cancel.addEventListener('click', () => controller?.cancelReview());
  render();

  return {
    get network() { return config.network; },
    get model() { return controller?.model; },
    disconnect: () => act(async () => {
      const ctl = controller;
      if (!ctl || ctl.model.busy || ctl.model.hash || ctl.model.uncertain) return;
      await ctl.disconnect();
    }),
    refresh: () => act(async () => {
      const ctl = controller;
      if (!ctl || ctl.model.busy || ctl.model.hash || ctl.model.uncertain) return;
      await ctl.refresh();
    }),
    canSwitch: () => controller?.model.uncertain ? 'donation uncertain' : controller?.model.busy || controller?.model.hash ? 'donation pending' : null,
    setNetwork,
    connect: () => act(connectWallet),
  };
}
