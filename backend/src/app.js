import path from 'node:path';
import {registerB3Routes} from './day2-b3-routes.js';
import {fileURLToPath} from 'node:url';
import {guestWriteBoundary} from './guest-boundary.js';
import {mergeGuestCart} from './guest-cart.js';
import {resolveQr,resolveShortCode,exportQr} from './qr.js';
import {publicRouter} from './public-api.js';
import {ScoreStreams} from './score-streams.js';
import {manageStreamKey, authorizeMedia, mediaReady} from './streaming.js';
import {manageSession} from './costream.js';
import {validateSync,syncActions} from './offline-sync.js';
import { mobileRouter } from './mobile-api.js';
import express from 'express';
import { validateReset } from './baseline.js';
import { resetDatabase } from './database.js';
import { createTokenService, context } from './auth.js';
import { findTarget, permits } from './policy.js';
import { rateLimit } from './rate-limit.js';
import { checkout, inventory, CheckoutError } from './checkout.js';
import { DomainError } from './validation.js';
import { createSport } from './sports.js';
import { appendEvent, getScore } from './scoring.js';
import { generateFixtures } from './fixtures.js';
import { createLeague } from './leagues.js';
import { getStandings } from './standings.js';
import { setupRoster, transferRoster, rosterHistory } from './roster.js';

const errorBody = (code, message, details = {}) => ({error: {code, message, details}});
export function createApp(pool, redis, tokens = createTokenService(), sign) {
  const app = express();
  app.disable('x-powered-by');
  const streams=new ScoreStreams(pool,tokens);app.locals.scoreStreams=streams;
  app.use((_req,res,next)=>{res.set('Access-Control-Allow-Origin','*');res.set('Access-Control-Allow-Headers','Authorization, Content-Type');res.set('Access-Control-Allow-Methods','GET, POST, PATCH, DELETE, OPTIONS');res.set('Access-Control-Expose-Headers','Retry-After');next();});
  app.use('/api/v1',rateLimit(redis));
  app.use(guestWriteBoundary);
  const json = express.json({limit: '1mb', strict: false, type: () => true});
  Object.defineProperty(app.locals,'activeWsConnections',{get:()=>[...streams.listeners.values()].reduce((n,sinks)=>n+sinks.size,0)});
  const b3=registerB3Routes(app,{pool,json});app.locals.b3=b3;
  const {privacy}=b3;
  const probe = (method, path, action, kind) => app[method](path, async (req, res, next) => {
    const user = tokens.verify(req.headers.authorization);
    if (!user) return res.status(401).json(errorBody('UNAUTHENTICATED', 'Valid bearer token required'));
    try {
      const target = kind ? await findTarget(pool, kind, req.params.id) : null;
      if (kind && !target) return res.status(404).json(errorBody(`${kind.toUpperCase()}_NOT_FOUND`, 'Referenced id does not exist'));
      if (!permits(user, action, target)) return res.status(403).json(errorBody('FORBIDDEN', 'Access denied'));
      next();
    } catch (error) { next(error); }
  }, json, (_req, res) => res.json({authorized: true}));
  probe('post', '/audit/v1/rbac/tenants', 'tenants');
  probe('post', '/audit/v1/rbac/leagues/:id/fixtures', 'fixtures', 'league');
  probe('post', '/audit/v1/rbac/clubs/:id/roster', 'roster', 'club');
  probe('post', '/audit/v1/rbac/clubs/:id/products', 'products', 'club');
  probe('patch', '/audit/v1/rbac/players/:id', 'player', 'player');
  probe('get', '/audit/v1/rbac/clubs/:id', 'club', 'club');
  probe('get', '/audit/v1/rbac/platform/config', 'config');
  app.use('/api/v1',publicRouter(pool,tokens,json,streams));
  app.use('/api/v1', mobileRouter(pool,redis,tokens,sign,json));
  app.use(json);
  app.get('/audit/v1/qr/:entity_id/export.:format',async(req,res,next)=>{
    try{const result=await exportQr(pool,req.params.entity_id,req.params.format);res.set('Content-Type',result.type);res.set('Cache-Control','no-store');res.end(result.body);}catch(error){next(error);}
  });
  app.get('/audit/v1/qr/:entity_id',async(req,res,next)=>{
    try{res.set('Cache-Control','no-store').json(await resolveQr(pool,req.params.entity_id,{inspect:req.query.inspect==='true',userAgent:req.headers['user-agent']}));}catch(error){next(error);}
  });
  app.get('/q/:short_code',async(req,res,next)=>{
    try{const qr=await resolveShortCode(pool,req.params.short_code,{userAgent:req.headers['user-agent']});res.set('Cache-Control','no-store').redirect(302,qr.target_route);}catch(error){next(error);}
  });
  app.post('/audit/v1/guest/cart-merge',async(req,res,next)=>{
    try{res.json(await mergeGuestCart(pool,req.body));}catch(error){next(error);}
  });
  const webDirectory=fileURLToPath(new URL('../web/',import.meta.url));
  app.use('/web',express.static(webDirectory));
  app.get('/web/*',(_req,res,next)=>res.sendFile(path.join(webDirectory,'index.html'),error=>{if(error)next(error);}));
  app.post('/audit/v1/stream/key', async (req,res,next) => {
    try {const result=await manageStreamKey(pool,req.body);res.status(result.status).json(result.response);}catch(error){next(error);}
  });
  app.post('/audit/v1/costream/session', async (req,res,next) => {
    try {const result=await manageSession(pool,req.body);res.status(result.status).json(result.response);}catch(error){next(error);}
  });
  app.post('/internal/media/auth', async (req,res,next) => {
    try {await authorizeMedia(pool,req.body);res.sendStatus(200);}catch(error){next(error);}
  });
  app.post('/audit/v1/rbac-matrix', async (_req, res, next) => {
    try {
      const users = (await pool.query('SELECT user_id, role, tenant_id, league_id, club_id, player_id FROM users ORDER BY user_id')).rows;
      res.json({tokens: Object.fromEntries(users.map(({user_id, ...claims}) => [claims.role, tokens.issue({sub: user_id, ...claims})])), context});
    } catch (error) { next(error); }
  });
  app.get('/api/v1/ping', (_req, res) => res.json({pong: true}));
  app.get('/health', async (_req, res) => {
    try {
      const result = await pool.query("SELECT value FROM app_state WHERE key = 'baseline_seeded'");
      await Promise.all([redis.ping(), mediaReady()]);
      if (result.rows[0]?.value !== true) throw new Error('Baseline not ready');
      res.json({status: 'ok'});
    } catch { res.status(503).json(errorBody('NOT_READY', 'Dependencies or baseline are not ready')); }
  });
  app.post('/audit/v1/reset', async (req, res, next) => {
    const body = req.body === undefined ? {} : req.body;
    const fields = validateReset(body);
    if (fields.length) return res.status(400).json(errorBody('VALIDATION_ERROR', 'Invalid reset parameters', {fields}));
    try { res.json(await resetDatabase(pool, redis, body, sign)); } catch (error) { next(error); }
  });
  app.post('/audit/v1/checkout', async (req, res, next) => {
    try {
      const result = await checkout(pool, redis, sign, req.body);
      res.status(result.status).json(result.response);
    } catch (error) { next(error); }
  });
  app.get('/audit/v1/inventory/:variant_id', async (req, res, next) => {
    try { res.json(await inventory(pool, req.params.variant_id)); }
    catch (error) { next(error); }
  });
  app.post('/audit/v1/sports', async (req, res, next) => {
    try { res.status(201).json(await createSport(pool, req.body)); }
    catch (error) { next(error); }
  });
  app.post('/audit/v1/events', async (req, res, next) => {
    try {
      const result = await appendEvent(pool, sign, req.body);
      res.status(result.status).json(result.response);
    } catch (error) { next(error); }
  });
  app.get('/audit/v1/score/:match_id', async (req, res, next) => {
    try { res.json(await getScore(pool, req.params.match_id)); }
    catch (error) { next(error); }
  });
  app.post('/audit/v1/fixtures', (req, res, next) => {
    try { res.json(generateFixtures(req.body)); }
    catch (error) { next(error); }
  });
  app.post('/audit/v1/leagues', async (req,res,next) => {
    try {res.status(201).json(await createLeague(pool,req.body));}catch(error){next(error);}
  });
  app.get('/audit/v1/standings/:league_id', async (req,res,next) => {
    try {res.json(await getStandings(pool,req.params.league_id));}catch(error){next(error);}
  });
  app.post('/audit/v1/roster/setup', async (req,res,next) => {
    try {res.status(201).json(await setupRoster(pool,req.body));}catch(error){next(error);}
  });
  app.post('/audit/v1/roster/transfer', async (req,res,next) => {
    try {
      const result=await transferRoster(pool,req.body);
      res.status(result.status).json(result.response);
    }catch(error){next(error);}
  });
  app.get('/audit/v1/roster/history/:player_id', async (req,res,next) => {
    try {res.json(await privacy.redactRecord(await rosterHistory(pool,req.params.player_id,req.query.as_of)));}catch(error){next(error);}
  });
  app.post('/audit/v1/offline-sync', async (req,res,next) => {
    try {res.json(await syncActions(pool,sign,null,validateSync(req.body)));}catch(error){next(error);}
  });
  app.use((_req, res) => res.status(404).json(errorBody('NOT_FOUND', 'Route not found')));
  app.use((error, _req, res, _next) => {
    if (error instanceof CheckoutError || error instanceof DomainError) return res.status(error.status).json(errorBody(error.code, error.message, error.details));
    if (error.type === 'entity.too.large') return res.status(413).json(errorBody('PAYLOAD_TOO_LARGE', 'Body exceeds 1 MB'));
    if (error.type === 'entity.parse.failed' || error instanceof URIError || error.status === 400) return res.status(400).json(errorBody('VALIDATION_ERROR', 'Malformed request', {fields: ['body']}));
    console.error('Request failed:', error.message);
    res.status(500).json(errorBody('INTERNAL_ERROR', 'Request could not be completed'));
  });
  return app;
}

