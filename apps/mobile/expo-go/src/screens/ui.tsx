import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export const colors = { green: '#1f9d55', red: '#d64545', orange: '#f08c2e', gray: '#888888', blue: '#2563eb' };

export function Button({ title, onPress, color = colors.blue, big, disabled, style }: {
  title: string; onPress: () => void; color?: string; big?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled}
      style={({ pressed }) => [styles.button, { backgroundColor: color, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        big && styles.big, style]}>
      <Text style={[styles.buttonText, big && styles.bigText]}>{title}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={{ color: ok ? colors.green : colors.orange }}>{ok ? '●' : '▲'}</Text>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  big: { paddingVertical: 20 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15, textAlign: 'center' },
  bigText: { fontSize: 19 },
  card: { backgroundColor: '#f2f2f5', borderRadius: 14, padding: 14, gap: 10 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  label: { fontWeight: '700', width: 100 },
  value: { flex: 1, textAlign: 'right', color: '#444' },
});
