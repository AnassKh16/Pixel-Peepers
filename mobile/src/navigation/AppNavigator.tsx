import React from 'react';
import { Alert, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator, NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { Routes } from './types';
import { FixturesScreen, MatchDetailScreen, StandingsScreen } from '../screens/LeagueScreens';
import { StoreScreen, ProductDetailScreen, CartScreen, CheckoutScreen, PaymentResultScreen, ReceiptScreen } from '../screens/StoreScreens';
import { ClubScreen, RosterScreen, ScoringScreen } from '../screens/ClubScreens';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SyncStatusScreen } from '../screens/SyncStatusScreen';
import { Badge, Body, Card, Icon, Page, SyncPill, Title, ui, useResource, Resource, LinkCard, Empty } from '../components/UI';
import { Button } from '../components/Button';
import { useApp } from '../providers/AppProvider';
import { getOrders, money } from '../services/api';
import { colors } from '../theme';
const Stack = createNativeStackNavigator<Routes>();
type Tabs = { Fixtures: undefined; Standings: undefined; Store: undefined; Club: undefined; Profile: undefined };
const Tab = createBottomTabNavigator<Tabs>();
const tabIcons = { Fixtures: 'football-outline', Standings: 'podium-outline', Store: 'bag-outline', Club: 'people-outline', Profile: 'person-circle-outline' } as const;
function Profile({ navigation, logout }: { navigation: Pick<NativeStackNavigationProp<Routes>, 'navigate'>; logout: () => void }) {
  const { session, revision, cart } = useApp(); const resource = useResource(() => getOrders(session.email), [revision, cart.length]);
  return <Page><Title>Your corner of the club.</Title><Card><Body strong>{session.email}</Body><Badge label={session.role} icon="person-outline" /><Body>Connected league account</Body></Card>
    {['Club Manager', 'Super Admin'].includes(session.role) && <Button title="Manage roster" onPress={() => navigation.navigate('Roster')} />}
    {['League Organizer', 'Super Admin'].includes(session.role) && <Button title="Scoring entry" onPress={() => navigation.navigate('Scoring', {})} />}
    <Button title="Settings" onPress={() => navigation.navigate('Settings')} /><Button title="Sync Status" onPress={() => navigation.navigate('SyncStatus')} />
    <Title>Your receipts</Title><Resource resource={resource}>{!resource.data?.some(order => order.status === 'Paid') && <Empty message="Your paid orders will appear here." />}{resource.data?.filter(order => order.status === 'Paid').map(order => <LinkCard key={order.id} label={`Open receipt ${order.id}`} onPress={() => navigation.navigate('Receipt', { id: order.id })}><Body>{new Date(order.createdAt).toLocaleString()}</Body><Body strong>{money(order.total)}</Body></LinkCard>)}</Resource>
    <Button title="Sign out" onPress={logout} />
  </Page>;
}
function Home({ navigation, logout }: NativeStackScreenProps<Routes, 'Home'> & { logout: () => void }) {
  const insets = useSafeAreaInsets(); const { fontScale } = useWindowDimensions();
  return <Tab.Navigator screenOptions={({ route }) => ({ headerTitleStyle: { fontFamily: 'Sora_700Bold', fontSize: 20 }, headerStyle: { backgroundColor: colors.cream }, headerTintColor: colors.forest,
    headerRight: () => <View style={{ marginRight: 8 }}><SyncPill onPress={() => navigation.navigate('SyncStatus')} /></View>,
    tabBarStyle: { backgroundColor: colors.forest, height: Math.max(84, 48 + 36 * fontScale) + insets.bottom, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 8) }, tabBarActiveTintColor: colors.coral, tabBarInactiveTintColor: colors.cream,
    tabBarItemStyle: { minHeight: 56 }, tabBarLabelPosition: 'below-icon',
    tabBarLabel: ({ children, color }) => <Text numberOfLines={2} style={{ color, fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 18, textAlign: 'center', maxWidth: '100%' }}>{children}</Text>,
    tabBarAccessibilityLabel: `${route.name} tab`, tabBarIcon: ({ focused }) => <Icon name={tabIcons[route.name]} color={focused ? colors.coral : colors.cream} />,
  })}>
    <Tab.Screen name="Fixtures">{() => <FixturesScreen navigation={navigation} />}</Tab.Screen>
    <Tab.Screen name="Standings" component={StandingsScreen} />
    <Tab.Screen name="Store">{() => <StoreScreen navigation={navigation} />}</Tab.Screen>
    <Tab.Screen name="Club">{() => <ClubScreen navigation={navigation} />}</Tab.Screen>
    <Tab.Screen name="Profile">{() => <Profile navigation={navigation} logout={logout} />}</Tab.Screen>
  </Tab.Navigator>;
}
function ConnectedSettings({ logout }: { logout: () => void }) {
  const { pending, notify } = useApp();
  return <SettingsScreen locked={pending.length > 0} onSaved={() => notify('Server address saved.')} onLogout={logout} />;
}
export function AppNavigator({ onLogout }: { onLogout: () => Promise<void> }) {
  const { session, pending, toast } = useApp();
  function logout() {
    Alert.alert('Sign out?', pending.length ? 'Pending actions stay saved for this account on this server. Sign back in to sync them.' : 'Your saved league data stays on this device.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', onPress: () => { void onLogout().catch(() => Alert.alert('Could not sign out', 'Please try again.')); } }]);
  }
  return <View style={{ flex: 1 }}><Stack.Navigator screenOptions={({ navigation }) => ({ headerTitleStyle: { fontFamily: 'Sora_700Bold', fontSize: 18 }, headerStyle: { backgroundColor: colors.cream }, headerTintColor: colors.forest,
    contentStyle: { backgroundColor: colors.cream }, headerBackButtonDisplayMode: 'minimal', headerRight: () => <SyncPill onPress={() => navigation.navigate('SyncStatus')} /> })}>
    <Stack.Screen name="Home" options={{ headerShown: false }}>{props => <Home {...props} logout={logout} />}</Stack.Screen>
    <Stack.Screen name="MatchDetail" component={MatchDetailScreen} options={{ title: 'Match' }} />
    <Stack.Screen name="ProductDetail" component={ProductDetailScreen} options={{ title: 'Product' }} />
    <Stack.Screen name="Cart" component={CartScreen} /><Stack.Screen name="Checkout" component={CheckoutScreen} />
    <Stack.Screen name="PaymentResult" component={PaymentResultScreen} options={{ title: 'Payment' }} /><Stack.Screen name="Receipt" component={ReceiptScreen} />
    {['Club Manager', 'Super Admin'].includes(session.role) && <Stack.Screen name="Roster" component={RosterScreen} />}
    {['League Organizer', 'Super Admin'].includes(session.role) && <Stack.Screen name="Scoring" component={ScoringScreen} />}
    <Stack.Screen name="SyncStatus" component={SyncStatusScreen} options={{ title: 'Sync Status' }} />
    <Stack.Screen name="Settings">{() => <ConnectedSettings logout={logout} />}</Stack.Screen>
  </Stack.Navigator>{!!toast && <View pointerEvents="none" accessibilityLiveRegion="polite" style={{ position: 'absolute', bottom: 96, left: 16, right: 16, borderRadius: 16, padding: 16, backgroundColor: colors.forest }}><Text accessibilityLiveRegion="polite" style={[ui.body, { color: colors.cream }]}>{toast}</Text></View>}</View>;
}


