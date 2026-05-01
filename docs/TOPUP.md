# OST Top-Up — Real-money OST refill

End users who run out of free faucet OST can pay $5 / $10 / $25 / $50 with a
card (Stripe) or with crypto (USDC or SOL on mainnet). 100% of the funds land
in the OST Treasury wallet; in exchange, the treasury sends devnet OST to the
user's wallet using a `transferChecked` (Token-2022) instruction.

```
[ Browser ] -- POST /topup/intent  -->  [ Cloudflare Worker (ost-api) ]
                                          |  KV: topup:intent:<id>
[ Browser ] -- POST /topup/checkout -->   |  Stripe Checkout (REST)
[ Stripe  ] -- /topup/stripe/webhook ->   |  marks intent paid + queues
                                          v
[ Local Node dispatcher (you) ] <-- GET /topup/admin/pending
                                          |
                                          v
                                   transferChecked → user's devnet wallet
                                          |
                                          v
                                  POST /topup/admin/mark-sent
```

## Tier table (server-validated)

| USD  | Base OST | Bonus | Total OST |
|------|----------|-------|-----------|
| $5   | 1,000    | 200   | 1,200     |
| $10  | 2,500    | 500   | 3,000     |
| $25  | 7,000    | 2,000 | 9,000     |
| $50  | 15,000   | 5,000 | 20,000    |

## 1. Set Cloudflare worker secrets

```powershell
cd workers/ost-api
npx wrangler secret put STRIPE_SECRET_KEY        # sk_live_... or sk_test_...
npx wrangler secret put STRIPE_WEBHOOK_SECRET    # whsec_... (from Stripe webhook config)
npx wrangler secret put TOPUP_ADMIN_TOKEN        # any long random string; share with dispatcher
npx wrangler deploy
```

Mainnet receiver addresses (shown in the crypto modal) live in `wrangler.toml`
as `TREASURY_USDC_MAINNET` and `TREASURY_SOL_MAINNET`. Edit and redeploy.

## 2. Configure the Stripe webhook

In the Stripe dashboard → Developers → Webhooks → "Add endpoint":

- URL: `https://ost-api.nachogtavl.workers.dev/topup/stripe/webhook`
- Events: `checkout.session.completed`
- Copy the signing secret into `STRIPE_WEBHOOK_SECRET` above.

## 3. Run the dispatcher (signs Solana transfers)

The treasury private key never leaves the operator's machine.

```powershell
npm install @solana/web3.js @solana/spl-token bs58
$env:OST_API_BASE        = "https://ost-api.nachogtavl.workers.dev"
$env:TOPUP_ADMIN_TOKEN   = "<same secret as the worker>"
$env:TREASURY_SECRET_B58 = "<base58 secret key of treasury devnet wallet>"
node scripts/topup-dispatcher.js --watch
```

The dispatcher polls `/topup/admin/pending`, sends OST (Token-2022,
decimals=9) using `getOrCreateAssociatedTokenAccount` + `transferChecked`,
and reports each signature back via `/topup/admin/mark-sent`. The browser
modal polls `/topup/status/:id` and shows the Solscan link.

## 4. Crypto payments

The crypto pane shows the treasury USDC + SOL addresses with a unique memo.
Users can paste the Solana mainnet payment signature into the modal; the Worker
verifies the treasury receiver, memo, and amount before marking the intent
`paid` and pushing it into the dispatcher queue. SOL payments to the treasury
wallet are also scanned automatically by `/topup/crypto/check/:intentId` while
the modal is open.

Manual admin confirmation remains available as a fallback:

```powershell
$body = @{ id = "<intent-id>"; txSignature = "<mainnet-signature>" } | ConvertTo-Json
Invoke-RestMethod -Method POST `
  -Uri "$env:OST_API_BASE/topup/admin/confirm-crypto" `
  -Headers @{ Authorization = "Bearer $env:TOPUP_ADMIN_TOKEN" } `
  -ContentType "application/json" -Body $body
```

The intent flips to `paid` and joins the same dispatcher queue.

## 5. Front-end fallback

If `STRIPE_SECRET_KEY` is not set, `/topup/config` reports `stripeEnabled:false`
and `topup.js` greys out the Card tab and shows: _"Card payments open soon. Use
the Crypto tab for instant top-up today."_ The site never crashes due to a
missing secret.

## Security notes

- Treasury secret key lives only on the operator machine running the dispatcher.
- Stripe webhook signature is verified with HMAC-SHA256 on the raw body
  before any intent is marked paid.
- Tier USD ↔ OST mapping is enforced server-side; client values are ignored.
- `TOPUP_ADMIN_TOKEN` gates `/topup/admin/*`. Rotate it like any secret.
