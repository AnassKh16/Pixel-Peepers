import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors, tenant } from '../theme';

export function Button({ title, onPress, busy = false }: {
  title: string; onPress: () => void; busy?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title}
    accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onPress}
    style={({ pressed }) => [styles.button, pressed && { transform: [{ scale: 0.97 }], opacity: 0.85 }]}>
    {busy && <ActivityIndicator color={colors.forest} />}
    <Text style={styles.label}>{busy ? 'Please wait…' : title}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  button: { minHeight: 52, borderRadius: 30, backgroundColor: tenant.primary,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, padding: 14 },
  label: { color: colors.forest, fontFamily: 'Inter_600SemiBold', fontSize: 16 },
});
