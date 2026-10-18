import React, { useLayoutEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '../components/Button';
import { Input } from '../components/Input';
import { signIn, Session } from '../services/api';
import { colors, tenant } from '../theme';
import { friendlyError } from '../services/errors';

export function LoginScreen({ onSettings, onSignedIn }: { onSettings: () => void; onSignedIn: (session: Session) => void }) {
  const navigation = useNavigation<NativeStackNavigationProp<{ Login: undefined; Settings: undefined }>>();
  useLayoutEffect(() => { navigation.setOptions({ headerShown: false }); }, [navigation]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const passwordInput = useRef<React.ComponentRef<typeof TextInput>>(null); const submitting = useRef(false); const insets = useSafeAreaInsets();
  async function submit() {
    if (submitting.current) return;
    if (!email.trim() || !password) { setError('Enter your email and password to sign in.'); return; }
    submitting.current = true; setBusy(true); setError('');
    try {
      const session = await signIn(email, password);
      onSignedIn(session);
    } catch (e) { setError(friendlyError(e, 'We could not sign you in. Please try again.')); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <KeyboardAvoidingView style={s.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
    <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 16 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <View style={[s.brand, { paddingTop: insets.top + 28, paddingLeft: Math.max(28, insets.left), paddingRight: Math.max(28, insets.right) }]}><Text accessibilityLabel={`${tenant.name} logo`} style={s.logo}>{tenant.logo}</Text>
        <Text style={s.wordmark}>{tenant.name}</Text><Text style={s.kicker}>YOUR LEAGUE. YOUR PEOPLE.</Text></View>
      <View style={s.form}><Text style={s.title}>Back in the game.</Text>
        <Text style={s.body}>Fixtures, clubs, and every moment that counts.</Text>
        <Text style={s.label}>Email</Text><Input accessibilityLabel="Email" placeholder="you@nascon.test"
          placeholderTextColor={colors.moss} editable={!busy} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" returnKeyType="next" onSubmitEditing={() => passwordInput.current?.focus()} />
        <Text style={s.label}>Password</Text><Input ref={passwordInput} accessibilityLabel="Password" placeholder="Your password"
          placeholderTextColor={colors.moss} editable={!busy} value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoComplete="current-password" returnKeyType="go" onSubmitEditing={submit} />
        <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} onPress={() => setShowPassword(value => !value)} style={({ pressed }) => [s.link, pressed && { opacity: 0.6, transform: [{ scale: 0.97 }] }]}><Text style={s.linkText}>{showPassword ? 'Hide password' : 'Show password'}</Text></Pressable>
        {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>ⓘ {error}</Text>}
        <Button title="Sign in" onPress={submit} busy={busy} />
        <Pressable onPress={onSettings} disabled={busy} accessibilityState={{ disabled: busy }} accessibilityRole="button" accessibilityLabel="Server address settings" style={({ pressed }) => [s.link, pressed && { opacity: 0.6, transform: [{ scale: 0.97 }] }]}><Text style={s.linkText}>Server address →</Text></Pressable>
        <Text style={s.note}>Demo accounts are enabled for this preview.</Text>
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}
const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.cream }, content: { flexGrow: 1 },
  brand: { backgroundColor: colors.forest, padding: 28, gap: 12, alignItems: 'flex-start' },
  logo: { backgroundColor: tenant.primary, color: colors.forest, fontFamily: 'Sora_800ExtraBold', fontSize: 28, textAlign: 'center', width: 52, height: 52, borderRadius: 16, paddingTop: 7 },
  wordmark: { color: colors.cream, fontFamily: 'Sora_800ExtraBold', fontSize: 36 },
  kicker: { color: colors.cream, fontFamily: 'Inter_500Medium', fontSize: 16 },
  form: { padding: 24, gap: 14, maxWidth: 560, width: '100%', alignSelf: 'center' },
  title: { color: colors.forest, fontFamily: 'Sora_700Bold', fontSize: 28 },
  body: { color: colors.moss, fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 24 },
  label: { color: colors.forest, fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  error: { color: colors.forest, fontSize: 16, lineHeight: 24, fontFamily: 'Inter_500Medium' },
  link: { minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  linkText: { color: colors.forest, fontFamily: 'Inter_600SemiBold', fontSize: 16, textDecorationLine: 'underline' },
  note: { color: colors.moss, fontFamily: 'Inter_400Regular', fontSize: 16, textAlign: 'center' },
});
