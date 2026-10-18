import {createHmac} from 'node:crypto';
import {canonical} from './signature.js';

export function requireDay2Salt() {
  const salt = process.env.DAY2_SALT;
  if (typeof salt !== 'string' || !salt.length) throw new Error('DAY2_SALT must be set');
  return salt;
}

export function signDay2(entityId, payload) {
  if (typeof entityId !== 'string') throw new TypeError('Entity id must be a string');
  return createHmac('sha256', Buffer.from(requireDay2Salt(), 'utf8'))
    .update(`${entityId}|${canonical(payload)}`, 'utf8').digest('hex');
}
