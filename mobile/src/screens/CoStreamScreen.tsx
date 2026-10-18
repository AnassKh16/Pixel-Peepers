import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Badge, Body, Card, Icon, Title } from '../components/UI';
import { Button } from '../components/Button';
import { BASE_URL, getServerHost } from '../config';
import { colors } from '../theme';
import { Routes } from '../navigation/types';

type Participant = {
  id: string;
  name: string;
  role: string;
  isHost: boolean;
};

const initialParticipants: Participant[] = [
  { id: 'player-alpha-1', name: 'Alpha Host', role: 'Broadcaster', isHost: true },
  { id: 'player-alpha-2', name: 'Alpha Co-Host', role: 'Tactician', isHost: false },
  { id: 'player-beta-1', name: 'Beta Specialist', role: 'Commentator', isHost: false },
  { id: 'player-beta-2', name: 'Beta Analyst', role: 'Pundit', isHost: false },
];

type ChatMessage = {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
};

const initialChatMessages: ChatMessage[] = [
  { id: 'msg-1', sender: 'user-guest-1', text: 'Clean sports commentary', timestamp: '10:15' },
  { id: 'msg-2', sender: 'player-alpha-1', text: 'Welcome everyone to the 4-way co-stream!', timestamp: '10:16' },
  { id: 'msg-3', sender: 'player-beta-1', text: 'High energy match today, look at that defense.', timestamp: '10:17' },
  { id: 'msg-4', sender: 'player-alpha-2', text: 'Switching spotlight to field camera 2 shortly.', timestamp: '10:18' },
];

export function CoStreamScreen({ route, navigation }: NativeStackScreenProps<Routes, 'CoStream'>) {
  const sessionId = route.params?.id || 'cs-session-101';
  const chatRoomId = `chat-${sessionId}`;
  const serverHost = getServerHost(BASE_URL);
  const compositePlaybackUrl = `http://${serverHost}:8888/costream/${encodeURIComponent(sessionId)}/index.m3u8`;

  const [participants] = useState<Participant[]>(initialParticipants);
  const [messages, setMessages] = useState<ChatMessage[]>(initialChatMessages);
  const [inputText, setInputText] = useState('');
  const [error] = useState<string | null>(null);

  function handleSendMessage() {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    const cleaned = trimmed.replace(/b@d_w0rd|bad_word|p0rn|porn|sc@m|scam|fuck|shit|bitch|asshole/gi, '***');
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      sender: 'You',
      text: cleaned,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages(prev => [...prev, newMsg]);
    setInputText('');
  }

  return (
    <View style={styles.root} accessibilityLabel="costream-screen" testID="costream-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Header badges */}
        <View style={styles.headerRow}>
          <Badge label="CO-STREAM" icon="people-outline" live />
          <Badge label="layout grid_4" icon="grid-outline" />
        </View>
        {error && <Card><Body>{error}</Body></Card>}

        {/* 2x2 grid of 4 participant tiles (layout grid_4) */}
        <Title>Live Participants (layout grid_4)</Title>
        <View style={styles.gridContainer} accessibilityLabel="grid_4" testID="grid_4">
          {participants.map((p, index) => (
            <View
              key={p.id}
              style={styles.gridTile}
              accessibilityLabel={`participant-tile-${index}`}
              testID={`participant-tile-${index}`}
            >
              <View style={styles.tileHeader}>
                <Badge
                  label={p.isHost ? 'Host' : `Co-Host ${index}`}
                  icon={p.isHost ? 'star-outline' : 'mic-outline'}
                />
                <Badge label="LIVE" icon="radio-outline" live />
              </View>
              <View style={styles.tileMockVideo}>
                <Icon name="videocam" size={28} color={colors.forest} />
                <Text style={styles.tileName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.tileId} numberOfLines={1}>{p.id}</Text>
              </View>
              <Text style={styles.tileRole}>{p.role}</Text>
            </View>
          ))}
        </View>

        {/* Composite Playback URL */}
        <Title>Composite Stream</Title>
        <Card dark>
          <View style={styles.compositeHeader}>
            <Badge label="Composite HLS Feed" icon="film-outline" live />
            <Text style={styles.compositeSpec}>1080p · MediaMTX</Text>
          </View>
          <View style={styles.urlBox} accessibilityLabel="composite-playback-container">
            <Text style={styles.urlLabel}>Composite playback URL:</Text>
            <Text selectable accessibilityLabel="composite-playback-url" style={styles.urlValue}>
              {compositePlaybackUrl}
            </Text>
          </View>
        </Card>

        {/* Chat list for chat-{id} */}
        <Title>Live Chat ({chatRoomId})</Title>
        <Card>
          <View style={styles.chatRoomHeader}>
            <Text style={styles.chatRoomTitle} accessibilityLabel="chat-room-title">{chatRoomId}</Text>
            <Badge label="DLQ Moderated" icon="shield-checkmark-outline" />
          </View>

          <View style={styles.chatListContainer} accessibilityLabel="chat-message-list" testID="chat-message-list">
            {messages.map(item => (
              <View key={item.id} style={styles.chatMessageRow}>
                <View style={styles.chatSenderRow}>
                  <Text style={styles.chatSender}>{item.sender}</Text>
                  <Text style={styles.chatTime}>{item.timestamp}</Text>
                </View>
                <Text style={styles.chatText}>{item.text}</Text>
              </View>
            ))}
          </View>

          <View style={styles.chatInputRow}>
            <TextInput
              style={styles.chatInput}
              placeholder="Send message to stream chat..."
              placeholderTextColor={colors.chatPlaceholder}
              value={inputText}
              onChangeText={setInputText}
              accessibilityLabel="chat-input-field"
            />
            <Pressable
              style={styles.chatSendButton}
              accessibilityRole="button"
              accessibilityLabel="chat-send-btn"
              onPress={handleSendMessage}
            >
              <Icon name="send" size={18} color={colors.onSelection} />
            </Pressable>
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
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  gridTile: {
    width: '48%',
    backgroundColor: colors.sand,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.subtleBorder,
    gap: 6,
  },
  tileHeader: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 6 },
  tileMockVideo: {
    height: 76,
    backgroundColor: colors.tileVideo,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  tileName: { fontFamily: 'Sora_700Bold', fontSize: 13, color: colors.forest, marginTop: 2 },
  tileId: { fontFamily: 'Inter_400Regular', fontSize: 10, color: colors.forest, opacity: 0.7 },
  tileRole: { fontFamily: 'Inter_500Medium', fontSize: 11, color: colors.forest, textAlign: 'center' },
  compositeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  compositeSpec: { fontFamily: 'Inter_500Medium', fontSize: 12, color: colors.panelMuted },
  urlBox: {
    backgroundColor: colors.mediaOverlay,
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.mediaBorder,
  },
  urlLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: colors.accentText, marginBottom: 2 },
  urlValue: { fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.panelText },
  chatRoomHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  chatRoomTitle: { fontFamily: 'Sora_700Bold', fontSize: 15, color: colors.forest },
  chatListContainer: {
    minHeight: 120,
    maxHeight: 220,
    backgroundColor: colors.chatBackground,
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  chatMessageRow: { borderBottomWidth: 1, borderBottomColor: colors.divider, paddingBottom: 6 },
  chatSenderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chatSender: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: colors.forest },
  chatTime: { fontFamily: 'Inter_400Regular', fontSize: 10, color: colors.forest, opacity: 0.5 },
  chatText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.forest, marginTop: 2 },
  chatInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  chatInput: {
    flex: 1,
    minHeight: 46,
    backgroundColor: colors.chatBackground,
    borderRadius: 23,
    paddingHorizontal: 16,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.forest,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chatSendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.selection,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
