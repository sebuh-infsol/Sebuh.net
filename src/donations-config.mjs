// Single source of truth for the contract-based donation app.
//
// Every network the donation app can target lives in DONATIONS_NETWORKS. The
// UI renders a Shadownet/Mainnet switch backed by this registry. Flipping the
// mainnet entry live later is a ONE-FILE edit: set `contractAddress` to the
// mainnet KT1 (and optionally change DEFAULT_DONATIONS_NETWORK) — no other
// code changes are required. While `contractAddress` is null the UI shows an
// honest fail-closed "not deployed yet" state with every control disabled.
//
// INVARIANT (enforced by test/donations-csp.test.mjs): the origin of every
// https `rpcUrl` below must be listed in the connect-src directive of
// site/_headers, or the browser will block the RPC in production.
//
// This module is deliberately separate from the mainnet delegation flow
// (delegation-core.mjs), which stays mainnet-hardcoded and is untouched.
export const DONATIONS_NETWORKS = {
  shadownet: {
    network: 'shadownet',
    submissionPolicy: 'verified-testnet',
    expectedRecipient: 'tz1gi7PyMEPKhH3p6hqHiTyzabudNE7aZWYV',
    submissionDisabledReason: 'Connect and refresh Shadownet storage to verify the approved test5 beneficiary before reviewing a testnet donation.',
    explorerUrl: 'https://shadownet.tzkt.io/',
    chainId: 'NetXsqzbfFenSTS',
    // CAIP-2 id used to target this network for a wallet operation.
    caip2: 'tezos:NetXsqzbfFenSTS',
    // Browser-reachable RPC used for live contract reads and operation building.
    // The public shadownet endpoint tracks the canonical node; swap in any
    // trusted shadownet node URL here for lower latency.
    rpcUrl: 'https://rpc.shadownet.teztnets.com',
    // Authoritative local node, used only by node-side tooling
    // (scripts/verify-donations.mjs). It is never reachable from the browser.
    nodeRpcUrl: 'http://127.0.0.1:18732',
    // The shadownet deployment of contracts/donations.tz.
    contractAddress: 'KT1Sgiad8uYnDQqpbG2Cc6G8DuDRvDRD6zXU',
    // The contract entrypoint the "give" action calls.
    entrypoint: 'donate',
    mutezPerTez: 1_000_000,
    label: 'Shadownet testnet',
    // Honest-badge flag: testnet tez have no real-world value.
    realValue: false,
  },
  mainnet: {
    network: 'mainnet',
    submissionPolicy: 'disabled-undeployed',
    explorerUrl: 'https://tzkt.io/',
    chainId: 'NetXdQprcVkpaWU',
    caip2: 'tezos:NetXdQprcVkpaWU',
    rpcUrl: 'https://rpc.tzkt.io/mainnet',
    // The donations contract is NOT deployed on mainnet yet. null keeps the
    // app fail-closed (controls disabled, honest copy) until a real KT1 is
    // pasted here.
    contractAddress: null,
    entrypoint: 'donate',
    mutezPerTez: 1_000_000,
    label: 'Mainnet',
    // Honest-badge flag: mainnet tez are real funds.
    realValue: true,
  },
};

// The network the app starts on before the visitor touches the switch.
export const DEFAULT_DONATIONS_NETWORK = 'shadownet';

// Compatibility export: pre-switch modules and tooling import the singleton
// DONATIONS_CONFIG. It is exactly the default network's entry.
export const DONATIONS_CONFIG = DONATIONS_NETWORKS[DEFAULT_DONATIONS_NETWORK];
