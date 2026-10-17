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

type Routes = { Login: undefined; Settings: undefined; Welcome: undefined };
const Stack = createNativeStackNavigator<Routes>();
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState('');
  const [fontsLoaded, fontError] = useFonts({ Sora_700Bold, Sora_800ExtraBold, Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  async function initialize() {
    setStartupError('');
    try { await loadServerAddress(); setReady(true); }
    catch { setStartupError('Could not load your settings. Please try again.'); }
  }
  useEffect(() => { void initialize(); }, []);
  if (startupError || fontError) return <SafeAreaProvider><View style={s.center}><Text style={s.body}>{startupError || 'Could not load the app fonts. Please reopen the app.'}</Text>{!!startupError && <Button title="Retry" onPress={initialize} />}</View></SafeAreaProvider>;
  if (!ready || !fontsLoaded) return <View style={s.center}><ActivityIndicator accessibilityLabel="Loading Skorly" color={colors.forest} /></View>;
  return <SafeAreaProvider><StatusBar style="dark" /><NavigationContainer theme={{ ...DefaultTheme,
    colors: { ...DefaultTheme.colors, primary: colors.forest, background: colors.cream, card: colors.cream, text: colors.forest, border: colors.sand } }}>
    <Stack.Navigator screenOptions={{ headerTitleStyle: { fontFamily: 'Sora_700Bold' }, contentStyle: { backgroundColor: colors.cream } }}>
      {!session ? <Stack.Screen name="Login" options={{ title: 'Welcome to Skorly' }}>{({ navigation }) => <LoginScreen onSettings={() => navigation.navigate('Settings')} onSignedIn={setSession} />}</Stack.Screen>
        : <Stack.Screen name="Welcome" options={{ title: 'Skorly' }}>{() => <View style={s.center}>
          <Text style={s.title}>You’re signed in.</Text><Text style={s.body}>{session.role}</Text>
          <Text style={s.body}>Your league home is the next screen in development.</Text>
          <Button title="Sign out" onPress={async () => { await SecureStore.deleteItemAsync('skorly.token'); setSession(null); }} />
        </View>}</Stack.Screen>}
      <Stack.Screen name="Settings" component={SettingsScreen} />
    </Stack.Navigator>
  </NavigationContainer></SafeAreaProvider>;
}
const s = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.cream, justifyContent: 'center', padding: 24, gap: 20 },
  title: { fontFamily: 'Sora_700Bold', fontSize: 28, color: colors.forest },
  body: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 24, color: colors.forest },
});
