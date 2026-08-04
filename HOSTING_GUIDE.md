# Backend Hosting Guide

The website is public static HTML/CSS/JS. The backend is private Node.js code that talks to Stripe, PayPal, and the Minecraft plugin.

Recommended hostname:

```text
https://api.evergrowth.art
```

That hostname should point to wherever this `backend/` app is hosted.

## Easy Hosting Choice

Use Render or Railway first. They are easier than managing a VPS.

The backend host needs:

```text
Node.js app root: backend
Start command: npm start
```

Environment variables:

```text
PUBLIC_SITE_URL=https://evergrowth.art
CORS_ORIGINS=https://evergrowth.art,https://www.evergrowth.art,https://store.evergrowth.art
STRIPE_SECRET_KEY=sk_or_rk_key_from_stripe
STRIPE_WEBHOOK_SECRET=later_after_webhook_is_created
PAYPAL_ENV=sandbox
PAYPAL_CLIENT_ID=later
PAYPAL_CLIENT_SECRET=later
MINECRAFT_API_URL=http://76.164.198.140:8443
MINECRAFT_COMMAND_PATH=/api/v1/purchases
MINECRAFT_API_KEY=private_key_from_plugin_config
MINECRAFT_HMAC_SECRET=private_hmac_from_plugin_config
```

Use the public IP or host that can reach the Paper server's open EverStore API
port. For Evergrowth, use `http://76.164.198.140:8443` unless you later put the
plugin API behind a proper HTTPS proxy.

## Cloudflare

If the host gives an IPv4 address, create:

```text
Type: A
Name: api
IPv4: the backend host IPv4
Proxy: enabled
```

If the host gives a hostname, create:

```text
Type: CNAME
Name: api
Target: hostname from backend host
Proxy: enabled
```

The store website can stay at:

```text
https://evergrowth.art/store
```

`store.evergrowth.art` can stay as an alias/redirect to that store URL.
