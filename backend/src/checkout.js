import { randomUUID } from 'node:crypto';
import { canonical } from './signature.js';
import { receiptPdf } from './receipt.js';
import { publishOrderEvents } from './order-events.js';

export class CheckoutError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    Object.assign(this, {status, code, details});
  }
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(value);

export function validateCheckout(body) {
  const fields = [];
  if (!object(body)) throw new CheckoutError(400, 'VALIDATION_ERROR', 'JSON object required', {fields: ['body']});
  if (!id(body.order_id)) fields.push('order_id');
  // Customer text is stored as data, including quotes and markup (Section 5.13).
  if (typeof body.customer_id !== 'string' || !body.customer_id.length || body.customer_id.length > 64) fields.push('customer_id');
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 10) fields.push('items');
  else {
    const seen = new Set();
    body.items.forEach((item, index) => {
      if (!object(item)) { fields.push(`items.${index}`); return; }
      if (!id(item.variant_id) || seen.has(item.variant_id)) fields.push(`items.${index}.variant_id`);
      seen.add(item.variant_id);
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10) fields.push(`items.${index}.quantity`);
    });
  }
  if (body.discount_code !== undefined && body.discount_code !== null && typeof body.discount_code !== 'string') fields.push('discount_code');
  if (!object(body.payment) || !['tok_success', 'tok_declined', 'tok_capture_fail'].includes(body.payment.token)) fields.push('payment.token');
  if (fields.length) throw new CheckoutError(400, 'VALIDATION_ERROR', 'Invalid checkout parameters', {fields});
  // Unknown fields are ignored, and object key order is immaterial to replay identity.
  return {order_id: body.order_id, customer_id: body.customer_id,
    items: body.items.map(({variant_id, quantity}) => ({variant_id, quantity})),
    discount_code: body.discount_code ?? null, payment: {token: body.payment.token}};
}

export async function checkout(pool, redis, sign, body) {
  const request = validateCheckout(body);
  const client = await pool.connect();
  let response;
  let status = 201;
  try {
    await client.query('BEGIN');
    // Prevent reset from truncating state while checkout holds its reservations.
    await client.query('SELECT pg_advisory_xact_lock_shared(5505)');
    // The two-int namespace is distinct from the reset lock. Same-id purchases serialize.
    await client.query('SELECT pg_advisory_xact_lock(512, hashtext($1))', [request.order_id]);
    const previous = (await client.query('SELECT data FROM orders WHERE order_id=$1', [request.order_id])).rows[0]?.data;
    if (previous && canonical(previous.request) === canonical(request)) {
      response = previous.response;
      status = 200;
    } else {
      // Lock in deterministic order to avoid deadlocks across multi-variant baskets.
      const {rows} = await client.query('SELECT variant_id, stock, price_minor FROM variants WHERE variant_id=ANY($1::text[]) ORDER BY variant_id FOR UPDATE', [request.items.map(item => item.variant_id)]);
      const variants = new Map(rows.map(row => [row.variant_id, row]));
      for (const item of request.items) {
        if (!variants.has(item.variant_id)) throw new CheckoutError(404, 'VARIANT_NOT_FOUND', 'Variant does not exist', {variant_id: item.variant_id});
      }
      let percent = 0;
      if (request.discount_code !== null) {
        const discount = (await client.query('SELECT percent FROM discounts WHERE code=$1', [request.discount_code])).rows[0];
        if (!discount) throw new CheckoutError(400, 'INVALID_DISCOUNT_CODE', 'Discount code does not exist');
        percent = discount.percent;
      }
      if (previous) throw new CheckoutError(409, 'DUPLICATE_ORDER_ID', 'Order id has already been used');
      for (const item of request.items) {
        if (BigInt(variants.get(item.variant_id).stock) < BigInt(item.quantity)) throw new CheckoutError(409, 'OUT_OF_STOCK', 'Not enough stock', {variant_id: item.variant_id});
      }
      for (const item of request.items) {
        await client.query('UPDATE variants SET stock=stock-$2, reserved=reserved+$2 WHERE variant_id=$1', [item.variant_id, item.quantity]);
      }
      // The mock gateway executes while all reservations remain in this transaction.
      if (request.payment.token === 'tok_declined') throw new CheckoutError(402, 'PAYMENT_DECLINED', 'Payment authorization declined');
      if (request.payment.token === 'tok_capture_fail') throw new CheckoutError(402, 'PAYMENT_CAPTURE_FAILED', 'Payment capture failed; authorization voided');
      const items = request.items.map(item => ({...item, unit_price_minor: variants.get(item.variant_id).price_minor}));
      const subtotal_minor = items.reduce((sum, item) => sum + item.quantity * item.unit_price_minor, 0);
      const discount_minor = Math.floor(subtotal_minor * percent / 100);
      const total_minor = subtotal_minor - discount_minor;
      const payload = {order_id: request.order_id, customer_id: request.customer_id, items,
        subtotal_minor, discount_minor, total_minor, currency: 'PKR', paid_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')};
      response = {order_id: request.order_id, status: 'paid', currency: 'PKR', items,
        subtotal_minor, discount_minor, total_minor,
        payment: {authorization_id: `auth_${randomUUID()}`, capture_id: `cap_${randomUUID()}`, state: 'captured'},
        receipt: {payload, signature: sign(request.order_id, payload), pdf_base64: await receiptPdf(payload)}};
      for (const item of request.items) await client.query('UPDATE variants SET reserved=reserved-$2 WHERE variant_id=$1', [item.variant_id, item.quantity]);
      await client.query('INSERT INTO orders VALUES ($1,$2)', [request.order_id, {request, response}]);
      await client.query('INSERT INTO order_outbox(order_id,payload) VALUES ($1,$2)', [request.order_id, {order_id: request.order_id, status: 'paid', occurred_at: payload.paid_at}]);
    }
    await client.query('COMMIT');
  } catch (error) {
    // Rollback releases every reservation together, including payment failures.
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
  // The durable outbox is retried by the server if Redis is temporarily unavailable.
  try { await publishOrderEvents(pool, redis); }
  catch (error) { console.error('Order event delivery pending:', error.message); }
  return {status, response};
}

export async function inventory(pool, variantId) {
  const row = (await pool.query('SELECT variant_id, stock, reserved FROM variants WHERE variant_id=$1', [variantId])).rows[0];
  if (!row) throw new CheckoutError(404, 'VARIANT_NOT_FOUND', 'Variant does not exist', {variant_id: variantId});
  return {variant_id: row.variant_id, stock: Number(row.stock), reserved: Number(row.reserved)};
}
