// netlify/functions/process-payment.js
//
// Verifies and captures a PayPal order that was approved on the client (index.html).
// The PayPal Client ID is public and lives in index.html — that's expected and safe.
// The PayPal Secret must ONLY live here, as a Netlify environment variable, never in
// the front-end code.
//
// Required Netlify environment variables (Site settings -> Environment variables):
//   PAYPAL_CLIENT_ID      (same Client ID used in index.html)
//   PAYPAL_SECRET         (from developer.paypal.com -> Apps & Credentials -> your app)
//   PAYPAL_API_BASE       (optional) defaults to the sandbox API below.
//                          Switch to https://api-m.paypal.com when you go live with
//                          live (not sandbox) credentials.

const PAYPAL_API_BASE = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';

async function getAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;

  if (!clientId || !secret) {
    throw new Error('PayPal credentials are not configured on the server.');
  }

  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64');

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    throw new Error('Failed to authenticate with PayPal.');
  }

  const data = await response.json();
  return data.access_token;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed.' }) };
  }

  try {
    const { orderID, items } = JSON.parse(event.body || '{}');

    if (!orderID) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Missing PayPal order ID.' })
      };
    }

    const accessToken = await getAccessToken();

    // Capture the order. This is the step that actually moves the money and is
    // safe to call even though the client already "approved" it — PayPal only
    // lets a given order be captured once.
    const captureResponse = await fetch(
      `${PAYPAL_API_BASE}/v2/checkout/orders/${orderID}/capture`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const captureData = await captureResponse.json();

    if (!captureResponse.ok || captureData.status !== 'COMPLETED') {
      console.error('PayPal capture failed:', captureData);
      return {
        statusCode: 402,
        body: JSON.stringify({ success: false, error: 'Payment could not be captured.' })
      };
    }

    // At this point payment is confirmed. This is where you'd typically:
    //  - save the order (items, amount, payer email) to a database or send yourself
    //    a notification email (e.g. via Formspree, like your other forms)
    //  - trigger fulfillment
    const payer = captureData.payer || {};
    const amount =
      captureData.purchase_units &&
      captureData.purchase_units[0] &&
      captureData.purchase_units[0].payments &&
      captureData.purchase_units[0].payments.captures &&
      captureData.purchase_units[0].payments.captures[0] &&
      captureData.purchase_units[0].payments.captures[0].amount;

    console.log('Payment captured:', {
      orderID,
      payerEmail: payer.email_address,
      amount,
      items
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, orderID })
    };
  } catch (err) {
    console.error('process-payment error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Something went wrong processing your payment.' })
    };
  }
};
