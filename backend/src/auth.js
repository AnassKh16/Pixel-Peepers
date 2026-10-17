import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const roles = ['super_admin', 'league_organizer', 'club_manager', 'player', 'viewer'];
export const context = {
  tenant_id: 'tenant-alpha', foreign_tenant_id: 'tenant-beta',
  own_league_id: 'league-alpha-1', other_league_id: 'league-alpha-2', foreign_league_id: 'league-beta-1',
  own_club_id: 'club-alpha-1', other_club_id: 'club-alpha-2', foreign_club_id: 'club-beta-1',
  own_player_id: 'player-alpha-1', other_player_id: 'player-alpha-2', foreign_player_id: 'player-beta-1'
};

export function createTokenService(secret = randomBytes(32)) {
  const mac = value => createHmac('sha256', secret).update(value).digest();
  return {
    issue(claims, lifetime = 7200) {
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString('base64url');
      const payload = Buffer.from(JSON.stringify({...claims, iat: now, exp: now + lifetime})).toString('base64url');
      const message = `${header}.${payload}`;
      return `${message}.${mac(message).toString('base64url')}`;
    },
    verify(authorization) {
      if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i.test(authorization)) return null;
      try {
        const [header, payload, signature] = authorization.slice(7).split('.');
        const metadata = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
        if (metadata.alg !== 'HS256' || metadata.crit !== undefined) return null;
        const expected = mac(`${header}.${payload}`);
        const supplied = Buffer.from(signature, 'base64url');
        if (supplied.toString('base64url') !== signature || supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return null;
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        const now = Math.floor(Date.now() / 1000);
        if (!claims || !roles.includes(claims.role) || typeof claims.sub !== 'string' || !Number.isFinite(claims.exp) || claims.exp <= now || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now))) return null;
        return claims;
      } catch { return null; }
    }
  };
}
