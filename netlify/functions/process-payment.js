// netlify/functions/process-payment.js
//
// Charges a card for the PRODUCT cart through Square.
// The card form in index.html turns the card into a one-time token; this function
// sends that token to Square to actually take the payment.
//
// The 14-Day Gut + Skin Wellness Reset is NOT sold through here — it uses its own
// PayPal payment link set on the product in index.html.
//
// Set these in Netlify -> Site configuration -> Environment variables:
//   SQUARE_ACCESS_TOKEN   (PRODUCTION access token from developer.squareup.com -> your app -> Credentials)
//   SQUARE_LOCATION_ID    (optional — defaults to the Location ID used in index.html)
//
// Never put the access token in index.html or anywhere else in the code.

const crypto = require('crypto');

const SQUARE_API_BASE = 'https://connect.squareup.com';
const SQUARE_VERSION = '2025-01-23';
const LOCATION_ID = process.env.SQUARE_LOCATION_ID || 'L1ABK3FVP8WRT';

// Prices are checked here on the server so the amount charged can't be changed
// from the shopper's browser. KEEP THIS LIST IN SYNC with the prices in index.html.
const PRICES = {
  'HydraBright': 102,
  'Collagen Hydrator': 63,
  'Clearskin Lightweight Moisturizer': 63,
  'ReBalance': 63,
  'Pigment Gel Pro': 130,
  'Hyaluronic Acid Boosting Serum': 128,
  'Vitamin B3 Brightening Serum': 130,
  'Intensive Age Refining Treatment 0.5% Pure Retinol': 120,
  'Intensive Brightening Treatment 0.5% Pure Retinol': 120,
  'Intensive Clarity Treatment 0.5% Pure Retinol & Salicylic Acid': 120,
  'Retinol Treatment for Sensitive Skin': 120,
  'Triple Exfoliation Peel Pads': 60,
  'Hydrator Plus Broad Spectrum SPF 30': 52
};
const TAX_RATE = 0.07;
const SHIPPING_FLAT = 10;

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { success: false, error: 'Method not allowed.' });
  }

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('SQUARE_ACCESS_TOKEN is not set in Netlify.');
    return json(500, { success: false, error: 'Payments are not set up yet. Please contact us to order.' });
  }

  try {
    const { sourceId, items } = JSON.parse(event.body || '{}');

    if (!sourceId) {
      return json(400, { success: false, error: 'Missing card details.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return json(400, { success: false, error: 'Your bag is empty.' });
    }

    let subtotal = 0;
    for (const name of items) {
      if (!(name in PRICES)) {
        console.error('Unknown item in cart:', name);
        return json(400, { success: false, error: `"${name}" can't be purchased here right now.` });
      }
      subtotal += PRICES[name];
    }
    const total = subtotal + subtotal * TAX_RATE + SHIPPING_FLAT;
    const amountCents = Math.round(total * 100);

    const response = await fetch(`${SQUARE_API_BASE}/v2/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Square-Version': SQUARE_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source_id: sourceId,
        idempotency_key: crypto.randomUUID(),
        location_id: LOCATION_ID,
        amount_money: { amount: amountCents, currency: 'USD' },
        note: `Love Your Skin order: ${items.join(', ')}`.slice(0, 500)
      })
    });

    const data = await response.json();

    if (!response.ok || !data.payment || !['COMPLETED', 'APPROVED'].includes(data.payment.status)) {
      console.error('Square payment failed:', JSON.stringify(data));
      const detail = data.errors && data.errors[0] && data.errors[0].detail;
      return json(402, { success: false, error: detail || 'Your card could not be charged. Please try another card.' });
    }

    console.log('Payment completed:', { paymentId: data.payment.id, amountCents, items });
    return json(200, { success: true, paymentId: data.payment.id });
  } catch (err) {
    console.error('process-payment error:', err);
    return json(500, { success: false, error: 'Something went wrong processing your payment.' });
  }
};
