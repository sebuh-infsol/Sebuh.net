import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { DONATIONS_NETWORKS as LIVE_NETWORKS, DEFAULT_DONATIONS_NETWORK } from '../src/donations-config.mjs';

// Offline synthetic signing configuration; the deployed policy separately requires verified live storage.
const DONATIONS_NETWORKS = {...LIVE_NETWORKS, shadownet: {...LIVE_NETWORKS.shadownet, submissionPolicy: 'enabled', contractAddress: 'KT1-offline-fixture'}};
const CONFIG = DONATIONS_NETWORKS.shadownet;
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

function ui({ start = DEFAULT_DONATIONS_NETWORK } = {}) {
  const elements = new Map();
  const calls = [];
  const created = [];
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
    .replace(/^export /gm, '')
    .replace("import('./octez-client.mjs')", 'loadClient()');
  const sandbox = {
    document: documentStub,
    DONATIONS_NETWORKS,
    DEFAULT_DONATIONS_NETWORK,
    createDonationsController: (options) => { changed = options.onChange; controller.onChange = options.onChange; created.push(options); return controller; },
    loadClient: async () => { loads += 1; return { makeDonationClient: () => ({ name: 'stub' }) }; },
  };
  runInNewContext(source, sandbox, { filename: 'donations-ui.mjs' });
  const api = sandbox.initDonationsApp(start);
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return {
    element,
    presets,
    model,
    calls,
    created,
    controller,
    api,
    flush,
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
  assert.equal(h.element('donations-operation').href, 'https://shadownet.tzkt.io/' + OP_HASH);
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

test('the app initializes against the selected network and hands that exact config to the controller', async () => {
  const h = ui();
  assert.equal(h.api.network, 'shadownet');
  await h.click('donations-connect');
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].config, DONATIONS_NETWORKS.shadownet);
});

test('switching networks hard-resets the wallet session, review and consent (fail closed)', async () => {
  const h = ui();
  await h.click(h.presets[1]);
  h.element('donations-memo').value = 'thanks';
  h.element('donations-consent').checked = true;
  await h.event('donations-consent', 'change');
  await h.click('donations-review');
  assert.ok(h.model.review, 'a review must be pending before the switch');
  h.api.setNetwork('mainnet');
  await h.flush();
  assert.equal(h.api.network, 'mainnet');
  // The shadownet wallet session was told to disconnect; nothing carries over.
  assert.ok(h.calls.some((c) => c[0] === 'disconnect'));
  assert.equal(h.element('donations-account').textContent, 'Not connected');
  assert.equal(h.element('donations-consent').checked, false);
  assert.equal(h.element('donations-memo').value, '');
  assert.equal(h.element('donations-summary').hidden, true);
  assert.equal(h.element('donations-confirm').disabled, true);
  assert.equal(h.element('donations-review').disabled, true);
});

test('mainnet with no deployed contract disables every control and shows the honest not-deployed state', async () => {
  const h = ui({ start: 'mainnet' });
  assert.equal(h.api.network, 'mainnet');
  assert.equal(h.element('donations-connect').disabled, true);
  assert.equal(h.element('donations-review').disabled, true);
  assert.equal(h.element('donations-confirm').disabled, true);
  assert.equal(h.element('donations-memo').disabled, true);
  assert.equal(h.element('donations-amount').disabled, true);
  assert.equal(h.element('donations-consent').disabled, true);
  assert.ok(h.presets.every((p) => p.disabled));
  assert.match(h.element('donations-status').textContent, /not deployed yet/);
  assert.match(h.element('donations-status').textContent, /Donate panel above/);
  assert.equal(h.element('donations-total').textContent, 'Not deployed');
  // Clicking connect or a preset must not load the wallet client or touch a wallet.
  await h.click('donations-connect');
  await h.click(h.presets[0]);
  assert.equal(h.loads, 0);
  assert.equal(h.calls.length, 0);
  // Switching back to shadownet re-enables the deployed app.
  h.api.setNetwork('shadownet');
  await h.flush();
  assert.equal(h.element('donations-connect').disabled, false);
  assert.match(h.element('donations-status').textContent, /shadownet/);
});

test('donations markup ships the badge and lazy loader (network chosen by the header select) instead of an eager Taquito script', () => {
  const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
  assert.match(html, /<select id="network-select"/);
  // The 180 KB Taquito bundle must NOT load eagerly with the page.
  assert.doesNotMatch(html, /<script[^>]+src="\.\/donations-ui\.js"/);
  assert.match(html, /<script[^>]+type="module"[^>]+src="\.\/donations-boot\.js"/);
  for (const id of ['donations-app', 'donations-kicker', 'donations-copy', 'donations-network-badge', 'donations-load', 'donations-status', 'donations-total', 'donations-count', 'donations-list', 'donations-account', 'donations-connect', 'donations-refresh', 'donations-disconnect', 'donations-memo', 'donations-amount', 'donations-consent', 'donations-review', 'donations-review-source', 'donations-review-target', 'donations-review-amount', 'donations-review-memo', 'donations-confirm', 'donations-cancel', 'donations-operation']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  for (const amount of ['1', '10']) {
    assert.match(html, new RegExp('data-donations-amount="' + amount + '"'));
  }
  assert.match(html, /shadownet/i);
  assert.match(html, /<input[^>]+id="donations-amount"[^>]+inputmode="decimal"/);
  // CSP script-src 'self': the switch and loader must not use inline handlers.
  assert.doesNotMatch(html, /onclick=|onchange=|oninput=|javascript:/i);
});

// ---------------------------------------------------------------------------
// Race harness: the REAL donations-ui.mjs driving the REAL donations
// controller, with a stubbed DOM and a stubbed, delayable wallet client.
// Gates let a test hold the client-chunk import, the permission prompt, the
// operation request or the wallet disconnect open across a network switch.
import { createDonationsController as realController } from '../src/donations-controller.mjs';

const deferred = () => { let resolve; let reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };

function raceUi({ start = 'shadownet' } = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { id, disabled: false, hidden: false, checked: false, value: id === 'donations-amount' ? '1' : '', textContent: '', href: '', innerHTML: '', firstChild: null, appendChild() {}, listeners: {}, dataset: {}, addEventListener(e, f) { this.listeners[e] = f; }, setAttribute() {}, focus() {} });
    return elements.get(id);
  };
  const presets = ['1', '10'].map((v) => Object.assign(element('preset-' + v), { dataset: { donationsAmount: v } }));
  const log = [];
  const gates = { import: null, perms: null, op: null, disconnect: null };
  const clients = [];
  const makeClient = (cfg) => {
    const c = {
      cfg, active: null,
      async requestPermissions(o) { log.push(['requestPermissions', cfg.network, o.scopes]); if (gates.perms) await gates.perms.p; c.active = { address: 'tz1' + 'a'.repeat(33), network: { type: cfg.network, chainId: cfg.caip2 }, scopes: ['operation_request'] }; },
      async getActiveAccount() { return c.active; },
      async requestOperation(o) { log.push(['requestOperation', cfg.network, o.network]); if (gates.op) await gates.op.p; return { transactionHash: OP_HASH }; },
      async disconnect() { log.push(['client.disconnect', cfg.network]); if (gates.disconnect) await gates.disconnect.p; c.active = null; },
    };
    clients.push(c);
    return c;
  };
  const source = readFileSync(new URL('../src/donations-ui.mjs', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace(/^export /gm, '')
    .replace("import('./octez-client.mjs')", 'loadClient()');
  const sandbox = {
    document: { getElementById: element, querySelectorAll: () => presets, createElement: () => ({}), addEventListener() {} },
    DONATIONS_NETWORKS,
    DEFAULT_DONATIONS_NETWORK,
    createDonationsController: (opts) => realController({
      ...opts,
      loadBalance: async (address) => ({address, balance: '1000000', observedAt: Date.now()}),
      loadState: async () => { if (!opts.config.contractAddress) throw new Error('no contract'); return { nextDonationId: 0, totalDonatedMutez: '0', donations: [] }; },
      buildOp: async ({ amountMutez }) => ({ destination: opts.config.contractAddress, amount: amountMutez, mutez: true, parameters: {} }),
    }),
    loadClient: async () => { log.push(['import']); if (gates.import) await gates.import.p; return { makeDonationClient: (cfg) => { log.push(['makeDonationClient', cfg.network]); return makeClient(cfg); } }; },
  };
  runInNewContext(source, sandbox, { filename: 'donations-ui.mjs' });
  const api = sandbox.initDonationsApp(start);
  const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
  return {
    element, presets, log, gates, clients, api, flush,
    status: () => element('donations-status').textContent,
    click: (id) => element(id).listeners.click(),
    async connected() { this.click('donations-connect'); await flush(); },
    async pendingGive() {
      await this.connected();
      element('donations-consent').checked = true; element('donations-consent').listeners.change(); await flush();
      this.click('donations-review'); await flush();
      gates.op = deferred();
      this.click('donations-confirm'); await flush();
    },
  };
}

test('(a) a Connect started on shadownet is abandoned when the network switches before the client chunk loads', async () => {
  const h = raceUi();
  h.gates.import = deferred();
  h.click('donations-connect'); await h.flush();
  const accepted = h.api.setNetwork('mainnet');
  await h.flush();
  h.gates.import.resolve(); await h.flush();
  assert.deepEqual(h.log.filter((c) => c[0] === 'makeDonationClient'), [], 'no wallet client may be created after the switch');
  assert.deepEqual(h.log.filter((c) => c[0] === 'requestPermissions'), [], 'no wallet permission prompt may open after the switch');
  assert.equal(accepted, true, 'switching while only the chunk import is in flight is allowed');
  assert.equal(h.api.network, 'mainnet');
  assert.match(h.status(), /Mainnet contract not deployed yet/);
  assert.equal(h.element('donations-connect').disabled, true);
  // Switching back leaves a clean, connectable shadownet app (loading was reset).
  assert.equal(h.api.setNetwork('shadownet'), true);
  assert.equal(h.element('donations-connect').disabled, false);
  await h.connected();
  assert.deepEqual(h.log.filter((c) => c[0] === 'makeDonationClient'), [['makeDonationClient', 'shadownet']]);
});

test('(b) a switch is refused while a wallet request is pending, keeping the network and the operation outcome', async () => {
  // Pending permission prompt: the busy controller would reject disconnect().
  {
    const h = raceUi();
    h.gates.perms = deferred();
    h.click('donations-connect'); await h.flush();
    assert.equal(h.api.setNetwork('mainnet'), false);
    await h.flush();
    assert.equal(h.api.network, 'shadownet');
    assert.match(h.status(), /Finish or cancel the pending wallet request before switching networks/);
    assert.equal(h.log.filter((c) => c[0] === 'client.disconnect').length, 0);
    h.gates.perms.resolve(); await h.flush();
    assert.equal(h.element('donations-account').textContent, 'tz1' + 'a'.repeat(33));
  }
  // Pending give awaiting wallet approval, then resolved with a hash.
  {
    const h = raceUi();
    await h.pendingGive();
    assert.equal(h.api.setNetwork('mainnet'), false);
    await h.flush();
    assert.equal(h.api.network, 'shadownet');
    assert.match(h.status(), /Finish or cancel the pending wallet request before switching networks/);
    assert.equal(h.clients[0].active !== null, true, 'the session is not silently half-disconnected');
    h.gates.op.resolve(); await h.flush();
    assert.equal(h.element('donations-operation').hidden, false, 'the operation hash stays visible');
    assert.equal(h.element('donations-operation').href, 'https://shadownet.tzkt.io/' + OP_HASH);
    // With an unverified hash on screen a switch is still refused and the hash is kept.
    assert.equal(h.api.setNetwork('mainnet'), false);
    assert.equal(h.api.network, 'shadownet');
    assert.equal(h.element('donations-operation').hidden, false);
    assert.match(h.status(), /Finish or cancel the pending wallet request before switching networks/);
  }
  // Pending give whose outcome becomes uncertain: refused, uncertainty kept visible.
  {
    const h = raceUi();
    await h.pendingGive();
    h.gates.op.reject(new Error('transport dropped')); await h.flush();
    assert.equal(h.api.setNetwork('mainnet'), false);
    assert.equal(h.api.network, 'shadownet');
    assert.match(h.status(), /Finish or cancel the pending wallet request before switching networks/);
    assert.match(h.status(), /outcome is unknown|may have been submitted/);
  }
});

test('(c) a stale shadownet error that settles after the switch cannot overwrite the mainnet status', async () => {
  const h = raceUi();
  h.gates.import = deferred();
  h.click('donations-connect'); await h.flush();
  const accepted = h.api.setNetwork('mainnet');
  await h.flush();
  const honest = h.status();
  assert.match(honest, /Mainnet contract not deployed yet/);
  h.gates.import.reject(new Error('STALE shadownet chunk error')); await h.flush();
  assert.doesNotMatch(h.status(), /STALE/);
  assert.equal(h.status(), honest);
  assert.equal(accepted, true);
});

test('(d) a disconnect still awaiting when the network switches neither throws nor renders a null controller', async () => {
  const h = ui();
  await h.click('donations-connect');
  const gate = deferred();
  h.controller.disconnect = async () => { h.calls.push(['disconnect']); await gate.p; h.model.account = null; h.model.state = null; };
  h.element('donations-disconnect').listeners.click();
  await h.flush();
  const accepted = h.api.setNetwork('mainnet');
  await h.flush();
  gate.resolve(); await h.flush();
  assert.equal(h.api.network, 'mainnet');
  assert.doesNotMatch(h.element('donations-status').textContent, /TypeError|null|undefined|Cannot read/);
  assert.match(h.element('donations-status').textContent, /Mainnet contract not deployed yet/);
  assert.equal(h.element('donations-connect').disabled, true);
  assert.equal(accepted, true);
});

test('(d2) with the real controller a disconnect in progress blocks the switch and completes on its own network', async () => {
  const h = raceUi();
  await h.connected();
  h.gates.disconnect = deferred();
  h.click('donations-disconnect'); await h.flush();
  assert.equal(h.api.setNetwork('mainnet'), false);
  h.gates.disconnect.resolve(); await h.flush();
  assert.equal(h.api.network, 'shadownet');
  assert.equal(h.element('donations-account').textContent, 'Not connected');
  assert.match(h.status(), /Connect a shadownet wallet/);
  assert.equal(h.api.setNetwork('mainnet'), true);
});
