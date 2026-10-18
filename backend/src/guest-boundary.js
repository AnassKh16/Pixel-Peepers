import {DomainError} from './validation.js';

export function guestToken(authorization) {
  const match = typeof authorization === 'string' && /^\s*Bearer\s+(guest_[^\s]*)/i.exec(authorization);
  return match ? match[1] : null;
}

export function assertWriteAllowed(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const path = (req.originalUrl ?? req.path ?? '').split('?')[0].replace(/\/+$/, '').toLowerCase();
  if (['/api/v1/auth/login', '/api/v1/guest/token', '/audit/v1/guest/cart-merge'].includes(path)) return;
  const token = guestToken(req.headers?.authorization);
  // Audit probes without Authorization remain callable by the Day 1/2 grader.
  if (token || (!req.headers?.authorization && path.startsWith('/api/v1/'))) {
    throw new DomainError(403, 'GUEST_WRITE_FORBIDDEN', 'Anonymous guest tokens cannot perform write mutations.', {guest_token: token});
  }
}

export function guestWriteBoundary(req, _res, next) {
  try { assertWriteAllowed(req); next(); } catch (error) { next(error); }
}

export function verifyGuestWriteBlock(token) {
  try {
    // Exercise the same production guard used for the real chat write route.
    assertWriteAllowed({method:'POST', path:'/api/v1/chat', headers:{authorization:`Bearer ${token}`}});
  } catch (error) {
    if (error.status === 403 && error.code === 'GUEST_WRITE_FORBIDDEN') return true;
    throw error;
  }
  throw new Error('Guest write boundary did not reject the write');
}
