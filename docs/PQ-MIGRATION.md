# OST Post-Quantum Migration Plan

> Phase 1 of the Ghost roadmap. This is the engineering plan for moving OST
> and the Ghost mesh toward post-quantum (PQ) security without breaking the
> existing Solana-anchored coin or the live frontend.

## 1. Reality check

OST sits on three different trust planes, and they cannot all be upgraded
at the same speed:

| Plane | What it controls | Who decides the algorithms |
|---|---|---|
| Chain (Solana / Token-2022) | Coin custody, transfers, confidential transfer proofs | The base chain |
| Treasury / governance | Operator approvals, secrets, releases | OST operators |
| Ghost mesh / API | Mission envelopes, relay auth, device identity | OST repo |

We control the Ghost mesh and treasury planes today. We do **not** control
the chain plane. So the migration is staged accordingly.

## 2. Algorithm targets

Hybrid by default. Every signed object carries a classical signature **and**
a PQ signature slot. Verification policy is governed by code, not by the
envelope, so we can switch to "PQ required" without re-issuing devices.

| Use | Today (real) | Phase 1 slot | Phase 2 target |
|---|---|---|---|
| Device identity / mission signing | `Ed25519` | `placeholder` | `ML-DSA-65` (Dilithium3) |
| Session key agreement | `X25519` | `placeholder` | `ML-KEM-768` (Kyber768) |
| Long-term archival signatures | `Ed25519` | `placeholder` | `SLH-DSA-SHA2-128s` (SPHINCS+) |
| Symmetric encryption | `AES-256-GCM` | unchanged | unchanged |
| Hash / KDF | `SHA-384` / `HKDF-SHA384` | unchanged | unchanged |

The placeholder slot is intentional. It ships the envelope schema today so
the wire format does not break the day a real ML-DSA backend is registered
on the worker via `registerPqAdapter()` in
[`workers/ost-api/src/ghost-crypto.js`](../workers/ost-api/src/ghost-crypto.js).

## 3. Ghost mesh / API plane (shipping in Phase 1)

Already implemented in this repo:

- Versioned hybrid envelope (`v: 1`, `algSet`, `issuer`, `payloadHash`,
  `sig.{classical,pq,pqAlg}`).
- Real Ed25519 signing in browser (WebCrypto) and worker.
- Pluggable PQ adapter interface, defaulted to a clearly-labelled
  structural placeholder so callers cannot mistake it for real PQ.
- Authorized device enrollment (`POST /ghost/pq/enroll`) gated behind the
  `GHOST_ENROLL_TOKEN` worker secret. No anonymous enrollment.
- Issuer-key pinning on verify (`POST /ghost/pq/envelope/verify`) so an
  envelope cannot smuggle in a different `classicalPub` than the one stored
  for its `deviceId`.
- KV-backed device registry with TTL and a hard cap on enrolled devices.

To land a **real** PQ backend on the worker:

1. Add `@noble/post-quantum` to the worker bundle (or any equivalent
   pure-JS / WASM ML-DSA implementation).
2. Inside `workers/ost-api/src/ghost-pq.js`, before exporting the handler,
   call `registerPqAdapter({ alg: 'ML-DSA-65', isReal: true, generateKey,
   sign, verify })` using the real implementation.
3. Re-issue device keys for every operator browser. The envelope schema
   does not change; only `algSet.pqSig` and `sig.pq` start carrying real
   ML-DSA bytes.
4. Once every active device has both keys, flip
   `verifyEnvelope(..., { allowClassicalOnly: false })` (already the
   default once `pqAdapter.isReal === true`).

## 4. Treasury / governance plane

Today: `Ed25519`-signed Solana ops, optional multisig, off-chain operator
notes.

Phase 1 actions (no chain change required):

- All operator-issued commands (releases, secret rotations, connector
  configuration, treasury policy changes) are wrapped in a Ghost PQ
  envelope from an enrolled operator device before being executed.
- Worker rejects any privileged write whose envelope fails verification.
- `GHOST_ENROLL_TOKEN` is rotated per quarter.
- High-value operator devices use the `SLH-DSA` slot (long-term, big
  signature, hash-based, conservative assumptions) once the real PQ
  adapter is registered.

Phase 2 actions:

- Replace the bearer-token enrollment with envelope-based enrollment
  signed by an existing operator device. The bootstrap token only exists
  for the first operator.
- Move treasury policy state into KV objects that are themselves signed
  envelopes. Worker re-verifies on every read so a leaked KV write cannot
  silently change policy.

## 5. On-chain plane (constrained)

We cannot replace `Ed25519` on Solana ourselves. Instead:

- Treat the chain key purely as **asset custody**, not as the source of
  governance authority.
- Bind every privileged on-chain action to a PQ-signed Ghost envelope
  that the worker validates *before* the operator is permitted to broadcast
  the Solana transaction.
- Use multisig + timelocks at the chain level so an attacker who steals a
  classical chain key still cannot move funds before the PQ-signed Ghost
  policy catches it.
- Keep wallet abstraction loose enough that, when a PQ-friendly chain or
  L2 ships, OST custody can migrate without changing the Ghost mesh.

For zero-knowledge proofs:

- Do not commit to a single proving system at the application layer.
  Wrap proof verification behind an interface so we can swap pairing-based
  systems for hash-based or lattice-friendly systems later.
- Prefer constructions whose hardness assumptions degrade *gracefully*
  under quantum attack (hash commitments, STARK-friendly arithmetization)
  for any new feature designed in 2026 onward.

## 6. Migration checklist

- [x] Ship hybrid envelope schema (v1) with classical Ed25519.
- [x] Ship authorized device enrollment + KV registry.
- [x] Ship issuer-key-pinned envelope verification.
- [x] Ship browser device generator + signer + verifier.
- [ ] Set `GHOST_ENROLL_TOKEN` secret on Cloudflare Pages
      (`ost-api-pages`).
- [ ] Enroll the first operator browser device.
- [ ] Wrap one privileged worker write (e.g. mission dispatch) so it
      requires a verified envelope.
- [ ] Register a real ML-DSA adapter and re-issue device keys.
- [ ] Flip verify policy to require both signatures.
- [ ] Add SLH-DSA slot for long-term operator devices.
- [ ] Document and rotate `GHOST_ENROLL_TOKEN` quarterly.

## 7. What this plan deliberately does NOT do

- It does **not** ship cryptography that pretends to be post-quantum when
  it is not. The placeholder PQ adapter is labelled
  `pqIsReal: false` everywhere it appears.
- It does **not** assume Solana will adopt PQ signatures on our schedule.
- It does **not** attempt to replace zero-knowledge proofs in a single
  step; the goal is crypto-agility, not a forced rewrite.
- It does **not** include any capability to access devices, networks,
  routers, or accounts that the operator does not own. Every transport in
  the Ghost mesh is opt-in and authenticated.
