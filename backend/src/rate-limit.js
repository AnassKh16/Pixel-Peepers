import { randomUUID } from 'node:crypto';
// Redis TIME and a single Lua operation make the rolling window atomic across instances.
const script = `
local time = redis.call('TIME')
local now = time[1] * 1000 + math.floor(time[2] / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 10000)
local count = redis.call('ZCARD', KEYS[1])
if count >= 100 then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return math.max(1, math.ceil((tonumber(oldest[2]) + 10000 - now) / 1000))
end
redis.call('ZADD', KEYS[1], now, ARGV[1])
redis.call('PEXPIRE', KEYS[1], 10000)
return 0
`;
export function rateLimit(redis) {
  return async (req, res, next) => {
    try {
      const retry = await redis.eval(script, {keys: [`rate:${req.ip}`], arguments: [randomUUID()]});
      if (retry > 0) return res.set('Retry-After', String(retry)).status(429).json({error: {code: 'RATE_LIMITED', message: 'Request limit exceeded', details: {}}});
      next();
    } catch (error) { next(error); }
  };
}
