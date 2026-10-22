import test from 'node:test';
import assert from 'node:assert/strict';
import { DONATIONS_NETWORKS, DEFAULT_DONATIONS_NETWORK, DONATIONS_CONFIG } from '../src/donations-config.mjs';

test('donations network registry pins shadownet and mainnet with honest flags', () => {
  const s = DONATIONS_NETWORKS.shadownet;
  assert.equal(s.network, 'shadownet');
  assert.equal(s.chainId, 'NetXsqzbfFenSTS');
  assert.equal(s.caip2, 'tezos:NetXsqzbfFenSTS');
  assert.equal(s.rpcUrl, 'https://rpc.shadownet.teztnets.com');
  assert.equal(s.contractAddress, 'KT1Sgiad8uYnDQqpbG2Cc6G8DuDRvDRD6zXU');
  assert.equal(s.entrypoint, 'donate');
  assert.equal(s.label, 'Shadownet testnet');
  assert.equal(s.realValue, false);
  assert.equal(s.mutezPerTez, 1_000_000);

  const m = DONATIONS_NETWORKS.mainnet;
  assert.equal(m.network, 'mainnet');
  assert.equal(m.chainId, 'NetXdQprcVkpaWU');
  assert.equal(m.caip2, 'tezos:NetXdQprcVkpaWU');
  assert.equal(m.rpcUrl, 'https://rpc.tzkt.io/mainnet');
  // Honest fail-closed state: the mainnet donations contract is NOT deployed.
  assert.equal(m.contractAddress, null);
  assert.equal(m.entrypoint, 'donate');
  assert.equal(m.label, 'Mainnet');
  assert.equal(m.realValue, true);
  assert.equal(m.mutezPerTez, 1_000_000);

  assert.equal(DEFAULT_DONATIONS_NETWORK, 'shadownet');
  // Compatibility export: existing modules keep importing DONATIONS_CONFIG and
  // must get exactly the default network's config object.
  assert.equal(DONATIONS_CONFIG, DONATIONS_NETWORKS[DEFAULT_DONATIONS_NETWORK]);
});
