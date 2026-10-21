// On-chain verification of the donation front-end wiring.
//
// It runs the ACTUAL shipped modules (readDonationState + buildDonationOp from
// src/donations-taquito.mjs) against a real node and sends the exact operation
// the front-end builds, signed by a local wallet. Point it at the canonical
// shadownet node by default (config.nodeRpcUrl); override with VERIFY_RPC /
// SHADOWNET_KEY / AMOUNT_XTZ as needed. Mainnet is never touched.
import { readFileSync } from 'node:fs';
import { TezosToolkit } from '@taquito/taquito';
import { InMemorySigner } from '@taquito/signer';
import { DONATIONS_CONFIG } from '../src/donations-config.mjs';
import { readDonationState, buildDonationOp, encodeMemo, setToolkitOverride } from '../src/donations-taquito.mjs';

const config = DONATIONS_CONFIG;
const keyPath = process.env.SHADOWNET_KEY || '/home/sebuh/shadownet-wallet/client/shadownet.key';
const rpc = process.env.VERIFY_RPC && process.env.VERIFY_RPC || config.nodeRpcUrl;

console.log('# donations front-end wiring verification');
console.log('node    :', rpc);
console.log('network :', config.network, config.chainId);
console.log('contract:', config.contractAddress);

const toolkit = new TezosToolkit();
toolkit.setProvider({ rpc, signer: await InMemorySigner.fromSecretKey(readFileSync(keyPath, 'utf8').trim()) });
console.log('wallet  :', toolkit.wallet.pkh);
const chainId = await toolkit.rpc.getChainId();
console.log('rpc chain_id:', chainId, '(expected', config.chainId + ')');
if (chainId !== config.chainId) throw new Error('RPC chain_id mismatch — refusing to send on the wrong network.');

// Route the shipped Taquito layer through this signed, local toolkit.
setToolkitOverride(toolkit);

const before = await readDonationState(config);
console.log('\nBEFORE  next_id=' + before.nextDonationId, 'total=' + before.totalDonatedMutez, 'donations=' + before.donations.length);

const memo = 'verify-' + Date.now();
const amountXTZ = process.env.AMOUNT_XTZ || '0.5';
const amountMutez = String(BigInt(Math.round(parseFloat(amountXTZ) * config.mutezPerTez)));
console.log('donating', amountMutez, 'mutez (' + amountXTZ + ' ꜩ), memo =', JSON.stringify(memo));

const op = await buildDonationOp({ config, memo, amountMutez });
console.log('built op:', JSON.stringify(op));
if (op.destination !== config.contractAddress) throw new Error('Built op destination does not match the configured contract.');
if (op.amount !== amountMutez) throw new Error('Built op amount does not match the requested mutez.');

// Send the EXACT op the front-end builds, signed by the local wallet.
const pkh = toolkit.wallet.pkh;
const response = await toolkit.wallet.transaction({ source: pkh, to: op.destination, amount: Number(op.amount), mutez: true, parameter: op.parameters });
await response.confirmation(1);
console.log('op hash :', response.hash, '— applied and confirmed');

const after = await readDonationState(config);
const newId = before.nextDonationId;
const entry = after.donations.find((d) => d.id === newId);
console.log('\nAFTER   next_id=' + after.nextDonationId, 'total=' + after.totalDonatedMutez, 'donations=' + after.donations.length);
console.log('recorded entry', JSON.stringify(entry));

const checks = {
  'next_donation_id incremented': after.nextDonationId === before.nextDonationId + 1,
  'total_donated increased by the amount': after.totalDonatedMutez === String(BigInt(before.totalDonatedMutez) + BigInt(amountMutez)),
  'big-map entry present at the new id': Boolean(entry),
  'memo round-trips exactly (hex -> utf8)': Boolean(entry) && entry.memo === encodeMemo(memo) && entry.memoText === memo,
  'sender is the verifying wallet': Boolean(entry) && entry.sender === pkh,
};
console.log('\nchecks:');
for (const [name, ok] of Object.entries(checks)) console.log((ok ? '  PASS  ' : '  FAIL  ') + name);
if (Object.values(checks).some((v) => !v)) {
  console.error('RESULT: FAILED — the front-end op did not land as expected.');
  process.exit(1);
}
console.log('RESULT: donations front-end wiring verified end-to-end on-chain.');
