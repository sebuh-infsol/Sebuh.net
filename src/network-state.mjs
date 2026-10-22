// One explicit selected-network state for the whole site. Every wallet
// connection and every displayed network reads from here.
//
// GLOBAL DEFAULT: mainnet. This preserves legacy behaviour (mainnet delegation
// and direct gifts) for visitors who never touch the selector. Mainnet contract
// donations stay fail-closed while DONATIONS_NETWORKS.mainnet.contractAddress
// is null. Selecting a network never pairs, requests permissions or signs.
import { DONATIONS_NETWORKS } from './donations-config.mjs';

export const GLOBAL_DEFAULT_NETWORK = 'mainnet';

// Browser-safe view of a registry entry: the private nodeRpcUrl is stripped.
function publicEntry(name) {
  const { nodeRpcUrl, ...rest } = DONATIONS_NETWORKS[name];
  return Object.freeze(rest);
}

export function createNetworkState(initial = GLOBAL_DEFAULT_NETWORK) {
  if (!DONATIONS_NETWORKS[initial]) throw new Error(`unknown network: ${initial}`);
  let current = initial;
  let epoch = 0;
  let busy = null;
  const listeners = new Set();
  const guards = new Set();
  const pairings = new Map();
  const sessionListeners = new Set();

  return {
    selected: () => publicEntry(current),
    setPairing(name, route) { pairings.set(name, route); for (const fn of sessionListeners) fn(); },
    pairing: () => pairings.get(current),
    onSession(fn) { sessionListeners.add(fn); return () => sessionListeners.delete(fn); },
    sessionChanged() { for (const fn of sessionListeners) fn(); },
    epoch: () => epoch,
    isCurrent: (e) => e === epoch,
    setBusy(state) {
      busy = state === 'pending' || state === 'uncertain' ? state : null;
    },
    matchesChain: (chainId) => chainId === DONATIONS_NETWORKS[current].chainId,
    // Legacy delegation/direct gifts target mainnet-only public endpoints.
    legacyAllowed: () => current === 'mainnet',
    addGuard(fn) {
      guards.add(fn);
      return () => guards.delete(fn);
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    select(name) {
      if (!DONATIONS_NETWORKS[name]) throw new Error(`unknown network: ${name}`);
      if (busy) throw new Error(`cannot switch network while an operation is ${busy}`);
      // Guards veto before any state changes; a truthy return is the reason.
      for (const guard of guards) {
        const reason = guard(name);
        if (reason) throw new Error(`cannot switch network: ${reason}`);
      }
      if (name === current) return;
      current = name;
      epoch += 1;
      const entry = publicEntry(name);
      for (const fn of listeners) fn(entry);
    },
  };
}

// The ONE shared instance: wallet-ui and donations-boot both import this.
export const networkState = createNetworkState();
