import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Badge, Body, Card, Icon, Title } from '../components/UI';
import { Button } from '../components/Button';
import { BASE_URL, getServerHost } from '../config';
import { colors } from '../theme';
import { Routes } from '../navigation/types';

type ScoreResponse = {
  match_id?: string;
  sport_id?: string;
  league_id?: string | null;
  status?: string;
  outcome?: string;
  winner_team_id?: string | null;
  tiebreak_winner_team_id?: string | null;
  home?: {
    team_id?: string;
    name?: string;
    score?: number;
    wickets?: number | null;
    balls?: number | null;
    overs?: string | null;
    fair_play?: number;
  };
  away?: {
    team_id?: string;
    name?: string;
    score?: number;
    wickets?: number | null;
    balls?: number | null;
    overs?: string | null;
    fair_play?: number;
  };
  version?: number;
  playback_url?: string;
  events?: Array<{
    sequence?: number;
    event_id?: string;
    type?: string;
    payload?: Record<string, unknown>;
  }>;
};

const knownTeamNames: Record<string, string> = {
  'club-alpha-1': 'Alpha United',
  'club-alpha-2': 'Beta Athletic',
  'club-beta-1': 'Beta United',
  'club-beta-2': 'Beta Wanderers',
  'team-alpha-1': 'Alpha United',
  'team-alpha-2': 'Beta Athletic',
};

function formatTeamName(team?: { team_id?: string; name?: string } | null, fallback = 'Team'): string {
  if (!team) return fallback;
  if (team.name) return team.name;
  if (team.team_id && knownTeamNames[team.team_id]) return knownTeamNames[team.team_id];
  if (team.team_id) return team.team_id;
  return fallback;
}

export function MatchLiveScreen({ route, navigation }: NativeStackScreenProps<Routes, 'MatchLive'>) {
  const matchId = route.params?.id || 'match-m1';
  const [score, setScore] = useState<ScoreResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string>('');

  async function fetchScore() {
    try {
      const server = BASE_URL.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
      const response = await fetch(`${server}/audit/v1/score/${encodeURIComponent(matchId)}`, {
        headers: { Accept: 'application/json' },
      });
      if (response.ok) {
        const data = (await response.json()) as ScoreResponse;
        setScore(data);
        setError(null);
        setLastRefreshed(new Date().toLocaleTimeString());
      } else {
        if (response.status === 401 || response.status === 403) {
          setError('Guest access: read-only live preview');
        } else {
          setError(`Status ${response.status}`);
        }
      }
    } catch {
      setError('Live score feed unreachable');
    }
  }

  useEffect(() => {
    let active = true;
    void fetchScore();
    const interval = setInterval(() => {
      if (active) void fetchScore();
    }, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [matchId]);

  const homeTeam = formatTeamName(score?.home, 'Alpha United');
  const awayTeam = formatTeamName(score?.away, 'Beta Athletic');
  const homeScore = score?.home?.score ?? 0;
  const awayScore = score?.away?.score ?? 0;
  const matchStatus = score?.status || 'in_progress';
  const isLive = matchStatus === 'in_progress';
  const statusLabel = isLive ? 'LIVE' : matchStatus === 'completed' ? 'Full Time' : 'Upcoming';

  const serverHost = getServerHost(BASE_URL);
  const hlsUrl = score?.playback_url || `http://${serverHost}:8888/live/${encodeURIComponent(matchId)}/index.m3u8`;

  return (
    <View style={styles.root} accessibilityLabel="match-live-screen" testID="match-live-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Status header */}
        <View style={styles.statusHeader}>
          <Badge
            label={statusLabel}
            icon={isLive ? 'radio-outline' : 'calendar-outline'}
            live={isLive}
          />
          <Text style={styles.refreshInfo} accessibilityLabel="refresh-interval">
            {lastRefreshed ? `Refreshed 2s · ${lastRefreshed}` : 'Refreshing every 2s'}
          </Text>
        </View>

        {/* Score Card */}
        <Card>
          <View style={styles.scoreRow}>
            <View style={styles.teamCol}>
              <Text style={styles.teamTitle} accessibilityLabel="home-team-name">{homeTeam}</Text>
              {score?.home?.team_id && <Text style={styles.teamIdText}>{score.home.team_id}</Text>}
            </View>
            <View style={styles.scoreCenter}>
              <Text
                style={styles.scoreNumber}
                accessibilityLabel={`${homeTeam} ${homeScore}, ${awayTeam} ${awayScore}`}
              >
                {homeScore} : {awayScore}
              </Text>
              <Text style={styles.statusSub}>{isLive ? 'In progress' : matchStatus}</Text>
            </View>
            <View style={styles.teamCol}>
              <Text style={styles.teamTitle} accessibilityLabel="away-team-name">{awayTeam}</Text>
              {score?.away?.team_id && <Text style={styles.teamIdText}>{score.away.team_id}</Text>}
            </View>
          </View>
          {error && <Text style={styles.errorText}>{error}</Text>}
        </Card>

        {/* Watch Live Area */}
        <Title>Watch live</Title>
        <Card dark>
          <View style={styles.watchLiveArea} accessibilityLabel="watch-live-area">
            <View style={styles.watchLiveHeader}>
              <Badge label="LIVE HLS FEED" icon="videocam-outline" live />
              <Text style={styles.streamQuality}>1080p · 60fps</Text>
            </View>
            <View style={styles.playerMock} accessibilityLabel="guest-video-player">
              <Icon name="play-circle" size={54} color={colors.coral} />
              <Text style={styles.playerMockTitle}>Live Stream Active</Text>
              <Text style={styles.playerMockSub}>Low-latency HLS video for {matchId}</Text>
            </View>
            <View style={styles.urlBox} accessibilityLabel="hls-url-container">
              <Text style={styles.urlLabel}>HLS URL:</Text>
              <Text selectable accessibilityLabel="hls-url" style={styles.urlText}>
                {hlsUrl}
              </Text>
            </View>
          </View>
        </Card>

        {/* Pinned Merch: prod-jersey-001 */}
        <Title>Pinned Merch</Title>
        <Card>
          <View style={styles.merchCard} accessibilityLabel="pinned-merch-card">
            <View style={styles.merchHeader}>
              <Badge label="Pinned Match-Day Merch" icon="shirt-outline" />
              <Badge label="In Stock" icon="checkmark-circle-outline" />
            </View>
            <Text style={styles.merchName}>Alpha Home Jersey</Text>
            <Text style={styles.merchDetails}>Product: prod-jersey-001 · Variant: var-jersey-001-L</Text>
            <Text style={styles.merchPrice}>PKR 4,500.00</Text>
            <Body>Official match-day kit with moisture-wicking fabric and woven team crest.</Body>
            <Button
              title="View jersey details (prod-jersey-001)"
              onPress={() => {
                try {
                  (navigation as any).navigate('ProductDetail', { id: 'prod-jersey-001' });
                } catch {
                  // guest mode fallback
                }
              }}
            />
          </View>
        </Card>

        {/* Back navigation */}
        <Button
          title="Back"
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              try {
                (navigation as any).navigate('Login');
              } catch {
                try {
                  (navigation as any).navigate('Home');
                } catch {}
              }
            }
          }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  scroll: { padding: 16, gap: 14 },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  refreshInfo: { fontFamily: 'Inter_500Medium', fontSize: 12, color: colors.forest, opacity: 0.8 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  teamCol: { flex: 1, alignItems: 'center' },
  teamTitle: { fontFamily: 'Sora_700Bold', fontSize: 16, color: colors.forest, textAlign: 'center' },
  teamIdText: { fontFamily: 'Inter_400Regular', fontSize: 11, color: colors.panelMuted, textAlign: 'center', marginTop: 2 },
  scoreCenter: { paddingHorizontal: 16, alignItems: 'center' },
  scoreNumber: { fontFamily: 'Sora_800ExtraBold', fontSize: 36, color: colors.accentText },
  statusSub: { fontFamily: 'Inter_500Medium', fontSize: 12, color: colors.forest, marginTop: 2 },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.accentText, textAlign: 'center', marginTop: 6 },
  watchLiveArea: { gap: 10 },
  watchLiveHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  streamQuality: { fontFamily: 'Inter_500Medium', fontSize: 12, color: colors.panelMuted },
  playerMock: {
    height: 160,
    backgroundColor: colors.streamVideo,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.mediaBorder,
  },
  playerMockTitle: { fontFamily: 'Sora_700Bold', fontSize: 15, color: colors.panelText },
  playerMockSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.panelMuted },
  urlBox: {
    backgroundColor: colors.mediaOverlay,
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
    borderWidth: 1,
    borderColor: colors.mediaBorder,
  },
  urlLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: colors.accentText, marginBottom: 2 },
  urlText: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.panelText },
  merchCard: { gap: 8 },
  merchHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  merchName: { fontFamily: 'Sora_700Bold', fontSize: 18, color: colors.forest },
  merchId: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.forest, opacity: 0.7 },
  merchDetails: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.forest, opacity: 0.7 },
  merchPrice: { fontFamily: 'Sora_700Bold', fontSize: 16, color: colors.accentText },
});
