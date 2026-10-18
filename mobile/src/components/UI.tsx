import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, tenant } from '../theme';
import { Button } from './Button';
import { useApp } from '../providers/AppProvider';
import { friendlyError } from '../services/errors';
export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export function Icon({ name, color = colors.forest, size = 22 }: { name: IconName; color?: string; size?: number }) { return <Ionicons name={name} color={color} size={size} accessible={false} />; }
export function Body({ children, strong = false }: React.PropsWithChildren<{ strong?: boolean }>) { return <Text style={[ui.body, strong && { fontFamily: 'Inter_600SemiBold' }]}>{children}</Text>; }
export function Title({ children }: React.PropsWithChildren) { return <Text accessibilityRole="header" style={ui.title}>{children}</Text>; }
export function Card({ children, dark = false }: React.PropsWithChildren<{ dark?: boolean }>) { return <View style={[ui.card, dark && { backgroundColor: colors.forest }]}>{children}</View>; }
export function Page({ children, onRefresh, refreshing = false }: React.PropsWithChildren<{ onRefresh?: () => void; refreshing?: boolean }>) {
  const insets = useSafeAreaInsets();
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + 56}>
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets
      refreshControl={onRefresh ? <RefreshControl accessibilityLabel="Refresh content" refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.forest} colors={[colors.forest]} /> : undefined}
      contentContainerStyle={[ui.page, { paddingBottom: insets.bottom + 24, paddingLeft: Math.max(20, insets.left), paddingRight: Math.max(20, insets.right) }]}>{children}</ScrollView>
  </KeyboardAvoidingView>;
}
export function Badge({ label, icon = 'information-circle-outline', live = false }: { label: string; icon?: IconName; live?: boolean }) {
  return <View style={[ui.badge, live && { backgroundColor: tenant.primary }]} accessible accessibilityLabel={label}><Icon name={icon} size={14} /><Text style={ui.badgeText}>{label}</Text></View>;
}
export function Chip({ label, active, onPress, disabled = false }: { label: string; active?: boolean; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!active, disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [ui.chip, disabled && { opacity: 0.6 }, active && { backgroundColor: colors.forest }, pressed && { transform: [{ scale: 0.97 }] }]}><Text style={[ui.body, active && { color: colors.cream }]}>{active ? '✓ ' : ''}{label}</Text></Pressable>;
}
export function LinkCard({ children, onPress, label }: React.PropsWithChildren<{ onPress: () => void; label: string }>) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [ui.card, pressed && { transform: [{ scale: 0.97 }], backgroundColor: colors.sand }]}>{children}</Pressable>;
}
export function Empty({ message }: { message: string }) { return <Card><Icon name="leaf-outline" /><Body>{message}</Body></Card>; }
export function Loading() { return <View accessibilityLabel="Loading content" accessibilityRole="progressbar" style={{ gap: 14 }}><ActivityIndicator color={colors.forest} />{[0, 1, 2].map(i => <View key={i} style={{ height: 84, backgroundColor: colors.sand, borderRadius: 20 }} />)}</View>; }
export function useResource<T>(loader: () => Promise<T>, dependencies: unknown[]) {
  const [data, setData] = useState<T>(); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [retry, setRetry] = useState(0);
  useEffect(() => { let active = true; setLoading(true); setError(''); loader().then(value => { if (active) setData(value); }).catch(e => { if (active) setError(friendlyError(e, 'Could not load this information. Please try again.')); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [...dependencies, retry]);
  return { data, error, loading, hasData: data !== undefined, reload: () => setRetry(value => value + 1) };
}
export function Resource({ resource, children, preserveData = false }: React.PropsWithChildren<{ preserveData?: boolean; resource: { loading: boolean; error: string; hasData?: boolean; reload: () => void } }>) {
  if (resource.loading && !(preserveData && resource.hasData)) return <Loading />;
  if (resource.error) return <Card><Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={ui.body}>{friendlyError(resource.error)}</Text><Button title="Retry" onPress={resource.reload} /></Card>;
  return <>{resource.loading && <ActivityIndicator accessibilityLabel="Refreshing content" color={colors.forest} />}{children}</>;
}
export function SyncPill({ onPress }: { onPress: () => void }) {
  const { online, cached, syncing, pending } = useApp();
  const label = syncing ? 'Syncing' : online && !cached ? 'Online' : 'Offline';
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${pending.length} pending actions. Open Sync Status`} onPress={onPress} style={({ pressed }) => [ui.sync, pressed && { opacity: 0.6 }]}>
    {syncing ? <ActivityIndicator color={colors.forest} size="small" /> : <Icon name={online && !cached ? 'checkmark-circle-outline' : 'cloud-offline-outline'} size={18} />}
    <Text style={ui.badgeText}>{label}</Text><Text style={ui.count}>{pending.length}</Text>
  </Pressable>;
}
export const ui = StyleSheet.create({
  page: { padding: 16, gap: 12, flexGrow: 1, backgroundColor: colors.cream },
  title: { fontFamily: 'Sora_700Bold', color: colors.forest, fontSize: 21, lineHeight: 27 },
  body: { fontFamily: 'Inter_400Regular', color: colors.forest, fontSize: 14, lineHeight: 20, flexShrink: 1 },
  card: { minHeight: 48, maxWidth: '100%', borderRadius: 16, borderWidth: 1, borderColor: colors.sand, backgroundColor: colors.cream, padding: 14, gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  badge: { maxWidth: '100%', alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.sand, borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontFamily: 'Inter_600SemiBold', color: colors.forest, fontSize: 13, flexShrink: 1 },
  chip: { minHeight: 44, minWidth: 44, maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 22, backgroundColor: colors.sand, justifyContent: 'center' },
  sync: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, borderRadius: 24, backgroundColor: colors.sand },
  count: { borderRadius: 14, backgroundColor: tenant.primary, paddingHorizontal: 6, color: colors.forest, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  score: { fontFamily: 'Sora_800ExtraBold', fontSize: 42, color: colors.forest, textAlign: 'center' },
});
