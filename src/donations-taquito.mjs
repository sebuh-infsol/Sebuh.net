import { TezosToolkit } from '@taquito/taquito';
import { DONATIONS_CONFIG } from './donations-config.mjs';

// The Taquito layer is the single on-chain boundary of the donation app.
// It reads the donations contract and builds the `donate` operation parameter
// using the contract's real Michelson ABI (via toTransferParams). Signing and
// injection are NOT done here — that is the job of the connected octez.connect
// wallet (see donations-controller.mjs). This split is what "wires Taquito to
// the front-end": Taquito = read + encode, octez.connect = sign + inject.
//
// On-chain the `bytes` parameter travels base58-encoded; the front-end <->
// Taquito boundary uses hex (Taquito's michelson-encoder maps hex -> base58).
// Taquito's internal use of Buffer is covered by the build's buffer-shim; the
// codec below is Buffer-free (TextEncoder/TextDecoder) so it runs anywhere.

let toolkitOverride = null;
// Test hook: point makeTaquito() at a stub toolkit so the real read/encode
// code can be exercised without a network.
export function setToolkitOverride(toolkit) {
  toolkitOverride = toolkit ?? null;
}

export function makeTaquito(config = DONATIONS_CONFIG) {
  if (toolkitOverride) return toolkitOverride;
  const toolkit = new TezosToolkit();
  toolkit.setProvider({ rpc: config.rpcUrl });
  return toolkit;
}

// --- memo codec (the contract stores memos as raw `bytes`) ----------------
export function encodeMemo(memo) {
  if (typeof memo !== 'string') throw new Error('Donation memo must be a string.');
  if (memo.length > 100) throw new Error('Donation memo must be at most 100 characters.');
  if (memo.length === 0) return '';
  let hex = '';
  for (const byte of new TextEncoder().encode(memo)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
export function decodeMemo(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  if (hex.length === 0) return '';
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

// --- amount parsing (UI text -> mutez string) ------------------------------
export function parseMutez(text) {
  if (typeof text !== 'string' || !/^[0-9]+(?:\.[0-9]{1,6})?$/.test(text)) throw new Error('Enter a positive XTZ amount with at most six decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const mutez = (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))).toString();
  if (mutez === '0' || mutez.length > 20) throw new Error('Donation amount must be positive and at most 20 mutez digits.');
  return mutez;
}

const toNumber = (value) => (value != null && typeof value.toNumber === 'function' ? value.toNumber() : Number(value ?? 0));

// Reject accidental wrong-chain RPCs before reading or encoding a contract.
async function verifyRpcChain(toolkit, config) {
  if (typeof toolkit.rpc?.getChainId !== 'function') throw new Error('RPC chain ID method is unavailable.');
  const chainId = await toolkit.rpc.getChainId();
  if (typeof chainId !== 'string' || chainId.length === 0 || chainId !== config.chainId) throw new Error('RPC chain ID does not match the configured donation chain.');
  return chainId;
}

// --- contract read ----------------------------------------------------------
export async function readDonationState(config = DONATIONS_CONFIG) {
  const toolkit = makeTaquito(config);
  const chainId = await verifyRpcChain(toolkit, config);
  const contract = await toolkit.contract.at(config.contractAddress);
  const storage = await contract.storage();
  const count = toNumber(storage.next_donation_id);
  const donations = [];
  for (let id = 0; id < count; id++) {
    try {
      const entry = await storage.donations.get(id);
      if (!entry) continue;
      const memoHex = entry.memo ?? '';
      donations.push({
        id,
        sender: entry.sender ?? null,
        amountMutez: String(entry.amount ?? 0),
        timestamp: entry.timestamp ?? null,
        level: entry.level != null ? String(entry.level) : null,
        memo: memoHex,
        memoText: decodeMemo(memoHex) ?? '(unreadable memo)',
      });
    } catch {
      // A gap in the big-map id sequence is not expected; skip rather than fail.
    }
  }
  return {
    network: config.network,
    chainId,
    contractAddress: config.contractAddress,
    nextDonationId: count,
    totalDonatedMutez: String(storage.total_donated ?? 0),
    totalDisbursedMutez: String(storage.total_disbursed ?? 0),
    recipient: storage.donation_recipient ?? null,
    selectedBaker: storage.selected_baker ?? null,
    donations,
  };
}

// --- operation build --------------------------------------------------------
// Returns a canonical Tezos contract-call transaction ready to wrap in
// octez.connect's operationDetails (the caller adds `source`). `value` comes
// straight from Taquito's ABI encoding so it always matches the contract.
export async function buildDonationOp({ config = DONATIONS_CONFIG, memo, amountMutez } = {}) {
  if (!config || typeof config.contractAddress !== 'string') throw new Error('Donation contract address is not configured.');
  if (typeof amountMutez !== 'string' || !/^[1-9][0-9]*$/.test(amountMutez)) throw new Error('Donation amount must be a positive integer of mutez.');
  if (BigInt(amountMutez) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Donation mutez amount exceeds the safe integer Number boundary.');
  const hex = encodeMemo(memo);
  const toolkit = makeTaquito(config);
  await verifyRpcChain(toolkit, config);
  const contract = await toolkit.contract.at(config.contractAddress);
  const entrypoint = contract.methodsObject?.[config.entrypoint];
  if (typeof entrypoint !== 'function') throw new Error('The donation contract on this network does not expose a "' + config.entrypoint + '" entrypoint.');
  const params = await entrypoint(hex).toTransferParams({ amount: Number(amountMutez), mutez: true });
  if (!params.parameter || typeof params.parameter.value !== 'object' || params.parameter.value === null) throw new Error('Could not encode the donation parameter.');
  return {
    kind: 'transaction',
    destination: config.contractAddress,
    amount: String(params.amount ?? amountMutez),
    parameters: { entrypoint: config.entrypoint, value: params.parameter.value },
  };
}

// RPC getBalance is the spendable balance; staking balances are excluded.
export async function readSpendableBalance(address, config = DONATIONS_CONFIG) {
  const balance = await makeTaquito(config).rpc.getBalance(address);
  return { address, balance: balance.toString(), observedAt: Date.now() };
}
