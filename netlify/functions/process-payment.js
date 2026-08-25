// netlify/functions/process-payment.js
//
// This function runs on Netlify's servers, NOT in the customer's browser.
// It is the only place your Square ACCESS TOKEN is ever used — it must
// never appear in index.html or any front-end file.
//
// Required environment variables (set these in Netlify, not in code):
//   SQUARE_ACCESS_TOKEN   — your Square API access token (Sandbox or Production)
//   SQUARE_LOCATION_ID    — your Square location ID
//   SQUARE_ENVIRONMENT    — "sandbox" or "production"

const { SquareClient, SquareEnvironment } = require("square");
const { randomUUID } = require("crypto");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ success: false, error: "Method not allowed" }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: "Invalid request body" }),
    };
  }

  const { sourceId, amount, items } = payload;

  if (!sourceId || !amount || typeof amount !== "number" || amount <= 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, error: "Missing or invalid payment details" }),
    };
  }

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  const environment =
    process.env.SQUARE_ENVIRONMENT === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox;

  if (!accessToken || !locationId) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: "Server is not configured with Square credentials yet.",
      }),
    };
  }

  const client = new SquareClient({ token: accessToken, environment });

  try {
    const response = await client.payments.create({
      sourceId,
      idempotencyKey: randomUUID(),
      amountMoney: {
        amount: BigInt(Math.round(amount * 100)), // dollars -> cents
        currency: "USD",
      },
      locationId,
      note: items && items.length ? `Order: ${items.join(", ")}` : undefined,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        paymentId: response.payment && response.payment.id,
      }),
    };
  } catch (err) {
    console.error("Square payment error:", err);
    const message =
      (err.errors && err.errors[0] && err.errors[0].detail) ||
      err.message ||
      "Payment could not be processed.";
    return {
      statusCode: 402,
      body: JSON.stringify({ success: false, error: message }),
    };
  }
};
