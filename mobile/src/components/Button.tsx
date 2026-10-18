import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors, tenant } from '../theme';

export function Button({ title, onPress, busy = false, disabled = false, accessibilityLabel }: {
  title: string; onPress: () => void; busy?: boolean; disabled?: boolean; accessibilityLabel?: string;
}) {
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || title}
    accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.button, disabled && { opacity: 0.6 }, focused && { borderColor: colors.forest }, pressed && { transform: [{ scale: 0.97 }], opacity: 0.85 }]}>
    {busy && <ActivityIndicator accessibilityLabel="Working" color={colors.onPrimary} />}
    <Text style={styles.label}>{title}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  button: { minHeight: 48, minWidth: 48, maxWidth: '100%', borderWidth: 2, borderColor: colors.transparent, borderRadius: 30, backgroundColor: tenant.primary,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingVertical: 10, paddingHorizontal: 16 },
  label: { color: colors.onPrimary, fontFamily: 'Inter_600SemiBold', fontSize: 15, textAlign: 'center', flexShrink: 1 },
});
