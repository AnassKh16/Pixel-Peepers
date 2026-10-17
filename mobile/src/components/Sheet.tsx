import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';

export function Sheet({ visible, onClose, busy = false, children }: React.PropsWithChildren<{ visible: boolean; onClose: () => void; busy?: boolean }>) {
  const insets = useSafeAreaInsets();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View accessibilityViewIsModal style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#16261FCC', padding: 16, paddingTop: insets.top + 16 }}>
        <ScrollView style={{ flexGrow: 0, maxHeight: '100%', borderRadius: 24, backgroundColor: colors.cream }}
          keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 20, gap: 16 }}>
          {children}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
