import test from 'node:test';
import assert from 'node:assert/strict';
import {readDonationState, buildDonationOp, setToolkitOverride} from '../src/donations-taquito.mjs';
import {createDonationsController} from '../src/donations-controller.mjs';
import {DONATIONS_CONFIG as config} from '../src/donations-config.mjs';

function fixture() {
  const calls = {lookup: 0, build: 0, permissions: 0, operations: 0};
  const contract = {
    async storage() { return {donation_recipient: config.expectedRecipient}; },
    methodsObject: {donate: hex => ({toTransferParams() {
      calls.build++;
      return {parameter: {value: {bytes: hex}}};
    }})},
  };
  const toolkit = {rpc: {async getChainId() {return config.chainId;}}, contract: {async at() {calls.lookup++; return contract;}}};
  const client = {
    async requestPermissions(input) {calls.permissions++; assert.deepEqual(input.scopes, ['operation_request']);},
    async getActiveAccount() {return {address: 'tz1-fixture', network: {type: config.network, chainId: config.caip2}, scopes: ['operation_request']};},
    async requestOperation() {calls.operations++; throw Error('must not request operation');},
  };
  setToolkitOverride(toolkit);
  return {calls, toolkit, contract, controller: createDonationsController({client, config})};
}
const boundaries = {
  read: () => readDonationState(config),
  build: () => buildDonationOp({config, memo: 'test', amountMutez: '1000000'}),
};

// First regression: real reader previously accepted this RPC and self-asserted config.chainId.
test('read rejects RPC chain mismatch before contract lookup', async () => {
  const h = fixture();
  h.toolkit.rpc.getChainId = async () => 'NetXdQprcVkpaWU';
  try {
    await assert.rejects(boundaries.read, /chain/i);
    assert.equal(h.calls.lookup, 0);
  } finally {setToolkitOverride(null);}
});

for (const [name, invoke] of Object.entries(boundaries)) {
  for (const [label, rpc] of [
    ['mismatch', {getChainId: async () => 'NetXdQprcVkpaWU'}],
    ['missing RPC', undefined], ['missing method', {}],
    ['missing value', {getChainId: async () => undefined}],
    ['null', {getChainId: async () => null}],
    ['empty', {getChainId: async () => ''}],
    ['non-string', {getChainId: async () => 123}],
    ['boxed string', {getChainId: async () => new String(config.chainId)}],
    ['whitespace suffix', {getChainId: async () => config.chainId + ' '}],
    ['rejected', {getChainId: async () => {throw Error('chain read rejected');}}],
  ]) test(`${name} fails closed: ${label}`, async () => {
    const h = fixture(); h.toolkit.rpc = rpc;
    try {
      await assert.rejects(invoke);
      assert.equal(h.calls.lookup, 0);
      assert.equal(h.calls.build, 0);
    } finally {setToolkitOverride(null);}
  });
  test(`${name} awaits matching RPC before contract access`, async () => {
    const h = fixture(); let resolve;
    h.toolkit.rpc.getChainId = () => new Promise(r => {resolve = r;});
    try {
      const pending = invoke();
      await Promise.resolve();
      assert.equal(h.calls.lookup, 0);
      resolve(config.chainId);
      const result = await pending;
      assert.equal(h.calls.lookup, 1);
      if (name === 'read') assert.equal(result.chainId, config.chainId);
      else assert.equal(h.calls.build, 1);
    } finally {setToolkitOverride(null);}
  });
}

for (const phase of ['review', 'before build', 'build', 'after build']) {
  for (const failure of ['mismatch', 'rejection', 'contract error']) {
    test(`controller + real Taquito invalidates review on ${phase} ${failure}`, async () => {
      const h = fixture();
      try {
        await h.controller.connect();
        await h.controller.review('test', '1', true);
        assert.ok(h.controller.model.review);
        let reads = 0;
        const failAt = {'review': 1, 'before build': 1, 'build': 2, 'after build': 3}[phase];
        h.toolkit.rpc.getChainId = async () => {
          reads++;
          if (reads === failAt) {
            if (failure === 'mismatch') return 'NetXdQprcVkpaWU';
            if (failure === 'rejection') throw Error('chain read rejected');
          }
          return config.chainId;
        };
        const originalAt = h.toolkit.contract.at;
        h.toolkit.contract.at = async () => {
          if (failure === 'contract error' && reads === failAt) throw Error('contract unavailable');
          return originalAt();
        };
        await assert.rejects(phase === 'review' ? h.controller.review('test', '1', true) : h.controller.submit(true));
        assert.equal(h.calls.operations, 0);
        assert.equal(h.controller.model.review, null);
        assert.equal(h.controller.model.state, null);
        assert.equal(h.controller.model.account, null);
        assert.equal(h.controller.model.busy, false);
        assert.ok(h.controller.model.error);
      } finally {setToolkitOverride(null);}
    });
  }
}

test('permission-only pairing remains allowed before RPC failure', async () => {
  const h = fixture(); h.toolkit.rpc.getChainId = async () => 'wrong';
  try {
    await assert.rejects(h.controller.connect(), /chain/i);
    assert.equal(h.calls.permissions, 1);
    assert.equal(h.calls.operations, 0);
  } finally {setToolkitOverride(null);}
});

test('read returns the observed chain ID rather than config at return time', async () => {
  const h = fixture(); const mutable = {...config};
  h.contract.storage = async () => {mutable.chainId = 'changed-after-check'; return {};};
  try {
    const state = await readDonationState(mutable);
    assert.equal(state.chainId, config.chainId);
  } finally {setToolkitOverride(null);}
});

for (const failure of ['storage read', 'parameter build']) test(`controller + real Taquito invalidates on ${failure} error`, async () => {
  const h = fixture();
  try {
    await h.controller.connect();
    await h.controller.review('test', '1', true);
    if (failure === 'storage read') h.contract.storage = async () => {throw Error('storage read failed');};
    else h.contract.methodsObject.donate = () => ({toTransferParams() {throw Error('parameter build failed');}});
    await assert.rejects(h.controller.submit(true), /failed/);
    assert.equal(h.calls.operations, 0);
    assert.equal(h.controller.model.review, null);
    assert.equal(h.controller.model.state, null);
    assert.equal(h.controller.model.account, null);
  } finally {setToolkitOverride(null);}
});
