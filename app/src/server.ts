import express, { Request, Response, NextFunction } from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { LightningSchemeNetworkServer } from "./lightning-server";
import { requestContext } from "./request-context";

const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://localhost:3000";

// Each merchant supplies their own NWC connection string via environment variable.
// In a real multi-tenant platform this would come from a per-merchant config store,
// but using an env var keeps the demo self-contained.
const MERCHANT_NWC_URL = process.env.MERCHANT_NWC_URL;
if (!MERCHANT_NWC_URL) {
  throw new Error(
    "MERCHANT_NWC_URL environment variable is required — " +
      "set it to the merchant's Nostr Wallet Connect URL (nostr+walletconnect://...)",
  );
}

// Connect to our Lightning facilitator
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });

// Register the Lightning scheme server for both mainnet and testnet.
// LightningSchemeNetworkServer.enhancePaymentRequirements() will call the facilitator's
// POST /invoice endpoint to inject a fresh BOLT11 invoice into each 402 response.
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register("lightning:mainnet", new LightningSchemeNetworkServer(FACILITATOR_URL))
  .register("lightning:testnet", new LightningSchemeNetworkServer(FACILITATOR_URL));

// Define which routes require payment and how much.
// extra.nwcUrl identifies the merchant's wallet — the facilitator uses it to create
// invoices against the correct NWC connection (multi-tenant support).
const routes = {
  "GET /resource": {
    accepts: {
      scheme: "exact",
      price: { amount: "1", asset: "sat" }, // 1 satoshi
      network: "lightning:mainnet" as const,
      payTo: "", // Lightning: payment goes directly to the merchant's NWC wallet
      maxTimeoutSeconds: 300,
      extra: {
        nwcUrl: MERCHANT_NWC_URL,
      },
    },
    description: "A protected resource requiring 1 sat Lightning payment",
    mimeType: "application/json",
  },
};

const app = express();

// Extract paymentHash from payment-signature header (if present) and run subsequent
// handlers inside an AsyncLocalStorage context so LightningSchemeNetworkServer
// can reuse the already-paid invoice instead of generating a fresh one.
app.use((req: Request, _res: Response, next: NextFunction) => {
  const xPayment = req.headers["payment-signature"] as string | undefined;
  if (xPayment) {
    try {
      const payload = JSON.parse(Buffer.from(xPayment, "base64").toString("utf8"));
      const paymentHash = payload?.accepted?.extra?.paymentHash as string | undefined;
      if (paymentHash) {
        requestContext.run({ paymentHash }, next);
        return;
      }
    } catch {
      // malformed header — fall through without context
    }
  }
  requestContext.run({}, next);
});

// x402 payment middleware — intercepts requests to protected routes,
// returns 402 with a Lightning invoice if no valid payment is provided,
// and settles the payment before forwarding the response.
app.use(paymentMiddleware(routes, resourceServer));

// Protected route — only reached after valid payment is verified and settled
app.get("/resource", (_req: Request, res: Response) => {
  res.json({
    message: "Payment successful! Here is your protected resource.",
    timestamp: new Date().toISOString(),
    data: {
      content: "This is the paid content.",
    },
  });
});

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", facilitator: FACILITATOR_URL });
});

export { app };
