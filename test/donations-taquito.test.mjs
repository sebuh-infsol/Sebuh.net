import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeMemo, decodeMemo, parseMutez, buildDonationOp, readDonationState, setToolkitOverride } from '../src/donations-taquito.mjs';

const CONFIG = {
  network: 'shadownet',
  chainId: 'NetXsqzbfFenSTS',
  caip2: 'tezos:NetXsqzbfFenSTS',
  rpcUrl: 'https://rpc.example',
  nodeRpcUrl: 'http://127.0.0.1:18732',
  contractAddress: 'KT1-fixture-contract',
  entrypoint: 'donate',
  mutezPerTez: 1_000_000,
};

// Stub toolkit that mimics exactly the Taquito v25 surface the shipped module
// uses (contract.at / methodsObject / storage / toTransferParams) so the real
// code runs with no network. `methodsObject` can be overridden per case.
function makeStubToolkit({ isMultiple = true, entrypoints = DONATE_ENTRYPOINTS, storage = {}, interaction, methodsObject }) {
  const contract = {
    address: CONFIG.contractAddress,
    parameterSchema: { isMultipleEntryPoint: isMultiple },
    entrypoints: isMultiple ? entrypoints : 'donate',
    async storage() { return storage; },
    methodsObject: methodsObject || { donate: (hex) => ({ toTransferParams: (opts) => interaction(hex, opts) }) },
  };
  return { contract: { at: async () => contract }, wallet: { pkh: 'tz1-stub' } };
}

const DONATE_ENTRYPOINTS = { donate: { arguments: [{ name: 'memo', type: { prim: 'bytes' } }] } };

// Real Taquito returns BigNumber-like values from contract storage. The shipped
// reader calls `.toNumber()` on next_donation_id but `String(value)` on the
// total fields (which invokes `toString()`), so the stub needs both methods.
const bn = (n) => ({ toNumber: () => n, toString: () => String(n) });

test('memo codec round-trips utf8 <-> hex (incl. unicode), allows empty, rejects over-long', () => {
  assert.equal(encodeMemo('hello'), '68656c6c6f');
  assert.equal(decodeMemo('68656c6c6f'), 'hello');
  assert.equal(decodeMemo(encodeMemo('héllo ☃ → 123')), 'héllo ☃ → 123');
  assert.equal(encodeMemo(''), '');
  assert.equal(decodeMemo(''), '');
  assert.throws(() => encodeMemo('a'.repeat(101)));
  assert.throws(() => encodeMemo(42));
});

test('parseMutez converts an XTZ text amount to mutez and rejects malformed input', () => {
  assert.equal(parseMutez('10'), '10000000');
  assert.equal(parseMutez('1.5'), '1500000');
  assert.equal(parseMutez('0.000001'), '1');
  assert.throws(() => parseMutez(''));
  assert.throws(() => parseMutez('0'));
  assert.throws(() => parseMutez('-1'));
  assert.throws(() => parseMutez('1.1234567'));
  assert.throws(() => parseMutez('abc'));
});

test('buildDonationOp emits an octez transaction whose parameter is a hex donate(bytes)', async () => {
  const stub = makeStubToolkit({
    isMultiple: true,
    entrypoints: DONATE_ENTRYPOINTS,
    storage: {},
    interaction: (hex, opts) => ({ to: CONFIG.contractAddress, amount: opts.amount, parameter: { entrypoint: 'donate', value: { bytes: hex } } }),
  });
  setToolkitOverride(stub);
  try {
    const op = await buildDonationOp({ config: CONFIG, memo: 'gofundsebuh', amountMutez: '2500000' });
    assert.equal(op.kind, 'transaction');
    assert.equal(op.destination, CONFIG.contractAddress);
    assert.equal(op.amount, '2500000');
    assert.equal(op.parameters.entrypoint, 'donate');
    assert.equal(decodeMemo(op.parameters.value.bytes), 'gofundsebuh');
  } finally { setToolkitOverride(null); }
});

test('buildDonationOp falls back to the single default entrypoint when the schema is not multi-entrypoint', async () => {
  const stub = makeStubToolkit({
    isMultiple: false,
    entrypoints: 'donate',
    storage: {},
    interaction: (hex, opts) => ({ to: CONFIG.contractAddress, amount: opts.amount, parameter: { value: { bytes: hex } } }),
  });
  setToolkitOverride(stub);
  try {
    const op = await buildDonationOp({ config: CONFIG, memo: 'x', amountMutez: '1000' });
    assert.equal(op.parameters.entrypoint, 'donate');
    assert.equal(op.kind, 'transaction');
    assert.equal(decodeMemo(op.parameters.value.bytes), 'x');
  } finally { setToolkitOverride(null); }
});

test('buildDonationOp guards the contract surface: no donate method, or an unusable encoded parameter', async () => {
  // No donate method at all -> the entrypoint guard fires.
  const noMethod = makeStubToolkit({ storage: {}, interaction: () => ({}), methodsObject: {} });
  setToolkitOverride(noMethod);
  try {
    await assert.rejects(() => buildDonationOp({ config: CONFIG, memo: 'x', amountMutez: '1000' }), /entrypoint/);
  } finally { setToolkitOverride(null); }

  // donate exists but the ABI encoding yields a non-object parameter value.
  const badParam = makeStubToolkit({
    interaction: () => ({ to: CONFIG.contractAddress, amount: 1000, parameter: { entrypoint: 'donate', value: 'not-an-object' } }),
  });
  setToolkitOverride(badParam);
  try {
    await assert.rejects(() => buildDonationOp({ config: CONFIG, memo: 'x', amountMutez: '1000' }), /parameter/);
  } finally { setToolkitOverride(null); }
});

test('readDonationState reads storage, totals and the per-donor big map with memos decoded', async () => {
  const hexA = encodeMemo('thanks');
  const stub = makeStubToolkit({
    isMultiple: true, entrypoints: DONATE_ENTRYPOINTS,
    storage: {
      admin: 'tz1-admin',
      donation_recipient: 'tz1-recipient',
      selected_baker: 'tz2-baker',
      next_donation_id: bn(2),
      total_donated: bn(2_500_000),
      total_disbursed: bn(1_000_000),
      donations: { get: (k) => (k === 0 ? { sender: 'tz1-donor-a', amount: 1_000_000, timestamp: 1_739_000_000, level: 100, memo: hexA } : undefined) },
    },
    interaction: () => ({}),
  });
  setToolkitOverride(stub);
  try {
    const state = await readDonationState(CONFIG);
    assert.equal(state.nextDonationId, 2);
    assert.equal(state.totalDonatedMutez, '2500000');
    assert.equal(state.totalDisbursedMutez, '1000000');
    assert.equal(state.selectedBaker, 'tz2-baker');
    assert.equal(state.recipient, 'tz1-recipient');
    assert.equal(state.donations.length, 1);
    assert.equal(state.donations[0].id, 0);
    assert.equal(state.donations[0].sender, 'tz1-donor-a');
    assert.equal(state.donations[0].amountMutez, '1000000');
    assert.equal(state.donations[0].memo, hexA);
    assert.equal(state.donations[0].memoText, 'thanks');
  } finally { setToolkitOverride(null); }
});

test('readDonationState throws when the contract storage cannot be read', async () => {
  const stub = makeStubToolkit({ isMultiple: true, entrypoints: DONATE_ENTRYPOINTS, storage: undefined, interaction: () => ({}) });
  stub.contract.at = async () => ({
    address: CONFIG.contractAddress,
    parameterSchema: { isMultipleEntryPoint: true },
    entrypoints: DONATE_ENTRYPOINTS,
    async storage() { throw new Error('contract not found'); },
    methodsObject: {},
  });
  setToolkitOverride(stub);
  try {
    await assert.rejects(() => readDonationState(CONFIG), /contract not found/);
  } finally { setToolkitOverride(null); }
});
