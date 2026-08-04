# Evergrowth Store Backend

This backend is the private bridge between the public website, Stripe/PayPal, and the Minecraft EverStore plugin.

The website calls:

```text
POST /api/store/checkout
```

with:

```json
{
  "provider": "stripe",
  "minecraftUsername": "charless_t",
  "cart": [{ "productId": "gems_100", "quantity": 1 }]
}
```

The backend returns:

```json
{ "checkoutUrl": "https://..." }
```

## Setup

1. Copy `.env.example` to `.env`.
2. Add Stripe keys.
3. Add PayPal app keys.
4. Add the EverStore plugin API URL/key/HMAC.
5. Run:

```sh
npm install
npm run dev
```

Stripe webhook verification is wired through `STRIPE_WEBHOOK_SECRET`. After a
Stripe checkout succeeds, the backend posts the purchase directly to the
EverStore Paper plugin API. PayPal is scaffolded for later.
