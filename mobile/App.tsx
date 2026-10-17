import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Sora_700Bold, Sora_800ExtraBold } from '@expo-google-fonts/sora';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import * as SecureStore from 'expo-secure-store';
import { LoginScreen } from './src/screens/LoginScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { Button } from './src/components/Button';
import { loadServerAddress } from './src/config';
import { Session } from './src/services/api';
import { colors } from './src/theme';
import { AppProvider } from './src/providers/AppProvider';
import { AppNavigator } from './src/navigation/AppNavigator';
const Auth = createNativeStackNavigator<{ Login: undefined; Settings: undefined }>();
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false); const [startupError, setStartupError] = useState('');
  const [fontsLoaded, fontError] = useFonts({ Sora_700Bold, Sora_800ExtraBold, Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  async function initialize() {
    setStartupError('');
    try {
      await loadServerAddress();
      const saved = await SecureStore.getItemAsync('skorly.session');
      if (saved) {
        const candidate = JSON.parse(saved) as Session;
        const token = await SecureStore.getItemAsync('skorly.token');
        if (candidate.token === token && ['Super Admin', 'League Organizer', 'Club Manager', 'Player', 'Viewer'].includes(candidate.role)) setSession(candidate);
      }
      setReady(true);
    } catch { setStartupError('Could not load your saved settings. Please try again.'); }
  }
  useEffect(() => { void initialize(); }, []);
  async function logout() { await SecureStore.deleteItemAsync('skorly.session'); await SecureStore.deleteItemAsync('skorly.token'); setSession(null); }
  if (startupError || fontError) return <SafeAreaProvider><View style={s.center}><Text style={s.body}>{startupError || 'Could not load the app fonts. Please reopen the app.'}</Text>{!!startupError && <Button title="Retry" onPress={initialize} />}</View></SafeAreaProvider>;
  if (!ready || !fontsLoaded) return <View style={s.center}><ActivityIndicator accessibilityLabel="Loading Skorly" color={colors.forest} /></View>;
  return <SafeAreaProvider><StatusBar style="dark" /><NavigationContainer theme={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: colors.forest, background: colors.cream, card: colors.cream, text: colors.forest, border: colors.sand } }}>
    {session ? <AppProvider key={session.email} session={session}><AppNavigator onLogout={logout} /></AppProvider> : <Auth.Navigator screenOptions={{ headerTitleStyle: { fontFamily: 'Sora_700Bold' }, contentStyle: { backgroundColor: colors.cream }, headerTintColor: colors.forest }}>
      <Auth.Screen name="Login" options={{ title: 'Welcome to Skorly' }}>{({ navigation }) => <LoginScreen onSettings={() => navigation.navigate('Settings')} onSignedIn={setSession} />}</Auth.Screen>
      <Auth.Screen name="Settings">{() => <SettingsScreen />}</Auth.Screen>
    </Auth.Navigator>}
  </NavigationContainer></SafeAreaProvider>;
}
const s = StyleSheet.create({ center: { flex: 1, backgroundColor: colors.cream, justifyContent: 'center', padding: 24, gap: 20 }, body: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 24, color: colors.forest } });
