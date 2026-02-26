import { NWCClient } from "@getalby/sdk";

// Cache NWC clients by URL to avoid creating a new connection per request
const clientCache = new Map<string, NWCClient>();

function getClient(nwcUrl: string): NWCClient {
  let client = clientCache.get(nwcUrl);
  if (!client) {
    client = new NWCClient({ nostrWalletConnectUrl: nwcUrl });
    clientCache.set(nwcUrl, client);
  }
  return client;
}

export interface MakeInvoiceResult {
  invoice: string;
  paymentHash: string;
  expiresAt: number;
}

export interface LookupInvoiceResult {
  settledAt?: number;
  preimage?: string;
}

export async function makeInvoice(
  nwcUrl: string,
  amountSats: number,
  description: string = "x402 payment",
): Promise<MakeInvoiceResult> {
  const c = getClient(nwcUrl);
  const result = await c.makeInvoice({
    amount: amountSats * 1000, // NWC amounts are in millisatoshis
    description,
  });
  return {
    invoice: result.invoice!,
    paymentHash: result.payment_hash,
    expiresAt: result.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
  };
}

export async function lookupInvoice(
  nwcUrl: string,
  paymentHash: string,
): Promise<LookupInvoiceResult> {
  const c = getClient(nwcUrl);
  const result = await c.lookupInvoice({ payment_hash: paymentHash });
  return {
    settledAt: result.settled_at,
    preimage: result.preimage,
  };
}
