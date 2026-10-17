import React, { useEffect, useRef, useState } from 'react';
import { Animated, ScrollView, Text, View } from 'react-native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { Badge, Body, Card, Chip, Empty, LinkCard, Page, Resource, Title, ui, useResource } from '../components/UI';
import { Button } from '../components/Button';
import { useApp } from '../providers/AppProvider';
import { getFixtures, getMatch, getProducts, getStandings, money } from '../services/api';
import { colors } from '../theme';
import { Routes } from '../navigation/types';
const statusIcon = { Live: 'radio-outline', Upcoming: 'calendar-outline', Completed: 'checkmark-circle-outline' } as const;
function LiveBadge() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => { let loop: Animated.CompositeAnimation | undefined; let active = true;
    import('react-native').then(({ AccessibilityInfo }) => AccessibilityInfo.isReduceMotionEnabled()).then(reduce => {
      if (!reduce && active) { loop = Animated.loop(Animated.sequence([Animated.timing(opacity, { toValue: 0.35, duration: 800, useNativeDriver: true }), Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true })])); loop.start(); }
    }); return () => { active = false; loop?.stop(); };
  }, [opacity]);
  return <Animated.View style={{ opacity }}><Badge label="LIVE" icon="radio-outline" live /></Animated.View>;
}
export function FixturesScreen({ navigation }: { navigation: Pick<NativeStackNavigationProp<Routes>, 'navigate'> }) {
  const { online, revision } = useApp(); const [filter, setFilter] = useState('All');
  const resource = useResource(() => getFixtures(online), [online, revision]);
  const matches = resource.data?.filter(item => filter === 'All' || item.status === filter) || [];
  return <Page><Title>Every game has a story.</Title><Body>Your league, from the first whistle to the final score.</Body>
    {!online && <Badge label="Offline · saved fixtures" icon="cloud-offline-outline" />}
    <View style={ui.row}>{['All', 'Live', 'Upcoming', 'Completed'].map(label => <Chip key={label} label={label} active={label === filter} onPress={() => setFilter(label)} />)}</View>
    <Resource resource={resource}>{!matches.length && <Empty message="No matches yet." />}{matches.map(match => <LinkCard key={match.id} label={`Open ${match.home} versus ${match.away}`} onPress={() => navigation.navigate('MatchDetail', { id: match.id })}>
      <View style={ui.row}><Badge label={match.status} icon={statusIcon[match.status]} live={match.status === 'Live'} /><Body>{match.sport}</Body></View>
      <Body strong>{match.home}  vs  {match.away}</Body>
      <Text style={[ui.score, { fontSize: 36, textAlign: 'left' }]}>{match.status === 'Upcoming' ? '— : —' : `${match.homeScore} : ${match.awayScore}`}</Text>
      <Body>{new Date(match.startsAt).toLocaleString()} · {match.venue}</Body>
    </LinkCard>)}</Resource>
  </Page>;
}
export function MatchDetailScreen({ route, navigation }: NativeStackScreenProps<Routes, 'MatchDetail'>) {
  const { online, revision, session, pending } = useApp(); const [tick, setTick] = useState(0);
  useEffect(() => { if (!online) return; const timer = setInterval(() => setTick(value => value + 1), 15000); return () => clearInterval(timer); }, [online]);
  const resource = useResource(() => getMatch(route.params.id, online), [route.params.id, online, revision, tick]);
  const merch = useResource(() => getProducts(online), [online]); const match = resource.data;
  const queued = pending.filter(item => item.payload.match_id === route.params.id);
  return <Page><Resource resource={resource}>{match && <>
    <Card>{match.status === 'Live' ? <LiveBadge /> : <Badge label={match.status} icon={statusIcon[match.status]} />}
      <Body strong>{match.home}</Body><Text accessibilityLabel={`${match.homeScore} to ${match.awayScore}`} style={ui.score}>{match.homeScore} : {match.awayScore}</Text><Body strong>{match.away}</Body>
      <Body>{match.sport} · {match.status === 'Live' ? `${match.minute} min · In play` : match.status === 'Upcoming' ? 'Not started' : 'Full time'}</Body>
      <Body>Last updated {new Date(match.updatedAt).toLocaleTimeString()}{!online ? ' · saved offline' : ' · demo data'}</Body>
    </Card><Title>Match timeline</Title>
    {!match.events.length && <Empty message="The story starts at kick-off. No events yet." />}
    {match.events.map(event => <Card key={event.id}><Badge label={`${event.minute} min`} icon={event.compensates ? 'arrow-undo-outline' : 'football-outline'} /><Body>{event.description}</Body></Card>)}
    {queued.map(item => <Card key={item.action_id}><Badge label="Pending" icon="time-outline" /><Body>Score event · {String(item.payload.team)}</Body></Card>)}
    {session.role === 'League Organizer' && match.status === 'Live' && <Button title="Add event" onPress={() => navigation.navigate('Scoring', { id: match.id })} />}
    <Title>Wear your support.</Title><Resource resource={merch}>{merch.data?.[0] && <LinkCard label="View pinned Alpha home jersey" onPress={() => navigation.navigate('ProductDetail', { id: merch.data![0].id })}><Badge label="Match-day pick" icon="shirt-outline" /><Body strong>{merch.data[0].name}</Body><Body>{money(merch.data[0].price)} · View product →</Body></LinkCard>}</Resource>
  </>}</Resource></Page>;
}
export function StandingsScreen() {
  const { online, revision } = useApp(); const [league, setLeague] = useState('NASCON Football');
  const resource = useResource(() => getStandings(league, online), [league, online, revision]);
  return <Page><Title>The race for the top.</Title><View style={ui.row}>{['NASCON Football', 'City Basketball'].map(name => <Chip key={name} label={name} active={league === name} onPress={() => setLeague(name)} />)}</View>
    <Body>Swipe the table to see all stats. P played · W won · D drawn · L lost · diff score difference.</Body>
    {!online && <Badge label="Offline · saved standings" icon="cloud-offline-outline" />}
    <Resource resource={resource}>{!resource.data?.length ? <Empty message="Standings will appear after the first matches." /> : <ScrollView horizontal accessibilityLabel="League standings, scroll horizontally"><View>
      <View style={[ui.row, { backgroundColor: colors.sand, padding: 12, flexWrap: 'nowrap' }]}>{['#', 'Team', 'P', 'W', 'D', 'L', 'diff', 'pts', 'Status'].map((label, index) => <Text key={label} style={[ui.badgeText, { width: index === 1 ? 150 : index === 8 ? 170 : 40 }]}>{label}</Text>)}</View>
      {resource.data.map((row, index) => <View key={row.team} style={[ui.row, { flexWrap: 'nowrap', padding: 12, borderBottomWidth: 1, borderBottomColor: colors.sand, borderLeftWidth: 3, borderLeftColor: row.status === 'Clinched' ? colors.coral : colors.cream }]}>
        {[index + 1, row.team, row.played, row.won, row.drawn, row.lost, row.diff, row.points].map((value, cell) => <Text key={cell} style={[ui.body, { width: cell === 1 ? 150 : 40 }]}>{value}</Text>)}
        <View style={{ width: 170 }}><Badge label={row.status} icon={row.status === 'Clinched' ? 'trophy-outline' : row.status === 'Eliminated' ? 'close-circle-outline' : 'hourglass-outline'} /></View>
      </View>)}
    </View></ScrollView>}</Resource>
  </Page>;
}

