# Contract testing and audit-evidence boundaries

**Not an independent professional audit or formal verification.** This document
separates executable offline regressions, historical unsigned protocol simulation,
and historical applied testnet receipts. It does not certify the contract, the
old on-chain harness, the website, or an end-to-end wallet flow. Evidence below
comes from stored October 21, 2026 reports; publication reran only the copied
72-case offline suite and deterministic build on October 22, 2026.

## Exact contract interface and invariants

Preserve case and the intentional historical misspelling `dispurse_donations`.

| Entrypoint | Parameter | Required behavior |
| --- | --- | --- |
| `donate` | `bytes` | Strict UTF-8 memo, positive attached mutez; append one record, increment ID and lifetime donated total; emit no operations. |
| `Update_donation_routing` | `address` | Admin only, no attached tez; reject self aliases and non-unit-compatible recipients; change recipient only, including routing of existing funds. |
| `dispurse_donations` | `unit` | Admin only, no attached tez, positive actual balance; reject stored self aliases/non-unit recipients; emit one full-balance Unit transfer; increment lifetime disbursed total. |
| `set_baker` | `option key_hash` | Admin only, no attached tez; update selected baker and emit `SET_DELEGATE`; `None` clears delegation. This is not staking or guaranteed delegate registration. |

The nested `or` parameter has an implicit `default` surface in PyTezos, not an
ordinary default-Unit donation API. Use `%donate` with UTF-8 bytes. The included
JSON records full normalized parameter/storage schemas.

Authorization is **immediate `SENDER == admin`**, never `SOURCE == admin`.
Offline cases vary sender and source independently: a non-admin intermediary
fails even when the original source is admin; an admin sender with another
source is accepted. Native `run_code` uses the historical helper's `source`
field for SENDER and `payer` for SOURCE; supplied identities are simulation
context, not authenticated signatures.

Storage fields: `admin`, `donation_recipient`, `selected_baker`,
`next_donation_id`, `donations`, `total_donated`, `total_disbursed`.
The donations big-map is keyed by consecutive natural-number IDs and stores
immediate sender, exact mutez amount, block timestamp, level and exact memo
bytes. IDs encode execution order even when block/time match. Administrative
calls preserve history and counters except the specific intended fields;
payout never deletes receipts. A big-map is not intrinsically enumerable.
Lifetime totals are unbounded `nat` counts of mutez, tested beyond signed
64-bit bounds and at `2**100 + 123`; individual transfers remain `mutez`.
`total_donated` is not current balance. Payout uses actual `BALANCE`, potentially
including funds not logged through donate, so totals need not be equal.

Memo limits are **0–512 Unicode code points and at most 2048 bytes**, not
512 graphemes, UTF-16 units or bytes. Empty memo is allowed with a positive
amount. Strict decoding rejects isolated continuation bytes, overlong encodings,
surrogates, code points above U+10FFFF and incomplete sequences. Tests include
511/512/513 boundaries, four-byte characters, NUL, exact byte preservation and
seeded bounded differential fuzzing against Python's strict UTF-8 decoder.
Failures include `MEMO_BYTES`, `MEMO_CODEPOINTS`, `MEMO_UTF8`,
`MEMO_TRUNCATED`; defensive internal checks include `MEMO_SLICE` and `MEMO_STATE`.

Financial/permission failures include `ZERO_DONATION`, `NOT_ADMIN`,
`ADMIN_AMOUNT`, `ZERO_BALANCE`, `SELF_RECIPIENT`, `BAD_RECIPIENT` and the
defensive conversion failure `MUTEZ_TO_NAT`. Routing and payout check both
self/default and self `%dispurse_donations` aliases; external compatible Unit
entrypoints remain allowed. Unit compatibility does **not** establish beneficiary
intent, withdrawability, economic safety or callback safety.

## Copied suite actually rerun

See [README reproduction commands](README.md#reproduce-offline). Python 3.12.13,
PyTezos 3.20.0, pytest 8.4.2; **72 passed in 44.56s, exit 0** on the publication
copy. Generator output matched the included Michelson byte-for-byte and its
file/code/parameter/storage-schema hashes matched the historical report using
`ContractInterface.script()['code']` normalization. Raw parser comb-pair syntax
is not the canonical representation used by that report.

| Module | Coverage |
| --- | --- |
| `tests/test_contract.py` | Donation append; full payout operation; routing; delegation emission. |
| `tests/test_security.py` | Sender/source authorization; attached-tez and zero/funds checks; populated history across admin calls; failed caller-fixture preservation; exact interface and generated artifact. |
| `tests/test_review_fixes.py` | Unbounded lifetime counters; populated transitions; self-alias defenses; external Unit routing. |
| `tests/test_utf8.py` | Invalid encodings and resource limits; exact Unicode preservation; seeded reference differential tests. |

Important emulator qualification: selected `test_review_fixes.py` cases monkeypatch
PyTezos 3.20's `ADDRESS` opcode to preserve a contract entrypoint suffix. The
fixture is scoped to those tests and documented in source. It is not proof that
the unmodified interpreter models all protocol behavior. Historical unsigned
native checks separately covered aliases and Unit compatibility. An unchanged
Python fixture after an exception is not proof of applied-chain rollback.

## Historical evidence inventory (do not sum overlapping runs)

`evidence/shadownet-2026-10-21.json` contains selected fields and SHA-256 hashes
of the source reports. It is a sanitized summary, not the complete raw RPC
transcripts or a self-contained replacement for all historical verifiers.

| Evidence source | Reported result | Boundary |
| --- | --- | --- |
| `contract-verification-report.json` | 72 offline; native typecheck; 40 unsigned native cases; 8 deployed-code/storage cases | Simulated, not signed/applied. Positive storage simulations may supply synthetic 1-mutez balance. |
| `simulation-tests/report.json` and `final-verification.json` | 25 actual unsigned calls: 5 positive donations, 20 exact expected rejections across five public accounts; 72 offline; 11 verifier replay/mutation cases | The 11 test the matrix verifier, not additional contract behaviors; repeat offline runs overlap. |
| `routing-update/report.json` | Explicit applied admin routing correction, two successor blocks | Concrete test5 recipient, not Mainnet release approval. |
| `live-donation-tests/report.json` | Five applied 1-XTZ donate calls, five reveals, one admin payout of 5 XTZ | Signed testnet acceptance outside the browser SDK/UI. |

The first account-matrix attempt stopped at 25 **local preflight assertion
failures and zero `run_code` calls**, due to comparing optimized versus readable
storage representations. It establishes neither a contract failure nor successful
expected rejections. The corrected rerun used decoded semantic equality and
executed all 25 native calls (5 HTTP 200, 20 script-rejected HTTP 500 with exact
expected reasons). Pinned/current storage and balances were reported unchanged
on both RPCs. These matrices overlap and must not become a combined audit score.

### Deployment identity and source blocks

- Chain: `NetXsqzbfFenSTS` (Shadownet); protocol
  `PsUshuai9QapM5TGj1JpuVGkdxz5GykdnEvS6Rh8SUVrARvZLCY` in the pinned reports.
- Contract: `KT1Sgiad8uYnDQqpbG2Cc6G8DuDRvDRD6zXU`.
- Public admin: `tz1cb63zzWFmEBWyPmGkvjeKWdfAqUaWKNFm`.
- Original origination `ooueiaBsRYcEGkPKxSSxnwaULNDaqUKPQtqKmwTy5B4f5AYZnkV`,
  block `BLEzFp6sueXWDrUdNU5zxcsCweCJsbrrhMwB9NvTh4PfS2rreiJ`,
  level 5576203, October 21, 2026 09:57:33 UTC. The stored verifier reports exact
  operation hash/content/source/counter, explicit applied status and originated
  address checked against two RPCs, with independent indexed applied status.
- Artifact verification block
  `BLz9iWMaKTmAyEsytB4tx32t8oDnnprPUPY9g8PKwx8Qi7GsBzs`,
  level 5583528, October 21, 2026 22:12:09 UTC.
- Five-account simulation block
  `BM8muMjUtYMotSJFKtowiQzypHxWmXzLbrMVtRyQDuZt1D8NSJ9`,
  level 5583884, October 21, 2026 22:47:54 UTC.

### Beneficiary correction and applied acceptance

The early pinned recipient `KT1R3CCdGptv1HUTASUyrqBtTCQ1Gn2PMU12` was a Unit
sink fixture without onward transfer/withdrawal logic. Matching code/schema alone
did not make it beneficiary-ready. A later applied admin call changed routing to
**test5 `tz1gi7PyMEPKhH3p6hqHiTyzabudNE7aZWYV`**:

- Operation `opK5LcLcHR6PoYMEkhhKMfrtqELEd4Jz13gM5gSY1fvDAcZYcgf`;
  block `BLoYS3oxXnmWKRsdVfwzUSMtduBjnL8VHi1SmjBEqwfTaX5P4dd`, level 5584009.
- Confirmation readback
  `BLCuaeDcvakzdTPWQPyPc9RkEQ6ntKrtomjyHCLFyqM7RQo7nHc`, level 5584011.
- Zero attached tez; only routing changed; no internal transfers. This corrected
  the earlier blocker for the approved testnet acceptance, not all future uses.

The subsequent live report records these public hashes and inclusion levels:

| Action | Ledger ID / level | Operation hash |
| --- | --- | --- |
| test1 donate 1 XTZ + reveal | 19 / 5584064 | `opQ6opsriwgfn1NsaX9dnD3PdDC8yFPZpCfvTYv8gif7Np1nW6w` |
| test2 donate 1 XTZ + reveal | 20 / 5584082 | `opSg8b5BsjP8GxqADqzzFaGXX1e7TrG5fqQLuzQJeRbyifAGbt4` |
| test3 donate 1 XTZ + reveal | 21 / 5584087 | `ooefVkj8b1vBgJ2PbdSqnNqoNksidcrCTuo4Xdbue6DNgSR6o3r` |
| test4 donate 1 XTZ + reveal | 22 / 5584093 | `oo1eX3Nf3QS5y9tuotz3i1v4zAn1VtEEVQRLvPvZUR6rgR72Wrv` |
| test5 donate 1 XTZ + reveal | 23 / 5584098 | `onjrDXL8mzjx6cTsKQxdUwKjBLZzXYutMZiA3FR5Gf1Mjd8675C` |
| Admin payout 5 XTZ to test5 | no new record / 5584105 | `opPyGBJNpZsFHvqDCw6e3Dkp6iynpVhWJGXLShbcSYGtHFBnAPY` |

Baseline block `BMBw9xrVZtoymGGqehvYjNu43rLc896jWaPGRryTEaWY4JNnu77`;
final readback `BLPrKjzyvUFbhmYKKu5nU3NrQseoq9EExXBDMzoQxJ6ooJYV1ox`,
level 5584107. The report asserts explicit outer/internal applied results,
independent receipts/state/balances/ledger and at least two successor blocks.
Final ID counter 24; ledger IDs 19–23 preserved after payout; lifetime donated
and disbursed both **56,000,000 mutez (56 XTZ)**; collector balance zero;
selected baker/delegate unset. **This is October 21 pinned state, not a current
balance, routing or finality guarantee.** Per-donation inclusion block hashes
are absent from the compact source report; inclusion levels and the final block
are retained rather than fabricating missing hashes.

The live run also corrected a mistaken zero-counter assumption and stopped on
an optimized/readable big-map comparison after test1. Semantic read-only
reconciliation preceded continuation; test1 was not retried, according to the
report. These are harness corrections, not invisible successful first attempts.

### Old on-chain harness explicitly not certified

The old on-chain report declared 18 applied, 12 expected rejections, **2 failures**
(`T23_set_baker_spk`, `T23b_set_baker_state`) and **4 anomalies**. This is not a
passing suite. T23/T25 malformed `key_hash` encoding used `key` instead of
`string`; local encoding exceptions cannot prove `NOT_ADMIN`. Reason mismatches
in T10/T25 are not successful expected rejections. Missing receipt status defaulted
to applied, hash presence could count as success, and resume treated FAIL/ERROR
as completed. The original verifier also hardcoded Mainnet; the historical
unsigned rerun adapted only its network/root guards. No signing harness is
published or blindly resumed here. Later routing/payout success does not certify
positive baker selection, fix those counts, or erase old failures/anomalies.

## What remains unverified or limited

- No independent professional audit, formal proof, or Mainnet deployment.
- Real browser-wallet **pairing and signing for this collector flow** remain
  unverified. Applied test-account calls do not establish SDK/UI acceptance,
  wallet rejection recovery, review accuracy or signer/UI race safety.
- Downstream payout-failure **atomic rollback**, malicious recipient callbacks,
  reentrancy/state interactions and signer/UI races need dedicated adversarial
  tests. Emitting an internal operation in `run_code` is not applying it;
  a successful simple-recipient payout does not test failure rollback.
- Positive delegate/baker application remains outside certified coverage, with
  the two historical failures/four anomalies above and fail-open harness defects.
  Offline/unsigned delegation emission is narrower evidence.
- Historical maximum memo `run_code` gas threshold: 5268 accepted, 5267 rejected,
  for 512 four-byte code points/2048 bytes, at the pinned protocol context.
  This is **not a wallet fee estimate**, storage-burn quote or future gas promise.
- Off-chain recipient/code/chain rereads cannot prevent an admin routing change
  between review and inclusion (recipient TOCTOU). Existing funds follow current
  on-chain routing; the admin is a trusted financial authority.
- Large-ledger frontend work is separate, unpublished work and was not copied,
  inspected as a tested deliverable, or certified here. A version-specific browser
  SDK metrics issue remains unresolved in that separate work; this publication
  neither repairs it nor claims a verified SDK version/fix. Contract tests are
  not frontend/SDK metrics tests.
- Source reports attest earlier RPC comparisons; this publication did not refresh
  chain state. Raw receipts, full historical harnesses and the 11 verifier tests
  are not shipped here. Hash provenance detects changed source reports but does
  not make unpublished raw evidence independently reproducible from this JSON.
- Local allowlist/secret-pattern checks are defense in depth, not a complete secret
  audit. No wallet/key/faucet exports, private endpoints, host paths or signing
  harnesses belong in the public evidence. Public addresses/hashes are intentional.
