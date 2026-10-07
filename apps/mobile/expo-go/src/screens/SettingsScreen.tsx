import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { HAZARD_KINDS, SIDES, type HazardKind, type HazardSide } from '../core/types';
import { LABEL, PERSONA_NAMES, PERSONAS } from '../core/phrases';
import type { Drive, Place } from '../useDrive';
import { Button, Card, colors } from './ui';

export function SettingsScreen({ d }: { d: Drive }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [convoyName, setConvoyName] = useState('Demo convoy');
  const [roadName, setRoadName] = useState('Demo road');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [target, setTarget] = useState<'destination' | 'detour'>('destination');
  const [kind, setKind] = useState<HazardKind>('object');
  const [side, setSide] = useState<HazardSide>('right');
  const [blocks, setBlocks] = useState(false);
  const convoy = d.convoys.find((c) => c.id === d.settings.convoyId);

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {!d.configured && <Card><Text style={styles.warn}>This build has no Supabase settings (.env). Only test alerts work.</Text></Card>}

      <Card>
        <Text style={styles.h2}>Account</Text>
        {d.session ? (
          <>
            <Text>Signed in as {d.session.user.email}</Text>
            <Button title="Sign out" color={colors.red} onPress={d.signOut} />
          </>
        ) : (
          <>
            <TextInput style={styles.input} placeholder="Email" autoCapitalize="none" keyboardType="email-address"
                       value={email} onChangeText={setEmail} autoComplete="email" />
            <TextInput style={styles.input} placeholder="Password (8+ characters)" secureTextEntry value={password}
                       onChangeText={setPassword} autoComplete="password" />
            <View style={styles.row}>
              <Button title="Sign in" style={{ flex: 1 }} disabled={!email || password.length < 8}
                      onPress={() => d.signIn(email.trim(), password, false)} />
              <Button title="Create account" style={{ flex: 1 }} color={colors.green} disabled={!email || password.length < 8}
                      onPress={() => d.signIn(email.trim(), password, true)} />
            </View>
          </>
        )}
      </Card>

      {d.session && (
        <>
          <Card>
            <Text style={styles.h2}>Convoy</Text>
            <Text style={styles.small}>Phones in the same convoy share reports. Convoys last 24 hours.</Text>
            {d.convoys.map((c) => (
              <Pressable key={c.id} onPress={() => d.update({ convoyId: c.id })} style={[styles.choice, c.id === d.settings.convoyId && styles.chosen]}>
                <Text style={styles.choiceText}>{c.id === d.settings.convoyId ? '✓ ' : ''}{c.name}</Text>
              </Pressable>
            ))}
            {convoy?.join_code && (
              <Text style={styles.code} selectable>Invite code: {convoy.join_code}</Text>
            )}
            <View style={styles.row}>
              <TextInput style={[styles.input, { flex: 1 }]} placeholder="12-character invite code" autoCapitalize="characters"
                         value={code} onChangeText={setCode} autoCorrect={false} />
              <Button title="Join" disabled={code.trim().length < 12} onPress={() => { d.joinConvoy(code); setCode(''); }} />
            </View>
            <View style={styles.row}>
              <TextInput style={[styles.input, { flex: 1 }]} value={convoyName} onChangeText={setConvoyName} />
              <Button title="Create" color={colors.green} onPress={() => d.createConvoy(convoyName)} />
            </View>
          </Card>

          <Card>
            <View style={styles.rowBetween}>
              <Text style={[styles.h2, { flex: 1 }]}>Share hazard locations with my convoy</Text>
              <Switch value={d.settings.shareLocation} onValueChange={d.setShareLocation} />
            </View>
            <Text style={styles.small}>Needed for camera reports and the demo road. Only the position of a hazard you confirm is shared, and it expires with the report (15–30 min). Your own movement is never uploaded. Turning this off removes positions from your stored reports.</Text>
          </Card>

          <Card>
            <Text style={styles.h2}>Demo road</Text>
            <Text style={styles.small}>Start a drive, tap Record, drive the demo road once in the direction cars will go, then Save. Following cars are only warned when they are on this road, going the same way, within about a mile.</Text>
            {d.corridor && <Text>Active: {d.corridor.name} · {(d.corridor.length / 1000).toFixed(1)} km</Text>}
            {d.recording ? (
              <>
                <Text>Recording… {d.recording.length} points</Text>
                <TextInput style={styles.input} value={roadName} onChangeText={setRoadName} />
                <Button title="Finish and save road" color={colors.green} onPress={() => d.finishRecording(roadName)} />
              </>
            ) : (
              <Button title="Record demo road" onPress={d.startRecording} disabled={!d.active} />
            )}
          </Card>
        </>
      )}

      <Card>
        <Text style={styles.h2}>Demo route (for reroute)</Text>
        <Text>Destination: {d.settings.destination?.name ?? 'not set'}</Text>
        <Text>Detour point: {d.settings.detour?.name ?? 'not set'}</Text>
        <View style={styles.row}>
          {(['destination', 'detour'] as const).map((t) => (
            <Pressable key={t} onPress={() => setTarget(t)} style={[styles.choice, { flex: 1 }, target === t && styles.chosen]}>
              <Text style={styles.choiceText}>Set {t}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.row}>
          <TextInput style={[styles.input, { flex: 1 }]} placeholder="Address or place" value={query} onChangeText={setQuery} />
          <Button title="Search" disabled={!query} onPress={async () => setResults(await d.searchPlaces(query))} />
        </View>
        {results.map((p) => (
          <Pressable key={`${p.latitude},${p.longitude}`} style={styles.choice}
                     onPress={() => { d.update({ [target]: p } as Partial<Drive['settings']>); setResults([]); setQuery(''); }}>
            <Text style={styles.choiceText}>{p.name} ({p.latitude.toFixed(4)}, {p.longitude.toFixed(4)})</Text>
          </Pressable>
        ))}
        <Button title="Use my current position as the detour point" onPress={d.useHereAsDetour} />
        <Text style={styles.small}>On a blockage, Pudle reopens Google Maps to the destination through the detour point. Google Maps plans the actual route — check it before recording.</Text>
      </Card>

      <Card>
        <Text style={styles.h2}>Voice</Text>
        <View style={styles.wrap}>
          {PERSONAS.map((p) => (
            <Pressable key={p} onPress={() => d.update({ persona: p })} style={[styles.choice, d.settings.persona === p && styles.chosen]}>
              <Text style={styles.choiceText}>{PERSONA_NAMES[p]}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.rowBetween}>
          <Text>Gemini voices (falls back to phone voice)</Text>
          <Switch value={d.settings.cloudVoice} onValueChange={(v) => d.update({ cloudVoice: v })} />
        </View>
        <View style={styles.rowBetween}>
          <Text>Metric distances</Text>
          <Switch value={d.settings.units === 'metric'} onValueChange={(v) => d.update({ units: v ? 'metric' : 'imperial' })} />
        </View>
      </Card>

      {d.session && (
        <Card>
          <Text style={styles.h2}>Manual report (passenger / parked)</Text>
          <View style={styles.wrap}>
            {HAZARD_KINDS.map((k) => (
              <Pressable key={k} onPress={() => setKind(k)} style={[styles.choice, kind === k && styles.chosen]}>
                <Text style={styles.choiceText}>{LABEL[k]}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.wrap}>
            {SIDES.map((s) => (
              <Pressable key={s} onPress={() => setSide(s)} style={[styles.choice, side === s && styles.chosen]}>
                <Text style={styles.choiceText}>{s}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.rowBetween}>
            <Text>May block the road</Text>
            <Switch value={blocks} onValueChange={setBlocks} />
          </View>
          <Button title="Send report" color={colors.orange} onPress={() => d.manualReport(kind, side, blocks)} />
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 14, paddingBottom: 80 },
  h2: { fontSize: 17, fontWeight: '700' },
  small: { fontSize: 13, color: '#555' },
  warn: { color: colors.red, fontWeight: '700' },
  input: { backgroundColor: '#fff', borderRadius: 10, padding: 12, fontSize: 16, borderWidth: 1, borderColor: '#ddd' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  rowBetween: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { backgroundColor: '#fff', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ddd' },
  chosen: { borderColor: colors.blue, backgroundColor: '#e8efff' },
  choiceText: { fontSize: 14 },
  code: { fontSize: 20, fontWeight: '800', letterSpacing: 2, fontFamily: 'Courier' },
});
