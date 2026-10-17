import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, tenant } from '../theme';
import { Button } from './Button';
import { useApp } from '../providers/AppProvider';
export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export function Icon({ name, color = colors.forest, size = 22 }: { name: IconName; color?: string; size?: number }) { return <Ionicons name={name} color={color} size={size} accessible={false} />; }
export function Body({ children, strong = false }: React.PropsWithChildren<{ strong?: boolean }>) { return <Text style={[ui.body, strong && { fontFamily: 'Inter_600SemiBold' }]}>{children}</Text>; }
export function Title({ children }: React.PropsWithChildren) { return <Text style={ui.title}>{children}</Text>; }
export function Card({ children, dark = false }: React.PropsWithChildren<{ dark?: boolean }>) { return <View style={[ui.card, dark && { backgroundColor: colors.forest }]}>{children}</View>; }
export function Page({ children }: React.PropsWithChildren) { return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={ui.page}>{children}</ScrollView>; }
export function Badge({ label, icon = 'information-circle-outline', live = false }: { label: string; icon?: IconName; live?: boolean }) {
  return <View style={[ui.badge, live && { backgroundColor: tenant.primary }]} accessible accessibilityLabel={label}><Icon name={icon} size={17} /><Text style={ui.badgeText}>{label}</Text></View>;
}
export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: !!active }} onPress={onPress}
    style={({ pressed }) => [ui.chip, active && { backgroundColor: colors.forest }, pressed && { transform: [{ scale: 0.97 }] }]}><Text style={[ui.body, active && { color: colors.cream }]}>{label}</Text></Pressable>;
}
export function LinkCard({ children, onPress, label }: React.PropsWithChildren<{ onPress: () => void; label: string }>) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [ui.card, pressed && { transform: [{ scale: 0.97 }], backgroundColor: colors.sand }]}>{children}</Pressable>;
}
export function Empty({ message }: { message: string }) { return <Card><Icon name="leaf-outline" /><Body>{message}</Body></Card>; }
export function Loading() { return <View accessibilityLabel="Loading content" accessibilityRole="progressbar" style={{ gap: 14 }}><ActivityIndicator color={colors.forest} />{[0, 1, 2].map(i => <View key={i} style={{ height: 84, backgroundColor: colors.sand, borderRadius: 20 }} />)}</View>; }
export function useResource<T>(loader: () => Promise<T>, dependencies: unknown[]) {
  const [data, setData] = useState<T>(); const [error, setError] = useState(''); const [loading, setLoading] = useState(true); const [retry, setRetry] = useState(0);
  useEffect(() => { let active = true; setLoading(true); setError(''); loader().then(value => { if (active) setData(value); }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Could not load this information. Try again.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [...dependencies, retry]);
  return { data, error, loading, reload: () => setRetry(value => value + 1) };
}
export function Resource({ resource, children }: React.PropsWithChildren<{ resource: { loading: boolean; error: string; reload: () => void } }>) {
  if (resource.loading) return <Loading />;
  if (resource.error) return <Card><Text accessibilityRole="alert" style={ui.body}>{resource.error}</Text><Button title="Retry" onPress={resource.reload} /></Card>;
  return <>{children}</>;
}
export function SyncPill({ onPress }: { onPress: () => void }) {
  const { online, syncing, pending } = useApp();
  const label = syncing ? 'Syncing' : online ? 'Online' : 'Offline';
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${pending.length} pending actions. Open Sync Status`} onPress={onPress} style={({ pressed }) => [ui.sync, pressed && { opacity: 0.6 }]}>
    {syncing ? <ActivityIndicator color={colors.forest} size="small" /> : <Icon name={online ? 'checkmark-circle-outline' : 'cloud-offline-outline'} size={18} />}
    <Text style={ui.badgeText}>{label}</Text><Text style={ui.count}>{pending.length}</Text>
  </Pressable>;
}
export const ui = StyleSheet.create({
  page: { padding: 20, gap: 18, flexGrow: 1, backgroundColor: colors.cream },
  title: { fontFamily: 'Sora_700Bold', color: colors.forest, fontSize: 27 },
  body: { fontFamily: 'Inter_400Regular', color: colors.forest, fontSize: 16, lineHeight: 24, flexShrink: 1 },
  card: { borderRadius: 22, borderWidth: 1, borderColor: colors.sand, backgroundColor: colors.cream, padding: 18, gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, backgroundColor: colors.sand, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  badgeText: { fontFamily: 'Inter_600SemiBold', color: colors.forest, fontSize: 16, flexShrink: 1 },
  chip: { minHeight: 48, paddingHorizontal: 17, paddingVertical: 12, borderRadius: 28, backgroundColor: colors.sand, justifyContent: 'center' },
  sync: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, borderRadius: 24, backgroundColor: colors.sand },
  count: { borderRadius: 14, backgroundColor: tenant.primary, paddingHorizontal: 7, color: colors.forest, fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  score: { fontFamily: 'Sora_800ExtraBold', fontSize: 54, color: colors.forest, textAlign: 'center' },
});
