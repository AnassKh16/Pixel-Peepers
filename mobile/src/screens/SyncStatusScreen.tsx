import React from 'react';
import { Badge, Body, Card, Empty, Page, Title } from '../components/UI';
import { Button } from '../components/Button';
import { useApp } from '../providers/AppProvider';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Routes } from '../navigation/types';
import { friendlyError } from '../services/errors';
export function SyncStatusScreen({ navigation }: NativeStackScreenProps<Routes, 'SyncStatus'>) {
  const { online, cached, pending, syncing, results, sync } = useApp();
  return <Page><Title>All caught up?</Title><Badge label={syncing ? 'Syncing' : online && !cached ? 'Online' : 'Offline - cached'} icon={online && !cached ? 'checkmark-circle-outline' : 'cloud-offline-outline'} />
    <Body>{pending.length} pending actions. Saved on this device, even after restarting the app.</Body>
    {!online && <Body>Reconnect to sync. Your actions stay safely in the queue.</Body>}
    {cached && online && <Body>The server was unreachable. Your changes are saved; tap Sync now to retry.</Body>}
    {syncing && <Body>Syncing your saved actions. Results will appear below.</Body>}
    <Button title="Sync now" onPress={() => void sync()} busy={syncing} disabled={!online || !pending.length} />
    {!pending.length && <Empty message="No pending actions. You’re up to date." />}
    {pending.map(item => <Card key={item.action_id}><Badge label="Pending" icon="time-outline" /><Body strong>{item.type === 'score_event' ? 'Score event' : 'Roster change'}</Body><Body>{new Date(item.queued_at).toLocaleString()}</Body><Body>{String(item.payload.type)}{item.type === 'roster_transfer' ? ` · ${item.payload.player_id}` : ''}</Body></Card>)}
    <Title>Last sync results</Title>{!results.length && <Empty message="Sync results will appear here after your first action." />}
    {results.map(item => <Card key={item.action_id}><Badge label={item.status} icon={item.status === 'Applied' ? 'checkmark-circle-outline' : item.status === 'Rejected' ? 'close-circle-outline' : 'repeat-outline'} /><Body>{friendlyError(item.reason, 'This action could not be completed. Refresh its match or roster and try again.')}</Body></Card>)}
    <Button title="Back to fixtures" onPress={() => navigation.popTo('Home', { screen: 'Fixtures' })} />
  </Page>;
}
