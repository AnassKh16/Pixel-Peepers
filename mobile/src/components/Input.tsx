import React, { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, TextInputProps } from 'react-native';
import { colors } from '../theme';

export const Input = forwardRef<React.ComponentRef<typeof TextInput>, TextInputProps>(function Input(props, ref) {
  const [focused, setFocused] = useState(false);
  return <TextInput {...props} ref={ref} placeholderTextColor={colors.moss}
    onFocus={event => { setFocused(true); props.onFocus?.(event); }}
    onBlur={event => { setFocused(false); props.onBlur?.(event); }}
    style={[styles.input, props.style, focused && { borderColor: colors.forest, borderWidth: 2 }]} />;
});
const styles = StyleSheet.create({
  input: { minHeight: 54, borderRadius: 16, padding: 16, backgroundColor: colors.sand,
    color: colors.forest, fontFamily: 'Inter_400Regular', fontSize: 16, borderWidth: 2, borderColor: colors.sand },
});
