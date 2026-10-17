import React, { useState } from 'react';
import { Alert, Modal, ScrollView, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { Badge, Body, Card, Chip, Empty, Page, Resource, Title, ui, useResource } from '../components/UI';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { useApp } from '../providers/AppProvider';
import { getClub, getFixtures, getMatch, getSport } from '../services/api';
import { Routes } from '../navigation/types';
import { Player } from '../types';
import { colors } from '../theme';

export function ClubScreen({ navigation }: { navigation: Pick<NativeStackNavigationProp<Routes>, 'navigate'> }) {
  const { online, revision, session, pending } = useApp(); const [tab, setTab] = useState('Roster');
  const resource = useResource(() => getClub(online), [online, revision]); const club = resource.data;
  return <Page><Resource resource={resource}>{club && <>
    <Card dark><Text accessibilityLabel="Alpha United club crest" style={{ color: colors.coral, fontFamily: 'Sora_800ExtraBold', fontSize: 48 }}>AU</Text>
      <Text style={[ui.title, { color: colors.cream }]}>{club.name}</Text><Text style={[ui.body, { color: colors.cream }]}>{club.venue}{'\n'}{club.social}</Text></Card>
    {(!online || club.cached) && <Badge label="Offline - cached" icon="cloud-offline-outline" />}
    <View style={ui.row}>{['Roster', 'Staff', 'History'].map(label => <Chip key={label} label={label} active={tab === label} onPress={() => setTab(label)} />)}</View>
    {tab === 'Roster' && <>{!club.roster.length && <Empty message="Your club’s next chapter starts with its first player." />}{club.roster.map(player => <Card key={player.id}><Body strong>#{player.number} · {player.name}</Body><Body>{player.position}</Body><Badge label={player.role} icon="person-outline" />
      {pending.some(item => item.payload.player_id === player.id) && <Badge label="Roster change Pending" icon="time-outline" />}</Card>)}
      {['Club Manager', 'Super Admin'].includes(session.role) && <Button title="Manage roster" onPress={() => navigation.navigate('Roster')} />}</>}
    {tab === 'Staff' && (club.staff.length ? club.staff.map(person => <Card key={person}><Body>{person}</Body></Card>) : <Empty message="Staff announcements are coming soon." />)}
    {tab === 'History' && (club.history.length ? club.history.map((event, index) => <Card key={index}><Body>{event}</Body></Card>) : <Empty message="Your club’s story is just beginning." />)}
  </>}</Resource></Page>;
}
export function RosterScreen() {
  const { online, revision, session, enqueue, pending } = useApp();
  const resource = useResource(() => getClub(online), [online, revision]);
  const [player, setPlayer] = useState<Player>(); const [operation, setOperation] = useState('Transfer'); const [destination, setDestination] = useState('squad-alpha-2');
  const [start, setStart] = useState(new Date()); const [end, setEnd] = useState(new Date(Date.now() + 30 * 86400000));
  const [picker, setPicker] = useState<'start' | 'end'>(); const [busy, setBusy] = useState(false);
  if (!['Club Manager', 'Super Admin'].includes(session.role)) return <Page><Empty message="Roster management is available to club managers." /></Page>;
  async function submit() {
    if (!player || !resource.data) return; setBusy(true);
    try {
      if (!player.leagueId || !player.squadId) throw new Error('Open the real club roster online once before queuing a roster change.');
      const date = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
      await enqueue('roster_transfer', player.version || 0, { player_id: player.id, league_id: player.leagueId, type: operation.toLowerCase(), from_squad_id: player.squadId,
        to_squad_id: operation === 'Release' ? null : destination.trim(), effective_date: date(start), reason: 'Club manager roster update',
        ...(operation === 'Loan' ? { loan_end_date: date(end) } : {}) }); setPlayer(undefined);
    }
    catch (e) { Alert.alert('Could not save action', e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  function confirm() {
    if (!player) return;
    if (operation !== 'Release' && !destination.trim()) { Alert.alert('Destination needed', 'Enter the destination squad ID.'); return; }
    if (operation === 'Loan' && end <= start) { Alert.alert('Check loan dates', 'Choose an end date after the start date.'); return; }
    Alert.alert(`${operation} ${player.name}?`, operation === 'Release' ? 'This removes the player from your squad when applied.' : `Move this player to ${destination}${operation === 'Loan' ? ` until ${end.toLocaleDateString()}` : ''}? The server will check squad rules.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: `Confirm ${operation.toLowerCase()}`, style: 'destructive', onPress: () => void submit() }]);
  }
  return <Page><Title>Build your next chapter.</Title><Body>Changes stay Pending until the server applies them. The server checks transfer windows, capacity, and squad rules.</Body>
    {resource.data?.cached && <Badge label="Offline - cached" icon="cloud-offline-outline" />}
    <Resource resource={resource}>{!resource.data?.roster.length && <Empty message="There are no players to manage." />}{resource.data?.roster.map(item => <Card key={item.id}><Body strong>{item.name}</Body><Badge label={item.role} icon="person-outline" />
      {pending.some(action => action.payload.player_id === item.id) ? <Badge label="Pending roster change" icon="time-outline" /> : <Button title={`Actions for ${item.name}`} onPress={() => { setPlayer(item); setOperation('Transfer'); }} />}</Card>)}</Resource>
    <Modal visible={!!player} transparent animationType="slide" onRequestClose={() => { if (!busy) setPlayer(undefined); }}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#16261FCC', padding: 16 }}><ScrollView contentContainerStyle={[ui.card, { backgroundColor: colors.cream, paddingBottom: 32 }]}>
        <Title>{player?.name}</Title><View style={ui.row}>{['Transfer', 'Loan', 'Release'].map(label => <Chip key={label} label={label} active={operation === label} onPress={() => setOperation(label)} />)}</View>
        {operation !== 'Release' && <><Body strong>Destination squad</Body><Input accessibilityLabel="Destination squad ID" value={destination} onChangeText={setDestination} autoCapitalize="none" autoCorrect={false} /><Body>Demo destination: squad-alpha-2 (club-alpha-2).</Body></>}
        {operation === 'Loan' && <><Button title={`Start · ${start.toLocaleDateString()}`} onPress={() => setPicker('start')} /><Button title={`End · ${end.toLocaleDateString()}`} onPress={() => setPicker('end')} />
          {picker && <DateTimePicker value={picker === 'start' ? start : end} mode="date" minimumDate={picker === 'end' ? start : new Date()} onChange={(_, date) => { if (date) (picker === 'start' ? setStart : setEnd)(date); setPicker(undefined); }} />}</>}
        <Button title={`Review ${operation.toLowerCase()}`} onPress={confirm} busy={busy} /><Button title="Cancel" onPress={() => setPlayer(undefined)} busy={busy} />
      </ScrollView></View>
    </Modal>
  </Page>;
}
export function ScoringScreen({ route }: NativeStackScreenProps<Routes, 'Scoring'>) {
  const { session, online, revision, enqueue, pending } = useApp(); const [matchId, setMatchId] = useState(route.params.id || ''); const [team, setTeam] = useState('');
  const [undoId, setUndoId] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  const fixtures = useResource(() => getFixtures(online), [online, revision]);
  const match = useResource(() => matchId ? getMatch(matchId, online) : Promise.resolve(null), [matchId, online, revision]);
  const selected = match.data; const chosenTeam = team || selected?.home || '';
  const sport = useResource(() => selected ? getSport(selected.sport, online) : Promise.resolve(null), [selected?.sport, online, revision]);
  if (!['League Organizer', 'Super Admin'].includes(session.role)) return <Page><Empty message="Scoring entry is available to league organizers." /></Page>;
  async function record(eventType: string, compensates?: string) {
    if (!selected) return; setBusy(true);
    try {
      if (!sport.data) throw new Error('Loading event types... Please wait for your sport configuration.');
      const teamId = chosenTeam === selected.home ? selected.homeId : selected.awayId;
      if (!compensates && (!sport.data?.scoring_events || !(eventType in sport.data.scoring_events) || !teamId)) throw new Error('Wait for the league’s event types to load, then choose a team.');
      await enqueue('score_event', selected.version, { match_id: selected.id, type: compensates ? 'compensation' : 'score',
        payload: compensates ? { compensates, reason: reason.trim() } : { team_id: teamId, event_type: eventType.trim() } }); setUndoId(''); setReason('');
    } catch (e) { Alert.alert('Event not saved', e instanceof Error ? e.message : 'Please try again.'); } finally { setBusy(false); }
  }
  return <Page><Title>Call the moment.</Title><Body>Pick a live match, then a team and score event.</Body>
    {fixtures.data?.some(item => item.cached) && <Badge label="Offline - cached" icon="cloud-offline-outline" />}
    <Resource resource={fixtures}>{!fixtures.data?.some(item => item.status === 'Live') && <Empty message="No live matches are ready for scoring." />}<View style={ui.row}>{fixtures.data?.filter(item => item.status === 'Live').map(item => <Chip key={item.id} label={`${item.home} vs ${item.away}`} active={matchId === item.id} onPress={() => { setMatchId(item.id); setTeam(''); }} />)}</View></Resource>
    {!!matchId && <Resource resource={match}>{selected && <><Card><Body strong>{selected.home} vs {selected.away}</Body><Text style={ui.score}>{selected.homeScore} : {selected.awayScore}</Text><Badge label={selected.cached || !online ? 'Offline - cached' : selected.status} icon={selected.cached || !online ? 'cloud-offline-outline' : 'radio-outline'} /></Card>
      {selected.status === 'Live' && <><View style={ui.row}>{[selected.home, selected.away].map(label => <Chip key={label} label={label} active={chosenTeam === label} onPress={() => setTeam(label)} />)}</View>
        <Resource resource={sport}>{!sport.data || !Object.keys(sport.data.scoring_events || {}).length ? <><Body>Loading event types...</Body><Button title="Retry event types" onPress={sport.reload} /></> : <>
          {sport.data.cached && <Badge label="Offline - cached" icon="cloud-offline-outline" />}
          <View style={ui.row}>{Object.entries(sport.data.scoring_events).map(([key, value]) => {
            const amount = typeof value === 'number' ? String(value) : value.points !== undefined ? `${value.points} points` : value.runs !== undefined ? `${value.runs} runs` : value.rounds !== undefined ? `${value.rounds} rounds` : '';
            return <Button key={key} title={`${key.replace(/_/g, ' ')}${amount ? ` · ${amount}` : ''}`} busy={busy} onPress={() => void record(key)} />;
          })}</View>
        </>}</Resource></>}
      <Title>Event log</Title>{!selected.events.length && <Empty message="No score events yet." />}
      {selected.events.map(event => <Card key={event.id}><Body>Event {event.minute} · {event.description}</Body>
        {!!sport.data && !event.compensates && !selected.events.some(item => item.compensates === event.id) && selected.status === 'Live' && <Button title="Undo (compensate)" onPress={() => { setUndoId(event.id); setReason(''); }} />}</Card>)}
      {pending.filter(item => item.payload.match_id === matchId).map(item => <Card key={item.action_id}><Badge label="Pending" icon="time-outline" /><Body>{item.payload.type === 'compensation' ? 'Undo event' : 'Score event'}</Body></Card>)}
    </>}</Resource>}
    <Modal visible={!!undoId} transparent animationType="slide" onRequestClose={() => setUndoId('')}><View style={{ flex: 1, justifyContent: 'center', backgroundColor: '#16261FCC', padding: 20 }}><Card>
      <Title>Undo this event?</Title><Body>The original remains in the log. A compensating event adjusts the score.</Body><Input accessibilityLabel="Reason for undo" placeholder="Why should this event be undone?" value={reason} onChangeText={setReason} multiline />
      <Button title="Confirm undo" busy={busy} onPress={() => { if (!reason.trim()) { Alert.alert('Reason needed', 'Explain why this score event should be undone.'); return; } void record('', undoId); }} /><Button title="Cancel" busy={busy} onPress={() => setUndoId('')} />
    </Card></View></Modal>
  </Page>;
}

