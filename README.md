# x402 Lightning Facilitator

A multi-tenant [x402](https://x402.org) facilitator for Lightning Network payments, built on [Nostr Wallet Connect (NWC)](https://nwc.dev).

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Facilitator endpoints                                   │
│    POST /register    register a merchant NWC secret      │
│    POST /invoice     generate BOLT11 for a merchant      │
│    POST /verify      check preimage cryptographically    │
│    POST /settle      confirm payment via merchant NWC    │
│    GET  /supported   capability discovery                │
│    GET  /invoice/status/:hash  poll payment status       │
├─────────────────────────────────────────────────────────┤
│  Demo (enabled when DEMO_NWC_SECRET is set)             │
│    GET /demo/quote   pay ~$0.01 → get a Satoshi quote   │
└─────────────────────────────────────────────────────────┘
```

### Multi-tenant design

The facilitator holds no wallet credentials in its config. Each merchant calls `POST /register` with their [NWC](https://nwc.dev) connection string and receives an opaque `merchantId` (UUID). The NWC secret is stored in Redis; clients only ever see the UUID. The facilitator uses it to:

1. Create a BOLT11 invoice against the merchant's wallet (`POST /invoice`)
2. Confirm settlement against the merchant's wallet (`POST /settle`)

Multiple merchants can share one facilitator instance, each with their own independent wallet.

### Lightning vs EVM payment flow

Unlike EVM-based x402 where the client signs a transaction, Lightning requires a BOLT11 invoice to be generated server-side before the client pays:

1. Client `GET /resource` → server returns `402` with invoice in `extra.invoice`
2. Client pays the BOLT11 invoice → receives a `preimage`
3. Client retries with `preimage` in the `payment-signature` header
4. Server calls `/verify` (checks `sha256(preimage) == paymentHash`, no network call)
5. Server calls `/settle` (calls NWC `lookup_invoice` to confirm `settled_at`)

## Setup

### Prerequisites

- Node.js 18+
- Redis (local or hosted — e.g. [Upstash](https://upstash.com))
- At least one NWC-compatible wallet (e.g. [Alby](https://getalby.com)):
  - **Merchant wallet** — receives payments
  - **Sender wallet** — sends payments during e2e tests (optional)

### Install

```bash
npm install
```

### Configure

Copy and fill in `.env`:

```env
# Required
REDIS_URL=redis://localhost:6379

# Optional — port defaults to 3000
PORT=3000

# Optional — public base URL (used in /.well-known/x402 response)
BASE_URL=https://your-domain.com

# Optional — enables the /demo/quote endpoint
DEMO_NWC_SECRET=nostr+walletconnect://<pubkey>?relay=<relay>&secret=<secret>
```

For e2e tests, copy `.env.sender.example` to `.env.sender` and fill in a sender wallet NWC URL.

### Run

```bash
npm run dev
```

### Register a merchant

```bash
curl -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -d '{"nwcSecret":"nostr+walletconnect://..."}'
# → { "merchantId": "<uuid>" }
```

Use the `merchantId` in your resource server's `extra.merchantId` field.

---

## Open questions / TODOs

### 1. `verify` vs `settle` — the hold invoice problem

**Current behaviour:** `verify` checks the preimage cryptographically (no network call). `settle` calls the merchant's NWC wallet to confirm the invoice is paid.

**The problem:** In Lightning, payment is atomic — once the preimage is revealed, the payment is already settled. There is no separate "settle" step at the protocol level.

**Hold invoices as a solution:** [HODL invoices](https://bitcoinops.org/en/topics/hold-invoices/) would let the facilitator hold funds in-flight during `verify` and release them at `settle`. Requires NWC wallet support (not universally available yet).

### 2. NWC client connection lifecycle

NWC clients are cached indefinitely by connection string. There is no reconnection logic or health-check. Long-lived connections may silently drop. Consider adding a ping/reconnect strategy.
