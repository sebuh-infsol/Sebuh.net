import { DONATIONS_CONFIG } from './donations-config.mjs';
import { buildDonationOp, readDonationState, encodeMemo, parseMutez } from './donations-taquito.mjs';

// The front-end controller for the contract donation app. It is the seam that
// "wires Taquito to the front-end": Taquito reads the live contract and encodes
// the `donate` operation; the connected octez.connect wallet signs and injects
// it. The flow mirrors the mainnet delegation controller (same connect /
// review / submit gates and no-auto-retry posture) but validates a shadownet,
// operation-only wallet account.
export function createDonationsController({
  client,
  config = DONATIONS_CONFIG,
  loadState = () => readDonationState(config),
  buildOp = ({ memo, amountMutez }) => buildDonationOp({ config, memo, amountMutez }),
  onChange = () => {},
} = {}) {
  const model = { account: null, state: null, review: null, busy: false, hash: null, error: null, uncertain: false };
  const emit = () => onChange(model);
  let binding = null;

  function account(a) {
    if (!a || a.network?.type !== config.network) throw new Error('Connect a ' + config.network + ' wallet to donate to the contract.');
    if (!Array.isArray(a.scopes) || a.scopes.length !== 1 || a.scopes[0] !== 'operation_request') throw new Error('An operation-only wallet connection is required.');
    return { address: a.address, network: { type: a.network.type }, scopes: [...a.scopes] };
  }
  function same(a, b) {
    if (!a || !b || a.address !== b.address || a.network.type !== b.network.type) throw new Error('Wallet account changed. Disconnect, reconnect and review again.');
  }
  async function run(work) {
    if (model.busy) throw new Error('A wallet action is already pending.');
    model.busy = true; model.error = null; emit();
    try { return await work(); }
    catch (e) { model.error = e?.message ? e.message : String(e); model.review = null; binding = null; emit(); throw e; }
    finally { model.busy = false; emit(); }
  }

  return {
    get model() { return model; },
    connect: () => run(async () => {
      await client.requestPermissions({ scopes: ['operation_request'] });
      model.account = account(await client.getActiveAccount());
      model.state = await loadState();
      same(model.account, account(await client.getActiveAccount()));
      model.review = null; model.hash = null; model.uncertain = false;
    }),
    refresh: () => run(async () => {
      const active = account(await client.getActiveAccount());
      same(model.account, active);
      model.state = await loadState(); model.review = null; binding = null;
    }),
    review: (memo, amountXTZ, acknowledged) => {
      if (model.busy || model.uncertain || model.hash) throw new Error('Resolve the pending wallet operation before another request.');
      if (acknowledged !== true) throw new Error('Acknowledge the gift and review the donation first.');
      if (!model.account) throw new Error('Connect a ' + config.network + ' wallet first.');
      const amountMutez = parseMutez(amountXTZ);
      const memoHex = encodeMemo(memo);
      const whole = BigInt(amountMutez) / BigInt(config.mutezPerTez);
      const fraction = (BigInt(amountMutez) % BigInt(config.mutezPerTez)).toString().padStart(6, '0').replace(/0+$/, '');
      model.review = { source: model.account.address, destination: config.contractAddress, amountXTZ: whole.toString() + (fraction ? '.' + fraction : ''), amountMutez, memo, memoHex, createdAt: Date.now() };
      binding = { ...model.review };
      model.error = null; emit();
    },
    cancelReview: () => { model.review = null; binding = null; emit(); },
    submit: (acknowledged) => run(async () => {
      if (acknowledged !== true) throw new Error('Acknowledge the gift and review the donation first.');
      if (!model.review || model.uncertain || model.hash || Date.now() - model.review.createdAt > 120000) throw new Error('Review a fresh donation before requesting wallet approval.');
      const expected = model.review;
      const active = account(await client.getActiveAccount());
      same(model.account, active);
      // Re-read live contract state, then rebuild the op from the frozen
      // reviewed values so a stale review or a changed contract can't slip through.
      model.state = await loadState();
      const op = await buildOp({ memo: expected.memo, amountMutez: expected.amountMutez });
      if (model.review !== expected || !binding ||
        Object.keys(binding).some((key) => expected[key] !== binding[key]) ||
        active.address !== binding.source || expected.destination !== config.contractAddress ||
        Date.now() - binding.createdAt > 120000 || binding.createdAt > Date.now()) throw new Error('Review a fresh donation before requesting wallet approval.');
      try {
        // One deliberate wallet request. NEVER automatically retry this call.
        const response = await client.requestOperation({ operationDetails: [{ kind: 'transaction', source: active.address, ...op }], network: config.caip2 });
        if (typeof response?.transactionHash !== 'string' || !/^o[1-9A-HJ-NP-Za-km-z]{50}$/.test(response.transactionHash)) throw new Error('No usable operation hash');
        model.hash = response.transactionHash; model.review = null; binding = null;
      } catch {
        model.uncertain = true;
        throw new Error('Wallet request was declined or its outcome is unknown. Check your wallet and explorer before reconnecting or trying again. No automatic retry will occur.');
      }
    }),
    disconnect: () => run(async () => {
      await client.disconnect();
      model.account = null; model.state = null; model.review = null; model.hash = null; model.uncertain = false; binding = null;
    }),
  };
}
