import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Badge, Body, Card, Icon, Title, ui } from '../components/UI';
import { Button } from '../components/Button';
import { colors } from '../theme';
import { Routes } from '../navigation/types';

export function PlayerProfileScreen({ route, navigation }: NativeStackScreenProps<Routes, 'PlayerProfile'>) {
  const playerId = route.params?.id || 'player-alpha-1';
  const playerName = playerId === 'player-alpha-1' ? 'Ali (player-alpha-1)' : playerId;

  return (
    <View style={styles.root} accessibilityLabel="player-profile-screen" testID="player-profile-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <Badge label="ATHLETE PROFILE" icon="person-outline" />
          <Badge label="Public Graph" icon="globe-outline" />
        </View>

        <Card dark>
          <View style={styles.avatarRow}>
            <View style={styles.avatarCircle}>
              <Icon name="person" size={36} color={colors.panelText} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroName} accessibilityLabel="player-name">{playerName}</Text>
              <Text style={styles.heroSub}>ID: {playerId}</Text>
              <Badge label="Active Player" icon="checkmark-circle" live />
            </View>
          </View>
        </Card>

        <Title>Club Affiliation</Title>
        <Card>
          <Body strong>Current Club: Alpha United (club-alpha-1)</Body>
          <Body>Squad: Primary Squad · Jersey #10</Body>
          <Body>Role: Starter · Midfielder</Body>
          <Body>Contract: Active · Registration Type: Full</Body>
        </Card>

        <Title>Career Records & Fixtures</Title>
        <Card>
          <View style={ui.row}>
            <Badge label="12 Matches" icon="football-outline" />
            <Badge label="8 Goals" icon="trophy-outline" />
            <Badge label="5 Assists" icon="ribbon-outline" />
          </View>
          <Body>Upcoming Fixture: Alpha United vs Beta Athletic (match-m1)</Body>
        </Card>

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

export function ClubProfileScreen({ route, navigation }: NativeStackScreenProps<Routes, 'ClubProfile'>) {
  const clubId = route.params?.id || 'club-alpha-1';
  const clubName = clubId === 'club-alpha-1' ? 'Alpha United' : clubId === 'club-alpha-2' ? 'Beta Athletic' : clubId;

  return (
    <View style={styles.root} accessibilityLabel="club-profile-screen" testID="club-profile-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <Badge label="CLUB PROFILE" icon="people-outline" />
          <Badge label="Affiliated" icon="shield-outline" />
        </View>

        <Card dark>
          <Text style={{ color: colors.accentText, fontFamily: 'Sora_800ExtraBold', fontSize: 44 }}>
            {clubName.slice(0, 2).toUpperCase()}
          </Text>
          <Text style={[ui.title, { color: colors.panelText }]} accessibilityLabel="club-name">{clubName}</Text>
          <Text style={[ui.body, { color: colors.panelText }]}>Islamabad Sports Complex · ID: {clubId}</Text>
        </Card>

        <Title>Active Roster</Title>
        <Card>
          <Body strong>#1 · Ali (Captain, GK)</Body>
          <Body>#10 · Player Alpha 1 (Starter, MF)</Body>
          <Body>#11 · Player Alpha 2 (Starter, FW)</Body>
        </Card>

        <Title>Pinned Merch</Title>
        <Card>
          <Badge label="Official Kit" icon="shirt-outline" />
          <Body strong>Alpha Home Jersey (prod-jersey-001)</Body>
          <Body>PKR 4,500.00 · Available in store</Body>
        </Card>

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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroName: { color: colors.panelText, fontFamily: 'Sora_700Bold', fontSize: 18 },
  heroSub: { color: colors.panelMuted, fontFamily: 'Inter_400Regular', fontSize: 12, marginBottom: 4 },
});
