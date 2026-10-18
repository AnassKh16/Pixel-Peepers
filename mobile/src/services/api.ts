import { BASE_URL } from '../config';
import * as SecureStore from 'expo-secure-store';
import { readCache, writeCache, writeCacheBatch } from '../storage/database';
import { League, Sport, Club, Match, Product, Standing, CartItem, Order, QueueItem, SyncResult } from '../types';
import * as mock from './mockData';
import * as Crypto from 'expo-crypto';
export type Role = 'Super Admin' | 'League Organizer' | 'Club Manager' | 'Player' | 'Viewer';
export type User = { id: string; email: string; tenant_id: string; club_id: string | null; league_id: string | null; player_id: string | null };
export type Session = { token: string; email: string; role: Role; user?: User; server?: string };
let session: Session | null = null;
export function setApiSession(value: Session | null) { session = value; }
export function getApiSession(): Session | null { return session; }

export type AuthExpiryListener = () => void;
const authExpiryListeners = new Set<AuthExpiryListener>();
export function subscribeAuthExpiry(listener: AuthExpiryListener) {
  authExpiryListeners.add(listener);
  return () => { authExpiryListeners.delete(listener); };
}
export async function clearAuthSession() {
  try {
    await SecureStore.deleteItemAsync('skorly.token');
    await SecureStore.deleteItemAsync('skorly.session');
  } catch {}
  setApiSession(null);
}
export function handleAuthExpired() {
  void clearAuthSession();
  authExpiryListeners.forEach(listener => {
    try { listener(); } catch {}
  });
}

const roleNames: Record<string, Role> = { super_admin: 'Super Admin', league_organizer: 'League Organizer', club_manager: 'Club Manager', player: 'Player', viewer: 'Viewer' };
const listeners = new Set<(unreachable: boolean) => void>();
export function subscribeApiStatus(listener: (unreachable: boolean) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function networkStatus(unreachable: boolean) { listeners.forEach(listener => listener(unreachable)); }
const messages: Record<string, string> = {
  UNAUTHENTICATED: 'Your sign-in has expired. Sign out and sign in again.', FORBIDDEN: 'Your account does not have permission to do that.',
  PAYMENT_DECLINED: 'Your payment was declined. Choose another payment option and try again.',
  PAYMENT_CAPTURE_FAILED: 'Your payment could not be completed. Please try again.',
  OUT_OF_STOCK: 'There is not enough stock for this item. Choose another variant or reduce the quantity.',
  DUPLICATE_ORDER_ID: 'This order reference was already used with different details. Start a new checkout.',
  INVALID_DISCOUNT_CODE: 'That discount code is not valid. Please check it and try again.',
  SQUAD_FULL: 'This squad is already full.', TRANSFER_WINDOW_CLOSED: 'The transfer window is currently closed.',
  MIN_POSITION_VIOLATION: 'This move would leave the squad without enough players in a required position.',
  PLAYER_ON_LOAN: 'This player is already on loan.', NOT_IN_SQUAD: 'This player is no longer in the source squad.',
  CROSS_TENANT_TRANSFER: 'Players can only move between clubs in the same organization.',
  INVALID_BASE_VERSION: 'This action refers to a version ahead of the server. Refresh and try again.',
  DUPLICATE_REQUEST_ID: 'This roster request has already been submitted.',
};
export class ApiError extends Error {
  constructor(message: string, public status = 0, public code = '', public unreachable = false) { super(message); }
}
function errorMessage(status: number, error?: { code?: string; message?: string }) {
  if (error?.code && messages[error.code]) return messages[error.code];
  if (status === 401) return 'Your sign-in has expired. Sign out and sign in again.';
  if (status === 402) return 'Your payment could not be completed. Please try another payment option.';
  if (status === 409) return 'This item or action has changed. Refresh the information and try again.';
  if (status === 429) return 'Too many requests. Wait a few seconds and try again.';
  if (status === 404) return 'This information is no longer available.';
  if (status >= 500) return 'The server could not complete your request. Please try again shortly.';
  if (status === 400) return 'Please check your details and try again.';
  return error?.message && !/^[A-Z_0-9]+$/.test(error.message) ? error.message : 'Could not complete your request. Please try again.';
}
async function request<T>(path: string, body?: unknown, publicRoute = false): Promise<T> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const token = publicRoute ? null : await SecureStore.getItemAsync('skorly.token');
    if (!publicRoute && (!token || token.startsWith('mock-'))) {
      await clearAuthSession();
      handleAuthExpired();
      throw new ApiError('Please sign in to connect to your league.', 401);
    }
    if (!publicRoute && session?.server && session.server !== BASE_URL) {
      await clearAuthSession();
      handleAuthExpired();
      throw new ApiError('The server address changed. Sign out and sign in again.', 401);
    }
    const response = await fetch(`${BASE_URL.replace(/\/+$/, '').replace(/\/api\/v1$/, '')}/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: controller.signal,
    });
    networkStatus(false);
    let value: unknown;
    try { value = await response.json(); } catch { throw new ApiError('The server returned an unreadable response. Please try again.', response.status); }
    if (!response.ok) {
      const error = (value as { error?: { code?: string; message?: string } })?.error;
      const apiErr = new ApiError(errorMessage(response.status, error), response.status, error?.code);
      if (response.status === 401 && !publicRoute) {
        await clearAuthSession();
        handleAuthExpired();
      }
      throw apiErr;
    }
    return value as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    networkStatus(true);
    throw new ApiError('Cannot reach the server. Check the server address and your Wi-Fi connection.', 0, '', true);
  } finally { clearTimeout(timer); }
}
export async function signIn(email: string, password: string): Promise<Session> {
  let result: { token: string; role: string; user: User };
  try { result = await request('/auth/login', { email: email.trim().toLowerCase(), password }, true); }
  catch (error) { if (error instanceof ApiError && error.status === 401) throw new ApiError('The email or password is incorrect. Please try again.', 401); throw error; }
  const role = roleNames[result.role];
  if (!role || !result.token || !result.user?.id) throw new ApiError('The server returned incomplete account details. Please try again.');
  const value: Session = { token: result.token, role, email: result.user.email, user: result.user, server: BASE_URL };
  await SecureStore.setItemAsync('skorly.token', value.token);
  await SecureStore.setItemAsync('skorly.session', JSON.stringify(value));
  setApiSession(value); return value;
}
const scope = (key: string) => `rest-v1:${BASE_URL}:${session?.user?.tenant_id || session?.email || 'account'}:${key}`;
type Snapshot<T> = { data: T; savedAt: string };
async function load<T>(key: string, online: boolean, remote: () => Promise<T>, fallback: T): Promise<{ data: T; cached: boolean; savedAt: string }> {
  if (online) {
    try {
      const data = await remote(); const savedAt = new Date().toISOString();
      await writeCache(scope(key), { data, savedAt });
      return { data, cached: false, savedAt };
    } catch (error) { if (!(error instanceof ApiError) || !error.unreachable) throw error; }
  }
  networkStatus(true);
  const saved = await readCache<Snapshot<T>>(scope(key));
  return { data: saved?.data ?? fallback, savedAt: saved?.savedAt || '', cached: true };
}
export async function getLeagues(online = true): Promise<League[]> {
  const fallback: League[] = [{ id: 'offline-preview', name: 'Saved league preview', sportId: 'football', teams: mock.fixtures.flatMap(m => [{ id: m.home, name: m.home }, { id: m.away, name: m.away }]) }];
  const result = await load('leagues', online, async () => {
    const dto = await request<{ leagues: { league_id: string; name: string; sport_id: string; teams: { team_id: string; name: string }[] }[] }>('/leagues');
    return dto.leagues.map(l => ({ id: l.league_id, name: l.name, sportId: l.sport_id, teams: l.teams.map(t => ({ id: t.team_id, name: t.name })) }));
  }, fallback);
  return result.data.map(league => ({ ...league, cached: result.cached }));
}
type Score = { team_id: string; score: number };
type FixtureDTO = { match_id: string; league_id: string; sport_id: string; starts_at: string | null; status: string; home: { team_id: string; name: string }; away: { team_id: string; name: string }; score: { home: Score; away: Score }; version: number };
const matchStatus = (status: string): Match['status'] => status === 'in_progress' ? 'Live' : status === 'completed' ? 'Completed' : 'Upcoming';
export async function getFixtures(online = true, selectedLeague?: string): Promise<Match[]> {
  const leagues = await getLeagues(online);
  const chosen = selectedLeague ? leagues.filter(l => l.id === selectedLeague) : leagues;
  const lists = await Promise.all(chosen.map(async league => {
    const result = await load(`fixtures:${league.id}`, online && !league.cached, async () => {
      const dto = await request<{ fixtures: FixtureDTO[] }>(`/leagues/${encodeURIComponent(league.id)}/fixtures`);
      return dto.fixtures.map((m): Match => ({ id: m.match_id, leagueId: m.league_id, homeId: m.home.team_id, awayId: m.away.team_id,
        home: m.home.name, away: m.away.name, homeScore: m.score.home.score, awayScore: m.score.away.score,
        status: matchStatus(m.status), startsAt: m.starts_at || '', minute: 0, sport: m.sport_id, venue: '', version: m.version, updatedAt: new Date().toISOString(), events: [] }));
    }, mock.fixtures.map(m => ({ ...m, leagueId: league.id })));
    return result.data.map(m => ({ ...m, cached: result.cached, updatedAt: result.cached ? result.savedAt : m.updatedAt }));
  }));
  return lists.flat();
}
export async function getMatch(id: string, online = true): Promise<Match> {
  const savedLists = await getFixtures(online);
  const summary = savedLists.find(m => m.id === id);
  const result = await load<Match>(`match:${id}`, online, async () => {
    const dto = await request<{ match_id: string; league_id: string; sport_id: string; status: string; home: Score; away: Score; version: number; events: { event_id: string; sequence: number; type: string; payload: Record<string, unknown>; compensated: boolean }[] }>(`/matches/${encodeURIComponent(id)}`);
    const leagues = await getLeagues(online); const league = leagues.find(l => l.id === dto.league_id);
    const teamName = (teamId: string) => league?.teams.find(t => t.id === teamId)?.name || teamId;
    return { id: dto.match_id, leagueId: dto.league_id, homeId: dto.home.team_id, awayId: dto.away.team_id, home: teamName(dto.home.team_id), away: teamName(dto.away.team_id),
      homeScore: dto.home.score, awayScore: dto.away.score, version: dto.version, status: matchStatus(dto.status), sport: dto.sport_id,
      startsAt: summary?.startsAt || '', venue: summary?.venue || '', minute: 0, updatedAt: new Date().toISOString(),
      events: dto.events.map(e => ({ id: e.event_id, team: teamName(String(e.payload.team_id || '')), minute: e.sequence, points: 0,
        description: `${e.type.replace(/_/g, ' ')}${e.payload.event_type ? ` · ${e.payload.event_type}` : ''}${e.payload.reason ? ` · ${e.payload.reason}` : ''}`,
        ...(e.type === 'compensation' ? { compensates: String(e.payload.compensates) } : {}) })) } satisfies Match;
  }, summary || { ...mock.fixtures[0], id, status: 'Upcoming', home: 'Saved match', away: 'Unavailable', homeScore: 0, awayScore: 0, events: [] });
  return { ...result.data, cached: result.cached };
}
export async function getStandings(leagueId: string, online = true): Promise<Standing[]> {
  const leagues = await getLeagues(online); const league = leagues.find(l => l.id === leagueId);
  const result = await load(`standings:${leagueId}`, online && !league?.cached, async () => {
    const dto = await request<{ table: { team_id: string; played: number; won: number; drawn: number; lost: number; diff: number; points: number; status: string }[] }>(`/leagues/${encodeURIComponent(leagueId)}/standings`);
    return dto.table.map((row): Standing => ({ ...row, team: league?.teams.find(t => t.id === row.team_id)?.name || row.team_id,
      status: row.status === 'clinched' ? 'Clinched' : row.status === 'eliminated' ? 'Eliminated' : 'Still possible' }));
  }, mock.tables['NASCON Football']);
  return result.data.map(row => ({ ...row, cached: result.cached }));
}

export async function getProducts(online = true): Promise<Product[]> {
  type ProductDTO = { product_id: string; name: string; description: string; variants: { variant_id: string; size?: string; color?: string; price_minor: number; currency: string; stock: number; reserved: number }[] };
  const result = await load('products', online, async () => {
    const dto = await request<{ products: ProductDTO[] }>('/products');
    return dto.products.map((p): Product => {
      const variants = p.variants.map(v => ({ id: v.variant_id, size: v.size || 'One size', color: v.color || 'Standard', price: v.price_minor / 100, stock: v.stock, reserved: v.reserved }));
      return { id: p.product_id, name: p.name, description: p.description, price: variants[0]?.price || 0,
        sizes: [...new Set(variants.map(v => v.size))], colors: [...new Set(variants.map(v => v.color))], variants, symbol: 'shirt-outline' };
    });
  }, mock.products);
  return result.data.map(product => ({ ...product, cached: result.cached }));
}
export const getOrders = (email: string) => readCache<Order[]>(scope(`orders:${email}`)).then(items => items || []);
export const money = (value: number) => `PKR ${value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function quote(items: CartItem[], code: string) {
  const normalized = code.trim().toUpperCase();
  if (normalized && normalized !== 'WELCOME10') throw new Error('That discount code is not valid. Please check it and try again.');
  const subtotalMinor = items.reduce((total, item) => total + Math.round(item.product.price * 100) * item.quantity, 0);
  const discountMinor = normalized ? Math.floor(subtotalMinor * 0.1) : 0;
  return { subtotal: subtotalMinor / 100, discount: discountMinor / 100, shipping: 0, total: (subtotalMinor - discountMinor) / 100 };
}
export async function checkout(items: CartItem[], code: string, payment: 'success' | 'declined' | 'capture_fail', online: boolean, email: string): Promise<Order> {
  if (!online) throw new Error('Reconnect to complete your purchase. Your cart is saved.');
  if (!items.length) throw new Error('Add something to your cart before checkout.');
  if (items.some(item => !item.variantId || item.product.cached)) throw new Error('Refresh the Store and select a server product variant before checkout.');
  if (items.some(item => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10)) throw new Error('Choose between 1 and 10 of each item.');
  const orderItems = items.map(item => ({ variant_id: item.variantId!, quantity: item.quantity }));
  const discountCode = code.trim().toUpperCase();
  const token = { success: 'tok_success', declined: 'tok_declined', capture_fail: 'tok_capture_fail' }[payment];
  const body = { items: orderItems, ...(discountCode ? { discount_code: discountCode } : {}), payment: { token } };
  const fingerprint = JSON.stringify(body);
  const draftKey = scope(`checkout-draft:${email}`);
  let draft = await readCache<{ fingerprint: string; id: string }>(draftKey);
  if (!draft || draft.fingerprint !== fingerprint) {
    draft = { fingerprint, id: `mobile-${Crypto.randomUUID()}` }; await writeCache(draftKey, draft);
  }
  type CheckoutDTO = { order_id: string; status: string; items: { variant_id: string; quantity: number; unit_price_minor: number }[]; subtotal_minor: number; discount_minor: number; total_minor: number;
    receipt: { payload: { paid_at: string }; pdf_base64: string } };
  const dto = await request<CheckoutDTO>('/checkout', { order_id: draft.id, ...body });
  if (dto.status !== 'paid' || !dto.receipt?.pdf_base64) throw new ApiError('The server did not provide a paid receipt. Retry this checkout to retrieve the same order.');
  const order: Order = { id: dto.order_id, createdAt: dto.receipt.payload.paid_at, pdfBase64: dto.receipt.pdf_base64,
    items: dto.items.map(line => { const selected = items.find(item => item.variantId === line.variant_id); if (!selected) throw new ApiError('The receipt contains an unknown product variant.');
      return { ...selected, product: { ...selected.product, price: line.unit_price_minor / 100 }, quantity: line.quantity }; }),
    subtotal: dto.subtotal_minor / 100, discount: dto.discount_minor / 100, total: dto.total_minor / 100, shipping: 0, status: 'Paid', discountCode };
  const history = await getOrders(email);
  await writeCacheBatch([[scope(`orders:${email}`), [order, ...history.filter(item => item.id !== order.id)]], [draftKey, null]]);
  return order;
}

export async function getClub(online = true): Promise<Club> {
  const id = session?.user?.club_id || 'club-alpha-1';
  type ClubDTO = { club_id: string; name: string; home_venue: { name: string; address: string } | null; social_handles: Record<string, string>; staff: { name: string; role: string }[];
    roster: { player_id: string; name: string; position: string; squad_id: string; role: string; league_id: string; registration_type: string; loan_end_date: string | null }[] };
  const result = await load<Club>(`club:${id}`, online, async () => {
    const dto = await request<ClubDTO>(`/clubs/${encodeURIComponent(id)}`);
    const roster = await Promise.all(dto.roster.map(async (p, index) => ({ id: p.player_id, name: p.name, position: p.position, number: index + 1,
      squadId: p.squad_id, leagueId: p.league_id, version: await readCache<number>(scope(`roster-version:${p.league_id}:${p.player_id}`)) || 0,
      role: (p.role === 'captain' ? 'Captain' : p.role === 'substitute' ? 'Substitute' : 'Starter') as Club['roster'][number]['role'] })));
    return { id: dto.club_id, name: dto.name, venue: dto.home_venue ? `${dto.home_venue.name} · ${dto.home_venue.address}` : 'Home venue to be announced',
      social: Object.values(dto.social_handles || {}).join(' · '), roster, version: 0, staff: dto.staff.map(person => `${person.name} · ${person.role}`), history: [] };
  }, mock.club);
  return { ...result.data, cached: result.cached };
}
export async function getSport(id: string, online = true): Promise<Sport | null> {
  try {
    const result = await load<Sport | null>(`sport:${id}`, online, () => request<Sport>(`/sports/${encodeURIComponent(id)}`), null);
    return result.data ? { ...result.data, cached: result.cached } : null;
  } catch (error) {
    // The sport route is being deployed. Never invent scoring rules while waiting.
    if (error instanceof ApiError && error.status === 404) {
      const saved = await readCache<Snapshot<Sport>>(scope(`sport:${id}`));
      return saved ? { ...saved.data, cached: true } : null;
    }
    throw error;
  }
}
let devicePromise: Promise<string> | undefined;
async function deviceId() {
  if (!devicePromise) devicePromise = (async () => {
    const existing = await SecureStore.getItemAsync('skorly.device-id');
    if (existing) return existing;
    const id = `phone-${Crypto.randomUUID()}`; await SecureStore.setItemAsync('skorly.device-id', id); return id;
  })();
  return devicePromise;
}
export async function syncActions(actions: QueueItem[]): Promise<SyncResult[]> {
  if (!actions.length || actions.length > 100) throw new Error('Sync between 1 and 100 actions at a time.');
  type ResultDTO = { action_id: string; status: 'applied' | 'rejected' | 'skipped_duplicate'; resolution: string | null; error: { code: string; message: string; details: unknown } | null; server_version: number | null };
  const dto = await request<{ results: ResultDTO[] }>('/offline-sync', { device_id: await deviceId(), actions: actions.map(action => ({ ...action, type: action.type === 'roster_transfer' ? 'roster_action' : action.type })) });
  if (!Array.isArray(dto.results) || actions.some(action => !dto.results.some(result => result.action_id === action.action_id))) throw new ApiError('Sync returned incomplete results. Your pending actions are saved for retry.');
  const results: SyncResult[] = [];
  for (const result of dto.results) {
    const action = actions.find(item => item.action_id === result.action_id);
    if (!action) continue;
    if (!['applied', 'rejected', 'skipped_duplicate'].includes(result.status)) throw new ApiError('Sync returned an unknown result. Your actions are saved for retry.');
    if (result.server_version !== null && action.type === 'roster_transfer' && result.status !== 'rejected') {
      await writeCache(scope(`roster-version:${action.payload.league_id}:${action.payload.player_id}`), result.server_version);
    }
    results.push({ action_id: result.action_id, status: result.status === 'applied' ? 'Applied' : result.status === 'rejected' ? 'Rejected' : 'Already processed',
      reason: result.status === 'rejected' ? errorMessage(422, result.error || undefined) : result.status === 'skipped_duplicate' ? 'This action was already processed. It was not applied twice.' : result.resolution === 'rebased_append' ? 'Applied after newer updates. Your action was appended safely.' : 'Your change was saved.',
      ...(result.server_version !== null ? { serverVersion: result.server_version } : {}), ...(result.resolution ? { resolution: result.resolution } : {}) });
  }
  return results;
}

