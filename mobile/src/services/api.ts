import { BASE_URL } from '../config';
import { readCache, writeCache, writeCacheBatch } from '../storage/database';
import { Club, Match, Product, Standing, CartItem, Order, QueueItem, SyncResult } from '../types';
import * as mock from './mockData';
import * as Crypto from 'expo-crypto';
export type Role = 'Super Admin' | 'League Organizer' | 'Club Manager' | 'Player' | 'Viewer';
export type Session = { token: string; email: string; role: Role };
const roles: Record<string, Role> = {
  admin: 'Super Admin', organizer: 'League Organizer', manager: 'Club Manager',
  player: 'Player', viewer: 'Viewer',
};

// Mock implementation. Replace the implementation here when the REST contract is ready.
export async function signIn(email: string, password: string): Promise<Session> {
  await new Promise(resolve => setTimeout(resolve, 500));
  const normalized = email.trim().toLowerCase();
  const role = roles[normalized.split('@')[0]];
  if (!role || normalized !== `${normalized.split('@')[0]}@nascon.test` || password !== 'Nascon@26') {
    throw new Error('The email or password is incorrect. Please try again.');
  }
  return { token: `mock-session-${role}`, email: normalized, role };
}

// All screen-facing API functions live here. This preview is intentionally mocked.
// Cache keys are scoped by server so changing hosts does not mix league data.
const scope = (key: string) => `${BASE_URL}:${key}`;
async function read<T>(key: string, seed: T, online: boolean): Promise<T> {
  const cached = await readCache<T>(scope(key));
  if (!online) {
    if (cached !== null) return cached;
    throw new Error('Connect once to save this information for offline use.');
  }
  await new Promise(resolve => setTimeout(resolve, 250));
  if (cached !== null) return cached;
  await writeCache(scope(key), seed);
  return seed;
}
export const getFixtures = (online = true) => read<Match[]>('fixtures', mock.fixtures, online);
export async function getMatch(id: string, online = true) {
  const match = (await getFixtures(online)).find(item => item.id === id);
  if (!match) throw new Error('This match is no longer available.');
  return match;
}
export const getStandings = (league: string, online = true) => read<Standing[]>(`standings:${league}`, mock.tables[league] || [], online);
export const getClub = (online = true) => read<Club>('club', mock.club, online);
export const getProducts = (online = true) => read<Product[]>('products', mock.products, online);
export const getOrders = (email: string) => readCache<Order[]>(scope(`orders:${email}`)).then(items => items || []);
export const money = (value: number) => `PKR ${value.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function quote(items: CartItem[], code: string) {
  const normalized = code.trim().toUpperCase();
  if (normalized && normalized !== 'SKORLY10') throw new Error('That discount code is not valid. Try SKORLY10 for the demo.');
  const subtotal = items.reduce((total, item) => total + item.product.price * item.quantity, 0);
  const discount = normalized ? Math.round(subtotal * 0.1) : 0;
  const shipping = subtotal > 0 ? 250 : 0;
  return { subtotal, discount, shipping, total: subtotal - discount + shipping };
}
export async function checkout(items: CartItem[], code: string, payment: 'success' | 'declined' | 'capture_fail', online: boolean, email: string): Promise<Order> {
  if (!online) throw new Error('Connect to the internet to complete your purchase. Your cart is saved.');
  if (!items.length) throw new Error('Add something to your cart before checkout.');
  if (items.some(item => item.quantity < 1 || item.quantity > 10)) throw new Error('Choose between 1 and 10 of each item.');
  const order: Order = { id: Crypto.randomUUID(), createdAt: new Date().toISOString(), items,
    ...quote(items, code), discountCode: code, status: payment === 'success' ? 'Paid' : payment === 'declined' ? 'Declined' : 'Capture failed' };
  await new Promise(resolve => setTimeout(resolve, 500));
  await writeCache(scope(`orders:${email}`), [order, ...await getOrders(email)]);
  return order;
}
export async function syncAction(action: QueueItem, role: Role): Promise<SyncResult> {
  const updates: [string, unknown][] = [];
  const applied = await readCache<string[]>(scope('applied')) || [];
  if (applied.includes(action.action_id)) return { action_id: action.action_id, status: 'Applied', reason: 'Already applied safely.' };
  const reject = (reason: string): SyncResult => ({ action_id: action.action_id, status: 'Rejected', reason });
  if (action.type === 'score_event') {
    if (role !== 'League Organizer') return reject('Only league organizers can record score events.');
    const matches = await getFixtures();
    const match = matches.find(item => item.id === action.payload.match_id);
    if (!match || match.status !== 'Live') return reject('This match is not live.');
    if (match.version !== action.base_version) return reject('The score changed since this action was queued. Review the match and try again.');
    const team = String(action.payload.team);
    if (team !== match.home && team !== match.away) return reject('Choose one of the teams in this match.');
    const compensation = action.payload.compensates ? match.events.find(event => event.id === action.payload.compensates) : undefined;
    if (action.payload.compensates && (!compensation || match.events.some(event => event.compensates === compensation.id))) return reject('That event has already been undone or is unavailable.');
    if (compensation && !String(action.payload.reason || '').trim()) return reject('Give a reason before undoing an event.');
    const points = compensation ? -compensation.points : Number(action.payload.points);
    if (!compensation && (![1, 2, 3].includes(points) || (match.sport === 'Football' && points !== 1))) return reject('Choose a valid score event for this sport.');
    if (compensation && compensation.team !== team) return reject('Undo the event for the original team.');
    const event = { id: action.action_id, team, points, minute: match.minute,
      description: compensation ? `Undo · ${String(action.payload.reason).trim()}` : `${points === 1 && match.sport === 'Football' ? 'Goal' : `+${points} points`} · ${team}`,
      ...(compensation ? { compensates: compensation.id } : {}) };
    if (team === match.home) match.homeScore += points; else match.awayScore += points;
    match.events.push(event); match.version++; match.updatedAt = new Date().toISOString();
    updates.push([scope('fixtures'), matches]);
  } else {
    if (role !== 'Club Manager') return reject('Only club managers can change the roster.');
    const club = await getClub();
    if (club.version !== action.base_version) return reject('The roster changed since this action was queued. Review the squad and try again.');
    const player = club.roster.find(item => item.id === action.payload.player_id);
    if (!player) return reject('This player has already left the squad.');
    const operation = action.payload.operation;
    if (!['Transfer', 'Loan', 'Release'].includes(String(operation))) return reject('Choose a transfer, loan, or release.');
    if (operation !== 'Release' && !['Beta Athletic', 'Cedar FC'].includes(String(action.payload.destination))) return reject('Choose a destination club.');
    if (action.payload.destination === 'Beta Athletic') return reject('This squad is already full. Choose another club.');
    if (operation === 'Loan') {
      const start = Date.parse(String(action.payload.start_date)); const end = Date.parse(String(action.payload.end_date));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return reject('Choose a loan end date after the start date.');
    }
    club.roster = club.roster.filter(item => item.id !== player.id); club.version++;
    club.history.unshift(`${operation} · ${player.name}${operation !== 'Release' ? ` to ${action.payload.destination}` : ''}`);
    updates.push([scope('club'), club]);
  }
  await writeCacheBatch([...updates, [scope('applied'), [...applied, action.action_id]]]);
  return { action_id: action.action_id, status: 'Applied', reason: 'Your change was saved.' };
}
