import test from 'node:test';
import assert from 'node:assert/strict';
import { createNetworkState } from '../src/network-state.mjs';

test('guard vetoes switch BEFORE selection changes', () => {
  const s = createNetworkState('mainnet');
  const seen = [];
  s.onChange((e) => seen.push(e.network));
  const off = s.addGuard(() => 'donation pending');
  assert.throws(() => s.select('shadownet'), /donation pending/);
  assert.equal(s.selected().network, 'mainnet');
  assert.equal(s.epoch(), 0);
  assert.deepEqual(seen, []);
  off();
  s.select('shadownet');
  assert.equal(s.selected().network, 'shadownet');
});
