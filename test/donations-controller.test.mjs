import test from 'node:test';
import assert from 'node:assert/strict';
import { DONATIONS_CONFIG } from '../src/donations-config.mjs';
import { createDonationsController } from '../src/donations-controller.mjs';

const OP_HASH = 'o' + 'Q'.repeat(50);

// Mock octez.connect wallet client. The real controller drives four methods:
// requestPermissions, getActiveAccount, requestOperation, disconnect.
function mockClient({ network = 'shadownet', scopes = ['operation_request'] } = {}) {
  const calls = [];
  const client = {
    calls,
    async requestPermissions(opts) { calls.push(['requestPermissions', opts && opts.scopes]); },
    async getActiveAccount() { calls.push(['getActiveAccount']); return { address: 'tz1-caller', network: { type: network, chainId: DONATIONS_CONFIG.caip2 }, scopes }; },
    async requestOperation(opts) { calls.push(['requestOperation', opts && opts.operationDetails && opts.operationDetails[0], opts && opts.network]); return { transactionHash: OP_HASH }; },
    async disconnect() { calls.push(['disconnect']); },
  };
  return client;
}

const DEFAULT_STATE = { nextDonationId: 1, totalDonatedMutez: '1000000', totalDisbursedMutez: '0', donations: [] };

function make({ network = 'shadownet', scopes = ['operation_request'], client: injectedClient, state = DEFAULT_STATE } = {}) {
  const client = injectedClient || mockClient({ network, scopes });
  const buildOpCalls = [];
  let loadStateCalls = 0;
  const controller = createDonationsController({
    client,
    config: DONATIONS_CONFIG,
    loadState: async () => { loadStateCalls += 1; return state; },
    // Deterministic, network-free op builder standing in for the Taquito encoder.
    buildOp: async ({ memo, amountMutez }) => {
      buildOpCalls.push({ memo, amountMutez });
      return { destination: DONATIONS_CONFIG.contractAddress, amount: amountMutez, parameters: { entrypoint: DONATIONS_CONFIG.entrypoint, value: { bytes: '6869' } } };
    },
    onChange: () => {},
  });
  return { client, controller, buildOpCalls, get loadStateCalls() { return loadStateCalls; } };
}

test('connect adopts a matching-network, operation-only account and loads the contract state', async () => {
  const { client, controller } = make({ network: 'shadownet' });
  await controller.connect();
  assert.equal(controller.model.account.address, 'tz1-caller');
  assert.equal(controller.model.account.network.type, 'shadownet');
  assert.ok(controller.model.state);
  assert.equal(client.calls.filter((c) => c[0] === 'requestPermissions').length, 1);
});

test('connect rejects a wrong-network account', async () => {
  const { controller } = make({ network: 'mainnet' });
  await assert.rejects(() => controller.connect(), /shadownet/);
  assert.equal(controller.model.account, null);
});

test('connect rejects an account whose scope is not exactly operation_request', async () => {
  const { controller } = make({ scopes: ['viewing_key'] });
  await assert.rejects(() => controller.connect(), /operation-only/);
  assert.equal(controller.model.account, null);
});

test('review requires acknowledgment and a connected wallet', () => {
  const { controller } = make();
  assert.throws(() => controller.review('thanks', '1', true), /Connect a shadownet/);
  // Cannot be exercised without a connected account past the first gate.
});

test('review freezes source, destination, amount and memo into the review', async () => {
  const { controller } = make();
  await controller.connect();
  assert.throws(() => controller.review('thanks', '1', false), /Acknowledge/);
  controller.review('thanks', '10', true);
  const r = controller.model.review;
  assert.equal(r.source, 'tz1-caller');
  assert.equal(r.destination, DONATIONS_CONFIG.contractAddress);
  assert.equal(r.amountXTZ, '10');
  assert.equal(r.amountMutez, '10000000');
  assert.equal(r.memo, 'thanks');
});

test('review rejects a zero or negative amount', async () => {
  const { controller } = make();
  await controller.connect();
  assert.throws(() => controller.review('thanks', '0', true), /positive/);
  assert.throws(() => controller.review('thanks', '-1', true), /positive/);
  assert.equal(controller.model.review, null);
});

test('cancelReview clears a pending review', async () => {
  const { controller } = make();
  await controller.connect();
  controller.review('thanks', '10', true);
  assert.ok(controller.model.review);
  controller.cancelReview();
  assert.equal(controller.model.review, null);
});

test('submit without a review is rejected', async () => {
  const { controller } = make();
  await controller.connect();
  await assert.rejects(() => controller.submit(true), /fresh donation/);
});

test('submit without acknowledgment is rejected', async () => {
  const { controller } = make();
  await controller.connect();
  controller.review('thanks', '10', true);
  await assert.rejects(() => controller.submit(false), /Acknowledge/);
  assert.equal(controller.model.hash, null);
});

test('submit builds the op from the frozen reviewed values and records the op hash', async () => {
  const { client, controller, buildOpCalls } = make();
  await controller.connect();
  controller.review('thanks', '10', true);
  await controller.submit(true);
  assert.equal(controller.model.hash, OP_HASH);
  assert.equal(controller.model.review, null);
  assert.deepEqual(buildOpCalls[0], { memo: 'thanks', amountMutez: '10000000' });
  const opCall = client.calls.find((c) => c[0] === 'requestOperation');
  assert.equal(opCall[1].kind, 'transaction');
  assert.equal(opCall[1].source, 'tz1-caller');
  assert.equal(opCall[1].destination, DONATIONS_CONFIG.contractAddress);
  assert.equal(opCall[1].amount, '10000000');
  assert.equal(opCall[1].parameters.entrypoint, DONATIONS_CONFIG.entrypoint);
  assert.equal(opCall[2], DONATIONS_CONFIG.caip2);
});

test('a declined or unknown wallet outcome marks the op uncertain and never auto-retries', async () => {
  const client = mockClient();
  client.requestOperation = async () => { throw new Error('user rejected the request'); };
  const { controller } = make({ client });
  await controller.connect();
  controller.review('thanks', '10', true);
  await assert.rejects(() => controller.submit(true), /declined|unknown|uncertain/i);
  assert.equal(controller.model.uncertain, true);
  assert.equal(controller.model.hash, null);
  assert.equal(controller.model.busy, false);
});

test('a stale review (older than 120s) cannot be submitted', async () => {
  const { controller } = make();
  await controller.connect();
  controller.review('thanks', '10', true);
  controller.model.review.createdAt = Date.now() - 121_000; // backdate the review
  await assert.rejects(() => controller.submit(true), /fresh donation/);
  assert.equal(controller.model.hash, null);
});

test('disconnect clears the account, state, review and hash', async () => {
  const { controller } = make();
  await controller.connect();
  assert.ok(controller.model.account);
  await controller.disconnect();
  assert.equal(controller.model.account, null);
  assert.equal(controller.model.state, null);
  assert.equal(controller.model.review, null);
  assert.equal(controller.model.hash, null);
});
