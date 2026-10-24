import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { DONATIONS_NETWORKS, DEFAULT_DONATIONS_NETWORK } from '../src/donations-config.mjs';

// Harness for the plain (no-Taquito) boot module. It stubs the DOM and the
// dynamic import of ./donations-ui.js so the real boot logic runs untouched.
function boot({ failFirstImport = false, refuseSwitch = false } = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      id,
      disabled: false,
      hidden: false,
      value: '',
      textContent: '',
      dataset: {},
      attributes: {},
      listeners: {},
      addEventListener(event, fn) { this.listeners[event] = fn; },
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name]; },
    });
    return elements.get(id);
  };
  const switches = ['shadownet', 'mainnet'].map((key) => Object.assign(element('donations-network-' + key), { dataset: { network: key } }));
  const documentStub = {
    getElementById: element,
    querySelectorAll: (selector) => (selector === '.donations-network-option' ? switches : []),
    addEventListener: () => {},
  };
  let imports = 0;
  const inits = [];
  const apiCalls = [];
  let appNetwork = null;
  const appApi = {
    get network() { return appNetwork; },
    setNetwork: (key) => { apiCalls.push(['setNetwork', key]); if (refuseSwitch) return false; appNetwork = key; return true; },
    connect: () => { apiCalls.push(['connect']); },
  };
  const source = readFileSync(new URL('../src/donations-boot.mjs', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace(/^export /gm, '')
    .replace("import('./donations-ui.js')", 'loadAppModule()');
  const sandbox = {
    document: documentStub,
    DONATIONS_NETWORKS,
    DEFAULT_DONATIONS_NETWORK,
    loadAppModule: async () => {
      imports += 1;
      if (failFirstImport && imports === 1) throw new Error('network dropped');
      return { initDonationsApp: (key) => { inits.push(key); appNetwork = key; return appApi; } };
    },
  };
  runInNewContext(source, sandbox, { filename: 'donations-boot.mjs' });
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return {
    element,
    switches,
    inits,
    apiCalls,
    flush,
    get imports() { return imports; },
    async click(el) { (typeof el === 'string' ? element(el) : el).listeners.click(); await flush(); },
  };
}

test('the boot renders switch, badge and kicker for the default network without importing the Taquito app', () => {
  const h = boot();
  assert.equal(h.imports, 0, 'no Taquito bytes may load before an explicit interaction');
  assert.equal(h.element('donations-network-badge').textContent, 'TESTNET — no real value');
  assert.match(h.element('donations-kicker').textContent, /Shadownet testnet/);
  assert.match(h.element('donations-copy').textContent, /Shadownet testnet/);
  assert.equal(h.switches[0].getAttribute('aria-pressed'), 'true');
  assert.equal(h.switches[1].getAttribute('aria-pressed'), 'false');
  assert.equal(h.element('donations-load').disabled, false);
  assert.equal(h.element('donations-connect').disabled, false);
});

test('selecting mainnet shows the real-XTZ badge and disables load/connect while the contract is not deployed', async () => {
  const h = boot();
  await h.click(h.switches[1]);
  assert.equal(h.imports, 0, 'switching alone must not import the app');
  assert.equal(h.element('donations-network-badge').textContent, 'MAINNET — real XTZ');
  assert.match(h.element('donations-kicker').textContent, /Mainnet/);
  assert.match(h.element('donations-copy').textContent, /not deployed/);
  assert.match(h.element('donations-status').textContent, /not deployed yet/);
  assert.match(h.element('donations-status').textContent, /Donate panel above/);
  assert.equal(h.switches[1].getAttribute('aria-pressed'), 'true');
  assert.equal(h.switches[0].getAttribute('aria-pressed'), 'false');
  assert.equal(h.element('donations-load').disabled, true);
  assert.equal(h.element('donations-connect').disabled, true);
  // Clicking the disabled-by-boot controls still must not import anything.
  await h.click('donations-load');
  await h.click('donations-connect');
  assert.equal(h.imports, 0);
  // Switching back restores the shadownet state.
  await h.click(h.switches[0]);
  assert.equal(h.element('donations-network-badge').textContent, 'TESTNET — no real value');
  assert.equal(h.element('donations-load').disabled, false);
});

test('the load control imports the app exactly once and initializes it with the selected network', async () => {
  const h = boot();
  await h.click('donations-load');
  await h.click('donations-load');
  await h.click('donations-load');
  assert.equal(h.imports, 1, 'repeat clicks must reuse the single import');
  assert.deepEqual(h.inits, ['shadownet']);
  assert.equal(h.element('donations-load').hidden, true, 'the loader hides once the app owns the section');
});

test('a pre-load connect click imports the app once and then proceeds to connect', async () => {
  const h = boot();
  await h.click('donations-connect');
  assert.equal(h.imports, 1);
  assert.deepEqual(h.inits, ['shadownet']);
  assert.deepEqual(h.apiCalls, [['connect']]);
  // Further connect clicks belong to the loaded app, not the boot.
  await h.click('donations-connect');
  assert.equal(h.imports, 1);
  assert.deepEqual(h.apiCalls, [['connect']]);
});

test('switching after the app is loaded goes through the app api without reimporting', async () => {
  const h = boot();
  await h.click('donations-load');
  await h.click(h.switches[1]);
  assert.equal(h.imports, 1);
  assert.deepEqual(h.apiCalls, [['setNetwork', 'mainnet']]);
  assert.equal(h.element('donations-network-badge').textContent, 'MAINNET — real XTZ');
});

test('a failed app import is reported honestly and a later click can retry', async () => {
  const h = boot({ failFirstImport: true });
  await h.click('donations-load');
  assert.equal(h.imports, 1);
  assert.match(h.element('donations-status').textContent, /Could not load/);
  await h.click('donations-load');
  assert.equal(h.imports, 2);
  assert.deepEqual(h.inits, ['shadownet']);
});

test('(e) a switch the loaded app refuses (pending wallet request) leaves the selection, aria-pressed and badge unchanged', async () => {
  const h = boot({ refuseSwitch: true });
  await h.click('donations-load');
  await h.click(h.switches[1]);
  assert.deepEqual(h.apiCalls, [['setNetwork', 'mainnet']]);
  assert.equal(h.switches[0].getAttribute('aria-pressed'), 'true');
  assert.equal(h.switches[1].getAttribute('aria-pressed'), 'false');
  assert.equal(h.element('donations-network-badge').textContent, 'TESTNET — no real value');
  assert.match(h.element('donations-kicker').textContent, /Shadownet testnet/);
  // The selection did not move, so clicking mainnet again asks the app again
  // instead of being treated as a no-op on an already-selected network.
  await h.click(h.switches[1]);
  assert.deepEqual(h.apiCalls, [['setNetwork', 'mainnet'], ['setNetwork', 'mainnet']]);
});
