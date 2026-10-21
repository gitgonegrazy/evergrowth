import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Stripe from 'stripe';
import paypal from '@paypal/checkout-server-sdk';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3000);
const siteUrl = process.env.PUBLIC_SITE_URL || 'https://evergrowth.art';
const minecraftCommandPath = process.env.MINECRAFT_COMMAND_PATH || '/api/v1/purchases';
const corsOrigins = (process.env.CORS_ORIGINS || `${siteUrl},https://store.evergrowth.art`)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const products = {
  gems_1000: { name: '1000 Gems', gems: 1000, priceUsd: 1.99 },
  gems_5000: { name: '5000 Gems', gems: 5000, priceUsd: 5.99 },
  gems_10000: { name: '10000 Gems', gems: 10000, priceUsd: 9.99 },
};

app.use(cors({ origin: corsOrigins }));
app.use((req, res, next) => {
  if (req.path === '/api/webhooks/stripe') return next();
  return express.json({ limit: '64kb' })(req, res, next);
});

function validateUsername(username) {
  return typeof username === 'string' && /^[A-Za-z0-9_]{3,16}$/.test(username);
}

function normalizeCart(cart) {
  if (!Array.isArray(cart)) throw new Error('Cart must be an array');
  return cart.map((item) => {
    const product = products[item.productId];
    const quantity = Number(item.quantity || 1);
    if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new Error('Invalid cart item');
    }
    return { productId: item.productId, quantity, product };
  });
}

function cartTotalUsd(cart) {
  return cart.reduce((sum, item) => sum + item.product.priceUsd * item.quantity, 0);
}

function totalGems(cart) {
  return cart.reduce((sum, item) => sum + item.product.gems * item.quantity, 0);
}

function paypalClient() {
  const environment = process.env.PAYPAL_ENV === 'live'
    ? new paypal.core.LiveEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET)
    : new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);
  return new paypal.core.PayPalHttpClient(environment);
}

async function createStripeCheckout({ cart, minecraftUsername }) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: `${siteUrl}/store-success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/store-cancel.html`,
    metadata: {
      minecraftUsername,
      totalGems: String(totalGems(cart)),
      cart: JSON.stringify(cart.map((item) => ({ productId: item.productId, quantity: item.quantity }))),
    },
    line_items: cart.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: 'usd',
        product_data: { name: item.product.name },
        unit_amount: Math.round(item.product.priceUsd * 100),
      },
    })),
  });
  return session.url;
}

async function createPayPalCheckout({ cart, minecraftUsername }) {
  const request = new paypal.orders.OrdersCreateRequest();
  request.prefer('return=representation');
  request.requestBody({
    intent: 'CAPTURE',
    purchase_units: [{
      custom_id: JSON.stringify({
        minecraftUsername,
        totalGems: totalGems(cart),
        cart: cart.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      }),
      amount: {
        currency_code: 'USD',
        value: cartTotalUsd(cart).toFixed(2),
      },
    }],
    application_context: {
      return_url: `${siteUrl}/store-success.html`,
      cancel_url: `${siteUrl}/store-cancel.html`,
      user_action: 'PAY_NOW',
    },
  });

  const response = await paypalClient().execute(request);
  const approveLink = response.result.links.find((link) => link.rel === 'approve');
  if (!approveLink) throw new Error('PayPal approval link missing');
  return approveLink.href;
}

app.post('/api/store/checkout', async (req, res) => {
  try {
    const { provider, minecraftUsername } = req.body;
    const cart = normalizeCart(req.body.cart);

    if (!validateUsername(minecraftUsername)) {
      return res.status(400).json({ error: 'Invalid Minecraft username' });
    }

    if (provider === 'stripe') {
      return res.json({ checkoutUrl: await createStripeCheckout({ cart, minecraftUsername }) });
    }

    if (provider === 'paypal') {
      return res.json({ checkoutUrl: await createPayPalCheckout({ cart, minecraftUsername }) });
    }

    return res.status(400).json({ error: 'Unknown payment provider' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Checkout unavailable' });
  }
});

async function sendMinecraftPurchase({ minecraftUsername, gems, paymentId }) {
  const body = JSON.stringify({
    orderId: String(paymentId),
    player: minecraftUsername,
    uuid: '00000000-0000-0000-0000-000000000000',
    package: `${gems} Gems`,
    commands: [`gems give ${minecraftUsername} ${gems}`],
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomUUID();
  const method = 'POST';
  const signature = crypto
    .createHmac('sha256', process.env.MINECRAFT_HMAC_SECRET)
    .update(`${timestamp}.${nonce}.${method}.${minecraftCommandPath}.${body}`)
    .digest('hex');

  const response = await fetch(`${process.env.MINECRAFT_API_URL}${minecraftCommandPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-EverStore-Key': process.env.MINECRAFT_API_KEY,
      'X-EverStore-Timestamp': timestamp,
      'X-EverStore-Nonce': nonce,
      'X-EverStore-Signature': signature,
    },
    body,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Minecraft API failed: ${response.status} ${message}`);
  }
}

app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    console.error('Stripe webhook verification failed:', error.message);
    return res.status(400).send('Invalid Stripe webhook signature');
  }

  if (event.type !== 'checkout.session.completed') {
    return res.json({ received: true });
  }

  const session = event.data.object;
  const minecraftUsername = session.metadata?.minecraftUsername;
  const gems = Number(session.metadata?.totalGems);

  try {
    if (!validateUsername(minecraftUsername) || !Number.isInteger(gems) || gems < 1) {
      throw new Error('Stripe session metadata is missing a valid username or gem amount');
    }

    await sendMinecraftPurchase({
      minecraftUsername,
      gems,
      paymentId: `stripe:${session.id}`,
    });

    return res.json({ received: true, delivered: true });
  } catch (error) {
    console.error('Stripe purchase delivery failed:', error);
    return res.status(500).json({ error: 'Purchase delivery failed' });
  }
});

app.post('/api/webhooks/paypal', async (req, res) => {
  res.status(501).json({ error: 'PayPal webhook verification needs your webhook id.' });
});

app.listen(port, () => {
  console.log(`Evergrowth store backend listening on ${port}`);
});
