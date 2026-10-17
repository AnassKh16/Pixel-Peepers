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
    {busy && <ActivityIndicator accessibilityLabel="Working" color={colors.forest} />}
    <Text style={styles.label}>{title}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  button: { minHeight: 52, minWidth: 48, maxWidth: '100%', borderWidth: 2, borderColor: 'transparent', borderRadius: 30, backgroundColor: tenant.primary,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, padding: 14 },
  label: { color: colors.forest, fontFamily: 'Inter_600SemiBold', fontSize: 16, textAlign: 'center', flexShrink: 1 },
});
