import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import * as Crypto from 'expo-crypto';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { colors } from '../theme';
import { friendlyError } from '../services/errors';
import { Session, syncActions, subscribeApiStatus } from '../services/api';
import { CartItem, QueueItem, SyncResult } from '../types';
import { readCache, writeCache, writeCacheBatch } from '../storage/database';
import { BASE_URL } from '../config';

type State = { session: Session; online: boolean; cached: boolean; syncing: boolean; pending: QueueItem[]; results: SyncResult[];
  revision: number; toast: string; notify: (message: string) => void; sync: () => Promise<void>;
  enqueue: (type: QueueItem['type'], version: number, payload: QueueItem['payload']) => Promise<void>;
  cart: CartItem[]; setCart: (items: CartItem[]) => Promise<void> };
const Context = createContext<State | null>(null);
export function useApp() { const value = useContext(Context); if (!value) throw new Error('App provider missing'); return value; }
export function AppProvider({ session, children }: React.PropsWithChildren<{ session: Session }>) {
  const [online, setOnline] = useState(false); const [syncing, setSyncing] = useState(false);
  const [networkRevision, setNetworkRevision] = useState(0);
  const [cached, setCached] = useState(false);
  useEffect(() => subscribeApiStatus(setCached), []);
  const [pending, setPending] = useState<QueueItem[]>([]); const [results, setResults] = useState<SyncResult[]>([]);
  const [cart, updateCart] = useState<CartItem[]>([]); const [revision, setRevision] = useState(0);
  const [toast, notify] = useState('Welcome back.'); const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false); const [retry, setRetry] = useState(0);
  const working = useRef(false); const pendingRef = useRef<QueueItem[]>([]);
  const store = `${BASE_URL}:${session.email}`;
  const chain = useRef(Promise.resolve());
  function serialize(task: () => Promise<void>) {
    const next = chain.current.then(task); chain.current = next.catch(() => {}); return next;
  }
  useEffect(() => {
    setReady(false); setStorageError(false);
    let active = true;
    Promise.all([readCache<QueueItem[]>(`${store}:queue`), readCache<CartItem[]>(`${store}:cart`), readCache<SyncResult[]>(`${store}:results`)])
      .then(([queue, savedCart, savedResults]) => { if (active) { pendingRef.current = queue || []; setPending(queue || []); updateCart(savedCart || []); setResults(savedResults || []); setReady(true); } })
      .catch(() => { if (active) setStorageError(true); });
    // LAN APIs can be reachable even when the hotspot has no internet uplink.
    const unsubscribe = NetInfo.addEventListener(state => { setOnline(state.isConnected === true); setNetworkRevision(value => value + 1); });
    return () => { active = false; unsubscribe(); };
  }, [store, retry]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => notify(''), 4000); return () => clearTimeout(timer); }, [toast]);
  async function sync() {
    if (!online || !ready || working.current) return;
    working.current = true; setSyncing(true);
    try {
      await serialize(async () => {
        const history: SyncResult[] = [];
        for (let batch = pendingRef.current.slice(0, 100); batch.length; batch = pendingRef.current.slice(0, 100)) {
          const batchResults = await syncActions(batch);
          history.push(...batchResults);
          const finished = new Set(batchResults.map(result => result.action_id));
          const remaining = pendingRef.current.filter(action => !finished.has(action.action_id));
          await writeCacheBatch([[`${store}:results`, history], [`${store}:queue`, remaining]]);
          pendingRef.current = remaining; setPending(remaining); setResults([...history]);
          setRevision(value => value + 1);
        }
        if (history.length) { setRevision(value => value + 1); notify(`Sync finished: ${history.filter(item => item.status === 'Applied').length} applied, ${history.filter(item => item.status === 'Rejected').length} rejected. Review Sync Status for details.`); }
      });
    } catch (error) { notify(`${friendlyError(error, 'Sync could not finish.')} Pending actions are saved.`); }
    finally { working.current = false; setSyncing(false); }
  }
  useEffect(() => { if (online && ready && pending.length) void sync(); }, [online, ready, pending.length, networkRevision]);
  async function enqueue(type: QueueItem['type'], version: number, payload: QueueItem['payload']) {
    if (!ready) throw new Error('Your saved actions are still loading. Please try again shortly.');
    if (session.role !== 'Super Admin' && ((type === 'score_event' && session.role !== 'League Organizer') || (type === 'roster_transfer' && session.role !== 'Club Manager'))) throw new Error('Your account cannot perform this action.');
    await serialize(async () => {
      const id = Crypto.randomUUID();
      const stablePayload = type === 'score_event' ? { ...payload, event_id: payload.event_id || `event-${id}` } : { ...payload, request_id: payload.request_id || `roster-${id}` };
      const item: QueueItem = { action_id: id, type, queued_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), base_version: version, payload: stablePayload };
      const next = [...pendingRef.current, item];
      await writeCache(`${store}:queue`, next); pendingRef.current = next; setPending(next);
    });
    notify(online ? 'Action saved. Syncing now.' : 'Action saved as Pending. It will sync when you reconnect.');
  }
  async function setCart(items: CartItem[]) {
    await writeCache(`${store}:cart`, items); updateCart(items);
  }
  if (!ready) return <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 20, backgroundColor: colors.cream }}>{storageError ? <><Text style={{ color: colors.forest, fontSize: 16 }}>Could not load saved actions. Please try again.</Text><Button title="Retry" onPress={() => setRetry(value => value + 1)} /></> : <ActivityIndicator accessibilityLabel="Loading saved actions" color={colors.forest} />}</View>;
  return <Context.Provider value={{ session, online, cached, syncing, pending, results, revision, toast, notify, sync, enqueue, cart, setCart }}>{children}</Context.Provider>;
}
