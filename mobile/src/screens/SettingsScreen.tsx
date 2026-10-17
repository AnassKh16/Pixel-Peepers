import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { BASE_URL, saveServerAddress } from '../config';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { colors } from '../theme';

export function SettingsScreen() {
  const [address, setAddress] = useState(BASE_URL);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true); setMessage('');
    try { await saveServerAddress(address); setMessage('✓ Server address saved.'); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Could not save the server address. Try again.'); }
    finally { setSaving(false); }
  }
  return <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
    <Text style={s.title}>Make the connection.</Text>
    <Text style={s.body}>On a physical phone, use your laptop’s LAN IP, for example http://192.168.1.20:8080. Your phone and laptop must be on the same network.</Text>
    <Text style={s.label}>Server address</Text>
    <Input accessibilityLabel="Server address" value={address} onChangeText={setAddress}
      autoCapitalize="none" autoCorrect={false} keyboardType="url" />
    <Button title="Save address" onPress={save} busy={saving} />
    {!!message && <Text accessibilityLiveRegion="polite" style={s.body}>{message}</Text>}
    <Text style={s.body}>Demo preview uses local mock data. The server address will be used when the REST API is connected.</Text>
  </ScrollView>;
}
const s = StyleSheet.create({
  content: { flexGrow: 1, padding: 24, gap: 20, backgroundColor: colors.cream },
  title: { color: colors.forest, fontFamily: 'Sora_700Bold', fontSize: 28 },
  body: { color: colors.forest, fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 25 },
  label: { color: colors.forest, fontFamily: 'Inter_600SemiBold', fontSize: 16 },
});
