# OST Offline Vault

The Offline Vault connects the PWA, Survival Bearer Tokens, and the local game engine into one offline-first loop.

## What ships now

- `site/offline-vault.js` stores a local vault in IndexedDB.
- Vault contents are encrypted with Web Crypto AES-GCM using a device-local secret.
- Users can import bearer tokens by digital file, paste, supported QR camera scanning, or supported Web NFC.
- Imported OST can become the active game balance for the existing OST arcade.
- Game debits, payouts, and result proofs are queued locally while offline.
- When the device reconnects, queued proofs upload to `POST /offline-vault/sync` on the Cloudflare worker.

## Bearer token formats

### OST-BEARER-V1

Preferred payload:

```json
{
  "v": "ost-bearer-v1",
  "tokenId": "ostb-...",
  "mint": "383pTzoZ8Gp83dzk23ZnvLcfX2Sq32TAGN48CMQu2pAJ",
  "amount": 100,
  "format": "paper",
  "issuer": "ost-local-survival-preview",
  "issuedAt": 1777590000000,
  "nonce": "...",
  "commitment": "sha256(...)"
}
```

The client verifies mint, amount, token version, and commitment locally before crediting the vault.

### Legacy Survival Text

The current Survival panel's downloaded text files are also accepted if they contain:

```text
Amount: 100 OST
HASH: abcdef12...12345678
```

Legacy imports are marked as `legacy-survival-preview` and still require sync reconciliation.

## Offline game mode

`ost-games.js` now checks `window.OSTOfflineVault.isActive()`.

When active:

- `getBalance()` reads the encrypted offline vault.
- `debit()` subtracts from local OST immediately.
- `credit()` adds winnings locally.
- `recordGameLedgerEvent()` queues a game proof for sync.
- The games cash-out button becomes a Sync button.

When inactive, the arcade keeps using the existing faucet hub play balance.

## Sync endpoint

`POST /offline-vault/sync`

Body:

```json
{
  "deviceId": "ost-device-...",
  "balance": 123.45,
  "tokenCount": 2,
  "events": [
    { "id": "evt-...", "kind": "offline-game-proof", "amount": 4.2, "ts": 1777590000000 }
  ]
}
```

Response:

```json
{
  "ok": true,
  "accepted": 1,
  "acceptedIds": ["evt-..."],
  "status": "queued_for_onchain_reconciliation"
}
```

The worker stores the events in KV under `offline-vault:<deviceId>` plus `offline-vault:recent`.

## Honesty boundary

This is the first offline ledger layer, not final trustless settlement. It lets the app work like cash while disconnected, preserves local proofs, and queues sync. Final issuer authenticity, double-spend prevention across devices, and on-chain settlement still require the next reconciliation dispatcher/program step.
