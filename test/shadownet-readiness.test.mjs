import test from 'node:test';
import assert from 'node:assert/strict';
import { DONATIONS_NETWORKS } from '../src/donations-config.mjs';
import { createDonationsController } from '../src/donations-controller.mjs';
const config = DONATIONS_NETWORKS.shadownet;
const recipient = 'tz1gi7PyMEPKhH3p6hqHiTyzabudNE7aZWYV';
function harness() {
  const calls = []; let state = { network: config.network, chainId: config.chainId, contractAddress: config.contractAddress, recipient };
  const client = { async requestPermissions(o) { calls.push(['pair', o]); }, async getActiveAccount() { return { address: 'tz1-offline', network: { type: config.network, chainId: config.caip2 }, scopes: ['operation_request'] }; }, async requestOperation(o) { calls.push(['send', o]); return { transactionHash: 'o' + 'Q'.repeat(50) }; }, async disconnect() {} };
  const controller = createDonationsController({ config, client, loadState: async () => { calls.push(['read']); return {...state}; }, buildOp: async ({amountMutez}) => ({destination: config.contractAddress, amount: amountMutez, parameters: {entrypoint: config.entrypoint, value: {bytes: ''}}}) });
  return { controller, calls, setState: (s) => { state = s; } };
}
test('approved Shadownet beneficiary is ready only after fresh storage reads and explicit actions', async () => {
  const h = harness(); assert.deepEqual(h.calls, []);
  await h.controller.connect();
  await h.controller.review('', '1', true);
  assert.ok(h.controller.model.review);
  assert.equal(h.calls.filter(c => c[0] === 'read').length, 2);
  assert.equal(h.calls.filter(c => c[0] === 'send').length, 0);
  await h.controller.submit(true);
  const sends = h.calls.filter(c => c[0] === 'send');
  assert.equal(sends.length, 1); assert.equal(sends[0][1].network, config.caip2);
  assert.equal(h.calls.filter(c => c[0] === 'pair').length, 1);
});
for (const bad of [{recipient: 'KT1-old-sink'}, {recipient: null}, {recipient, network: 'mainnet'}, {recipient, chainId: 'NetXdQprcVkpaWU'}, {recipient, contractAddress: 'KT1-wrong'}]) {
  for (const stage of ['review', 'send']) test(`${stage} fails closed for ${JSON.stringify(bad)}`, async () => {
    const h = harness(); await h.controller.connect();
    if (stage === 'send') await h.controller.review('', '1', true);
    h.setState({network: config.network, chainId: config.chainId, contractAddress: config.contractAddress, ...bad});
    await assert.rejects(async () => stage === 'review' ? h.controller.review('', '1', true) : h.controller.submit(true), /recipient|storage|beneficiary/i);
    assert.equal(h.calls.filter(c => c[0] === 'send').length, 0);
  });
}
test('mainnet remains undeployed and disabled', async () => {
  assert.equal(DONATIONS_NETWORKS.mainnet.contractAddress, null);
  const c = createDonationsController({config: DONATIONS_NETWORKS.mainnet, client: {}});
  assert.throws(() => c.review('', '1', true), /disabled|deployed/);
  await assert.rejects(c.submit(true), /disabled|deployed/);
});
test('a missing live read cannot be replaced by configured recipient', async () => {
  const h = harness(); await h.controller.connect(); h.setState(null);
  await assert.rejects(async () => h.controller.review('', '1', true), /storage|recipient/);
  assert.equal(h.controller.model.review, null);
  assert.equal(h.calls.filter(c => c[0] === 'send').length, 0);
});
test('cancelling while the fresh review read is pending never restores a review', async () => {
  let release; let reads = 0;
  const state = {network: config.network, chainId: config.chainId, contractAddress: config.contractAddress, recipient};
  const c = createDonationsController({config, client: {async requestPermissions(){}, async getActiveAccount(){return {address: 'tz1-offline', network: {type: config.network, chainId: config.caip2}, scopes: ['operation_request']};}}, loadState: async () => { if (++reads > 1) await new Promise(r => {release = r;}); return state; }});
  await c.connect(); const pending = c.review('', '1', true);
  while (!release) await Promise.resolve();
  c.cancelReview(); release();
  await assert.rejects(pending, /cancelled|consent/); assert.equal(c.model.review, null);
});
test('recipient changed during operation building is rejected by the final storage read', async () => {
  let recipientNow = recipient; let sends = 0;
  const c = createDonationsController({config, client: {async requestPermissions(){}, async getActiveAccount(){return {address:'tz1-offline',network:{type:config.network,chainId:config.caip2},scopes:['operation_request']};}, async requestOperation(){sends++;}}, loadState: async () => ({network:config.network,chainId:config.chainId,contractAddress:config.contractAddress,recipient:recipientNow}), buildOp: async () => {recipientNow = 'KT1-old-sink'; return {};}});
  await c.connect(); await c.review('', '1', true);
  await assert.rejects(c.submit(true), /storage|recipient/); assert.equal(sends, 0);
});
