import test from 'node:test';
import assert from 'node:assert/strict';
import { createNetworkState, GLOBAL_DEFAULT_NETWORK } from '../src/network-state.mjs';

test('global default is mainnet (legacy behaviour preserved)', () => {
  assert.equal(GLOBAL_DEFAULT_NETWORK, 'mainnet');
  const s = createNetworkState();
  assert.equal(s.selected().network, 'mainnet');
  assert.equal(s.selected().caip2, 'tezos:NetXdQprcVkpaWU');
  assert.equal(s.selected().contractAddress, null);
});

test('selected entry never exposes private nodeRpcUrl', () => {
  const s = createNetworkState();
  s.select('shadownet');
  assert.equal('nodeRpcUrl' in s.selected(), false);
});

test('switch refuses while an operation is pending or uncertain', () => {
  const s = createNetworkState();
  s.setBusy('pending');
  assert.throws(() => s.select('shadownet'), /pending/);
  s.setBusy('uncertain');
  assert.throws(() => s.select('shadownet'), /uncertain/);
  s.setBusy(null);
  s.select('shadownet');
  assert.equal(s.selected().network, 'shadownet');
});

test('switch invalidates listeners and stale epochs; never auto-connects', () => {
  const s = createNetworkState();
  const seen = [];
  s.onChange((entry) => seen.push(entry.network));
  const epoch = s.epoch();
  s.select('shadownet');
  assert.deepEqual(seen, ['shadownet']);
  assert.equal(s.isCurrent(epoch), false);
  assert.equal(s.isCurrent(s.epoch()), true);
});

test('unknown network rejected; chain mismatch detected', () => {
  const s = createNetworkState();
  assert.throws(() => s.select('ghostnet'), /unknown/);
  assert.equal(s.matchesChain('NetXdQprcVkpaWU'), true);
  assert.equal(s.matchesChain('NetXsqzbfFenSTS'), false);
});

test('legacy delegation/direct gifts only allowed on mainnet', () => {
  const s = createNetworkState();
  assert.equal(s.legacyAllowed(), true);
  s.select('shadownet');
  assert.equal(s.legacyAllowed(), false);
});
