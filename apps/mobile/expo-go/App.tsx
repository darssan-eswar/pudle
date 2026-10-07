import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Alert, FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useEffect } from 'react';
import { DriveScreen } from './src/screens/DriveScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { colors } from './src/screens/ui';
import { useDrive, type Drive } from './src/useDrive';

type Tab = 'drive' | 'settings' | 'log';

export default function App() {
  const d = useDrive();
  const [tab, setTab] = useState<Tab>('drive');

  useEffect(() => {
    if (d.error) Alert.alert('Pudle', d.error, [{ text: 'OK', onPress: () => d.setError(null) }]);
  }, [d.error]);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.title}>Pudle</Text>
        <Text style={styles.subtitle}>{d.session?.user.email ?? 'not signed in'}</Text>
      </View>
      <View style={{ flex: 1 }}>
        {tab === 'drive' && <DriveScreen d={d} />}
        {tab === 'settings' && <SettingsScreen d={d} />}
        {tab === 'log' && <LogScreen d={d} />}
      </View>
      <View style={styles.tabs}>
        {(['drive', 'settings', 'log'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={styles.tab}>
            <Text style={[styles.tabText, tab === t && styles.tabOn]}>{t === 'drive' ? 'Drive' : t === 'settings' ? 'Settings' : 'Log'}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

function LogScreen({ d }: { d: Drive }) {
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  const p95 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)] : null);
  const fmt = (x: number | null) => (x == null ? '–' : `${x.toFixed(2)}s`);
  return (
    <FlatList
      contentContainerStyle={{ padding: 16, gap: 6 }}
      ListHeaderComponent={
        <View style={{ gap: 4, marginBottom: 10 }}>
          <Text style={{ fontWeight: '700' }}>Measured on this phone (no locations stored)</Text>
          <Text>Gemini check round trip: n={d.latency.detect.length} · median {fmt(median(d.latency.detect))} · p95 {fmt(p95(d.latency.detect))}</Text>
          <Text>Report → speech: n={d.latency.deliver.length} · median {fmt(median(d.latency.deliver))} · p95 {fmt(p95(d.latency.deliver))}</Text>
        </View>
      }
      data={d.log}
      keyExtractor={(l) => l.id}
      renderItem={({ item }) => (
        <Text style={{ fontSize: 13 }}>{new Date(item.at).toLocaleTimeString()}  {item.text}</Text>
      )}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  title: { fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#666', flex: 1, textAlign: 'right' },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#e5e5e5' },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabText: { fontSize: 16, color: '#777' },
  tabOn: { color: colors.blue, fontWeight: '800' },
});
