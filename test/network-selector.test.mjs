import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { networkState } from '../src/network-state.mjs';

const html = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
const walletUi = readFileSync(new URL('../src/wallet-ui.mjs', import.meta.url), 'utf8');

test('one shared singleton defaults to mainnet', () => {
  assert.equal(networkState.selected().network, 'mainnet');
});

test('header has one labelled native network select beside the wallet, mainnet selected', () => {
  const header = html.match(/<div class="header-wallet">[\s\S]*?<\/div>/)[0];
  assert.match(header, /<label[^>]*for="network-select"/);
  assert.match(header, /<select id="network-select"/);
  assert.match(header, /<option value="mainnet" selected>Mainnet<\/option>/);
  assert.match(header, /<option value="shadownet">Shadownet<\/option>/);
});

test('duplicate donations network switch is removed', () => {
  assert.doesNotMatch(html, /donations-network-option/);
});

test('donations-boot follows the shared selected network, not its own default', () => {
  const boot = readFileSync(new URL('../src/donations-boot.mjs', import.meta.url), 'utf8');
  assert.match(boot, /import \{ networkState \} from '\.\/network-state\.mjs'/);
  assert.match(boot, /networkState\.onChange\(/);
  assert.match(boot, /let selected = networkState\.selected\(\)\.network/);
});

test('wallet-ui gates legacy flows on the shared state and refuses switch while busy', () => {
  assert.match(walletUi, /from '\.\/network-state\.mjs'/);
  assert.match(walletUi, /legacyAllowed\(\)/);
  assert.match(walletUi, /addGuard\(/);
});
