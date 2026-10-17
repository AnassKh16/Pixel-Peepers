import { createHmac } from 'node:crypto';

// Compare Unicode code points, including keys outside the BMP.
function compareKeys(a, b) {
  const x = Array.from(a, c => c.codePointAt(0));
  const y = Array.from(b, c => c.codePointAt(0));
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return x.length - y.length;
}
export function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort(compareKeys).map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  throw new TypeError('Payload must contain only JSON values');
}
export function createSigner(salt) {
  if (typeof salt !== 'string' || salt.length === 0) throw new Error('DAY1_SALT must be set');
  return (id, payload) => {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(id)) throw new TypeError('Invalid record id');
    return createHmac('sha256', Buffer.from(salt, 'utf8')).update(`${id}|${canonical(payload)}`, 'utf8').digest('hex');
  };
}
