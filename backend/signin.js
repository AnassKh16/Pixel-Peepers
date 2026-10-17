const crypto = require('crypto');

// Sort keys by Unicode code point (Section 5.3)
function cmp(a, b) {
  const x = Array.from(a, c => c.codePointAt(0));
  const y = Array.from(b, c => c.codePointAt(0));
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return x.length - y.length;
}

function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort(cmp)
    .map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

// signature = HMAC_SHA256(DAY1_SALT, id + "|" + canonical(payload)), lowercase hex
function sign(salt, id, payload) {
  return crypto.createHmac('sha256', Buffer.from(salt, 'utf8'))
    .update(Buffer.from(id + '|' + canonical(payload), 'utf8'))
    .digest('hex');
}

// draw_lots tie-break key (Section 5.10)
function lotsKey(seed, leagueId, teamId) {
  return crypto.createHash('sha256')
    .update(`${seed}|${leagueId}|${teamId}`, 'utf8').digest('hex');
}

module.exports = { canonical, sign, lotsKey };