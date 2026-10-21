import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { DONATIONS_CONFIG } from '../src/donations-config.mjs';

const CONFIG = DONATIONS_CONFIG;
const OP_HASH = 'o' + 'Q'.repeat(50);

const STATE = {
  nextDonationId: 2,
  totalDonatedMutez: '2500000',
  totalDisbursedMutez: '1000000',
  selectedBaker: 'tz2-baker',
  donations: [
    { id: 0, sender: 'tz1-donor-a', amountMutez: '1000000', timestamp: 1_739_000_000, level: 100, memo: '68686868', memoText: 'thanks' },
    { id: 1, sender: 'tz1-donor-b', amountMutez: '1500000', timestamp: 1_739_000_100, level: 101, memo: '', memoText: '' },
  ],
};

function ui() {
  const elements = new Map();
  const calls = [];
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      id,
      disabled: false,
      hidden: false,
      checked: false,
      value: id === 'donations-amount' ? '1' : '',
      textContent: '',
      title: '',
      href: '',
      innerHTML: '',
      className: '',
      firstChild: null,
      children: [],
      appendChild(child) { this.children.push(child); this.firstChild = this.firstChild || child; },
      listeners: {},
      dataset: {},
      addEventListener(event, fn) { this.listeners[event] = fn; },
      setAttribute() {},
      focus() { this.focused = true; },
    });
    return elements.get(id);
  };
  const presets = ['1', '10'].map((value) => Object.assign(element('preset-' + value), { dataset: { donationsAmount: value } }));
  let loads = 0;
  const documentStub = {
    getElementById: element,
    querySelectorAll: () => presets,
    createElement: (tag) => ({ tag, className: '', textContent: '' }),
    addEventListener: () => {},
  };
  const model = { account: null, state: null, review: null, busy: false, hash: null, error: null, uncertain: false };
  let changed;
  const emit = () => changed && changed(model);
  const controller = {
    get model() { return model; },
    onChange: null,
    connect: async () => { calls.push(['connect']); if (!model.account) { model.account = { address: 'tz1-fixture', network: { type: 'shadownet' }, scopes: ['operation_request'] }; model.state = STATE; } emit(); },
    refresh: async () => { calls.push(['refresh']); if (model.account) { model.state = STATE; model.review = null; } emit(); },
    review: (memo, amountXTZ, acknowledged) => { calls.push(['review', memo, amountXTZ, acknowledged]); if (acknowledged !== true) throw new Error('Acknowledge the gift and review the donation first.'); if (!model.account) throw new Error('Connect a shadownet wallet first.'); if (!model.state) throw new Error('No state.'); const amount = Number(amountXTZ); if (!Number.isFinite(amount) || amount <= 0) throw new Error('Donation amount must be a positive integer number of ꜩ (minimum 1).'); model.review = { source: model.account.address, destination: CONFIG.contractAddress, amountXTZ: String(amountXTZ), amountMutez: String(Math.round(amount * CONFIG.mutezPerTez)), memo, memoHex: 'xx', createdAt: Date.now() }; emit(); },
    submit: async (acknowledged) => { calls.push(['submit', acknowledged]); if (acknowledged !== true) throw new Error('Acknowledge the gift and review the donation first.'); if (!model.review) throw new Error('Review a fresh donation before requesting wallet approval.'); model.busy = true; emit(); model.hash = OP_HASH; model.review = null; emit(); },
    cancelReview: () => { calls.push(['cancel']); if (model.review) { model.review = null; emit(); } },
    disconnect: async () => { calls.push(['disconnect']); model.account = null; model.state = null; model.review = null; model.hash = null; model.uncertain = false; emit(); },
  };
  const source = readFileSync(new URL('../src/donations-ui.mjs', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace("import('./octez-client.mjs')", 'loadClient()');
  runInNewContext(source, {
    document: documentStub,
    DONATIONS_CONFIG: CONFIG,
    createDonationsController: (options) => { changed = options.onChange; controller.onChange = options.onChange; return controller; },
    loadClient: async () => { loads += 1; return { makeDonationClient: () => ({ name: 'stub' }) }; },
  }, { filename: 'donations-ui.mjs' });
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return {
    element,
    presets,
    model,
    calls,
    controller,
    get loads() { return loads; },
    emit: () => { changed && changed(model); },
    async click(el) { (typeof el === 'string' ? element(el) : el).listeners.click(); await flush(); },
    async event(id, type) { element(id).listeners[type](); await flush(); },
  };
}

test('preset give buttons connect only and prefill the exact amount; they never review or submit', async () => {
  const h = ui();
  assert.equal(h.loads, 0);
  await h.click(h.presets[0]);
  assert.equal(h.element('donations-amount').value, '1');
  assert.equal(h.loads, 1);
  assert.equal(h.calls.filter((c) => c[0] === 'connect').length, 1);
  assert.ok(h.model.account);
  // A second preset changes the amount but does not reconnect or touch the wallet again.
  await h.click(h.presets[1]);
  assert.equal(h.element('donations-amount').value, '10');
  assert.equal(h.loads, 1);
  assert.equal(h.calls.filter((c) => c[0] === 'connect').length, 1);
  // Presets clear the consent, so the review step stays gated.
  assert.equal(h.element('donations-review').disabled, true);
});

test('the give flow requires consent, then a review, then a distinct wallet approval', async () => {
  const h = ui();
  await h.click(h.presets[1]);
  h.element('donations-memo').value = 'thanks';
  h.element('donations-consent').checked = true;
  await h.event('donations-consent', 'change');
  assert.equal(h.element('donations-review').disabled, false);
  await h.click('donations-review');
  assert.ok(h.calls.some((c) => c[0] === 'review' && c[1] === 'thanks' && c[2] === '10' && c[3] === true));
  assert.equal(h.element('donations-review-target').textContent, CONFIG.contractAddress);
  assert.equal(h.element('donations-review-amount').textContent, '10 ꜩ');
  assert.equal(h.element('donations-review-source').textContent, 'tz1-fixture');
  assert.equal(h.element('donations-review-memo').textContent, 'thanks');
  assert.equal(h.calls.filter((c) => c[0] === 'submit').length, 0);
  await h.click('donations-confirm');
  assert.ok(h.calls.some((c) => c[0] === 'submit' && c[1] === true));
  assert.equal(h.element('donations-operation').hidden, false);
  assert.equal(h.element('donations-operation').href, 'https://tzkt.io/' + OP_HASH);
});

test('editing the amount or unchecking consent under a review invalidates it and re-disables approval', async () => {
  for (const change of ['amount', 'consent']) {
    const h = ui();
    await h.click(h.presets[0]);
    h.element('donations-memo').value = 'thanks';
    h.element('donations-consent').checked = true;
    await h.event('donations-consent', 'change');
    await h.click('donations-review');
    if (change === 'amount') { h.element('donations-amount').value = '25'; await h.event('donations-amount', 'input'); }
    else { h.element('donations-consent').checked = false; await h.event('donations-consent', 'change'); }
    assert.equal(h.model.review, null);
    assert.equal(h.element('donations-summary').hidden, true);
    assert.equal(h.element('donations-confirm').disabled, true);
    assert.equal(h.calls.filter((c) => c[0] === 'submit').length, 0);
  }
});

test('busy, uncertain and submitted states block every give control and preset reconnect', async () => {
  for (const flag of ['busy', 'uncertain', 'hash']) {
    const h = ui();
    await h.click(h.presets[0]);
    h.element('donations-memo').value = 'thanks';
    h.element('donations-consent').checked = true;
    await h.event('donations-consent', 'change');
    await h.click('donations-review');
    h.model[flag] = flag === 'hash' ? OP_HASH : true;
    h.emit();
    assert.equal(h.element('donations-refresh').disabled, true);
    assert.equal(h.element('donations-review').disabled, true);
    assert.equal(h.element('donations-confirm').disabled, true);
    assert.ok(h.presets.every((p) => p.disabled));
    const before = h.calls.length;
    await h.click(h.presets[1]);
    assert.equal(h.calls.length, before);
  }
});

test('a failed connect surfaces the wallet error and a fresh attempt reloads the client', async () => {
  const h = ui();
  // Make the very first connect fail. The UI's click handler runs the attempt
  // through act(), which swallows the throw but still surfaces it in the status.
  h.controller.connect = async () => { throw new Error('wallet offline'); };
  await h.element('donations-connect').listeners.click();
  assert.equal(h.loads, 1);
  assert.equal(h.model.account, null);
  assert.match(h.element('donations-status').textContent, /wallet offline/);
  // The failed connect cleared the client, so the next connect reloads it (1 -> 2).
  h.controller.connect = async () => { h.model.account = { address: 'tz1-fixture', network: { type: 'shadownet' }, scopes: ['operation_request'] }; h.model.state = STATE; if (h.controller.onChange) h.controller.onChange(h.model); };
  await h.element('donations-connect').listeners.click();
  assert.equal(h.loads, 2);
  assert.ok(h.model.account);
  assert.equal(h.element('donations-connect').disabled, true);
});

test('donations markup ships the Taquito UI and honest shadownet wording', () => {
  const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
  assert.match(html, /<script[^>]+src="\.\/donations-ui\.js"/);
  for (const id of ['donations-app', 'donations-status', 'donations-total', 'donations-count', 'donations-list', 'donations-account', 'donations-connect', 'donations-refresh', 'donations-disconnect', 'donations-memo', 'donations-amount', 'donations-consent', 'donations-review', 'donations-review-source', 'donations-review-target', 'donations-review-amount', 'donations-review-memo', 'donations-confirm', 'donations-cancel', 'donations-operation']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  for (const amount of ['1', '10']) {
    assert.match(html, new RegExp('data-donations-amount="' + amount + '"'));
  }
  assert.match(html, /shadownet/i);
  assert.match(html, /<input[^>]+id="donations-amount"[^>]+inputmode="decimal"/);
});
