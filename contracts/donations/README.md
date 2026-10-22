# XTZ donations collector

Original Michelson collector and offline regression suite for Sebuh.net. This is
contract source publication, **not a frontend release, audit certification or
Mainnet deployment**. The existing public site's build/deployment scripts and
wallet flow are unchanged. These files are not served as site assets.

## Contents and authority

- `src/build_contract.py`: deterministic Python text generator; it is not a
  SmartPy compiler and does not contact RPCs or sign operations.
- `contracts/donations.tz`: generated Michelson, included for inspection.
- `tests/`: four offline PyTezos test modules, 72 collected cases.
- `requirements.in`: direct pins; `requirements.lock`: pinned dependency snapshot.
- [CONTRACT_TESTING.md](CONTRACT_TESTING.md): invariants, evidence and open risks.
- [Historical evidence](evidence/shadownet-2026-10-21.json): selected sanitized
  report fields with source-report SHA-256 provenance, public addresses and hashes.

Only native XTZ is supported. No swaps, tokens, automatic payout, admin transfer
or upgrade mechanism. The administrator can redirect **all funds already held**,
then disburse the entire balance. Donating is an irrevocable gift, not staking,
a loan or an entitlement to rewards. Memos and sender addresses are public and
persistent; never put private information in a memo.

## Reproduce offline

From the repository root, use a dedicated Python 3.12 virtual environment:

```sh
cd contracts/donations
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.lock
python src/build_contract.py
sha256sum contracts/donations.tz
python -E -m pytest -q -p no:cacheprovider tests
```

The lock is a version-pinned snapshot, **not a hash-locked supply-chain guarantee**.
A clean installation and all operating-system/native-library combinations were
not revalidated during publication; PyTezos dependencies may need platform build
prerequisites. No GPU, AI model, paid API, wallet, faucet, signer or RPC is needed.
Do not copy deployment harnesses or wallet exports into this subtree.

Publication verification on October 22, 2026 reused an existing trusted Python
3.12.13 virtual environment with PyTezos 3.20.0 and pytest 8.4.2: build completed,
**72 passed in 44.56 seconds**, exit 0. No packages were installed and no network
simulation or transaction was performed in this publication pass. The commands
for building, hashing and testing were actually exercised against this copy;
new-venv creation/install commands above are reproduction guidance, not a claimed
fresh-install result. All installed package versions in the pinned snapshot
matched the existing environment (normalized package-name comparison). A second
clean run passed 72 cases in 44.57 seconds. An intervening attempt from an agent
Python subprocess failed collection because inherited Python search paths mixed
Python versions; `-E` ignores `PYTHON*` environment settings and the clean rerun
passed without changing contract code or dependencies.

Expected generated-file SHA-256:

```text
33942998afa182c28d500cf3ffa80119ee89861a5b81d14058454877bf97ac9c
```

For code/schema hashes, normalize comb pairs through PyTezos `ContractInterface`
before canonical JSON hashing. Hashing the raw parser output instead produces
different hashes despite equivalent comb-pair syntax:

```sh
python - <<'PY'
import hashlib, json
from pytezos import ContractInterface
code = ContractInterface.from_file('contracts/donations.tz').script()['code']
for name, value in [('code', code), ('parameter', code[0]), ('storage', code[1])]:
    encoded = json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    print(name, hashlib.sha256(encoded).hexdigest())
PY
```

Verified normalized hashes, matching the stored deployment report:

```text
code       60949207b13602cc984a51732b61f7a28cc8ac17c92ccc6eb3745c31636b8b62
parameter  d9540d27f6bdae9f3ca8e79a1df70305606775bb19834c274fedfc1b4b28ba9f
storage    e42f5e36792810906155fc47287a0b57c77e9ec21f23950174352a0e8de0d8c6
```

## Recorded deployment, not a current guarantee

Shadownet chain `NetXsqzbfFenSTS`, collector
`KT1Sgiad8uYnDQqpbG2Cc6G8DuDRvDRD6zXU`. Original applied origination:
`ooueiaBsRYcEGkPKxSSxnwaULNDaqUKPQtqKmwTy5B4f5AYZnkV`.
The October 21 reports record a correction from a fixture sink to test5,
`tz1gi7PyMEPKhH3p6hqHiTyzabudNE7aZWYV`, followed by five 1-XTZ donations
and an admin 5-XTZ payout. These are testnet acceptance operations, not real
browser-wallet acceptance or approval to receive Mainnet donations. Read the
pinned blocks and limitations before interpreting these results. No Mainnet
collector has been deployed by this work.

The source project's old `DESIGN.md` was checked and deliberately not copied:
its undeployed/no-origination status is stale against the recorded Shadownet
receipts. Current publication scope and limitations are stated here instead.
