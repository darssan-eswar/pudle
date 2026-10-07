import { CameraView, useCameraPermissions } from 'expo-camera';
import { useKeepAwake } from 'expo-keep-awake';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LABEL } from '../core/phrases';
import type { Drive } from '../useDrive';
import { Button, Card, colors, Row } from './ui';

function KeepAwake() { useKeepAwake(); return null; }

export function DriveScreen({ d }: { d: Drive }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);

  const status = statusLine(d);
  return (
    <ScrollView contentContainerStyle={styles.page}>
      {d.active && <KeepAwake />}
      <View style={[styles.status, { borderColor: status.color, backgroundColor: status.color + '22' }]}>
        <Text style={styles.statusTitle}>{status.title}</Text>
        <Text style={styles.body}>{status.detail}</Text>
      </View>

      {d.blockage && (
        <Card style={{ backgroundColor: colors.orange + '30' }}>
          <Text style={styles.h2}>⚠️ Possible road blockage ahead</Text>
          <Text style={styles.small}>Reported by {d.blockage.source === 'driver_confirmed_camera' ? 'a Pudle driver (camera, confirmed)' : 'a convoy member'}.</Text>
          <Button title={d.settings.detour ? 'Reroute via detour in Google Maps' : 'Open Google Maps'} color={colors.orange}
                  onPress={() => d.openMaps(true)} />
        </Card>
      )}

      {d.lastAlert && !d.blockage && (
        <Card><Text style={styles.small}>Last alert</Text><Text style={styles.body}>{d.lastAlert}</Text></Card>
      )}

      {!d.active ? (
        <Button title="🚗  Start drive" color={colors.green} big onPress={d.startDrive} disabled={!d.session} />
      ) : (
        <View style={styles.row}>
          <Button title={d.muted ? 'Unmute' : 'Mute'} onPress={d.toggleMute} style={{ flex: 1 }} big />
          <Button title="Stop drive" color={colors.red} onPress={d.stopDrive} style={{ flex: 1 }} big />
        </View>
      )}
      {!d.session && <Text style={styles.small}>Sign in under Settings first.</Text>}

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.h2}>📷 Dashcam (lead car)</Text>
          <Pressable onPress={async () => {
            if (!d.dashcam && !permission?.granted) { const r = await requestPermission(); if (!r.granted) return; }
            d.setDashcam(!d.dashcam);
          }} style={[styles.toggle, d.dashcam && styles.toggleOn]}>
            <Text style={styles.toggleText}>{d.dashcam ? 'ON' : 'OFF'}</Text>
          </Pressable>
        </View>
        {d.dashcam && d.active && permission?.granted && (
          <View style={styles.camera}>
            <CameraView
              ref={d.cameraRef}
              style={StyleSheet.absoluteFill}
              facing="back"
              animateShutter={false}
              pictureSize={pictureSize}
              onCameraReady={async () => {
                try {
                  const sizes = (await d.cameraRef.current?.getAvailablePictureSizesAsync()) ?? [];
                  setPictureSize(smallestUseful(sizes));
                } catch { /* keep default */ }
                d.onCameraReady();
              }}
            />
            <View style={styles.badge}><Text style={styles.badgeText}>{d.lastSeen || 'Starting…'}</Text></View>
          </View>
        )}
        {d.prompt && (
          <View style={styles.prompt}>
            <Text style={styles.h2}>{d.prompt.blocksRoad ? 'Possible road blockage' : `Possible ${LABEL[d.prompt.kind].toLowerCase()}`}</Text>
            <Text style={styles.small}>
              {d.prompt.side !== 'unknown' ? `Side: ${d.prompt.side} · ` : ''}model confidence {Math.round(d.prompt.confidence * 100)}% (not measured accuracy)
            </Text>
            {d.prompt.status === 'asking' && (
              <View style={styles.row}>
                <Button title="Report it" color={colors.orange} big style={{ flex: 2 }} onPress={d.confirmReport} />
                <Button title="Cancel" big style={{ flex: 1 }} onPress={d.cancelReport} />
              </View>
            )}
            {d.prompt.status === 'sending' && <Text style={styles.body}>Sending…</Text>}
            {d.prompt.status === 'done' && <Text style={styles.body}>{d.prompt.note}</Text>}
          </View>
        )}
        <Text style={styles.small}>
          {d.dashcam ? d.detector : 'Mount this phone facing the road and keep Pudle on screen. About one picture per second goes to Gemini; nothing is saved, and nothing is shared until you tap Report.'}
        </Text>
      </Card>

      {d.active && (
        <Card>
          <Row label="GPS" value={d.locationDenied ? 'Permission denied' : d.fix ? `±${Math.round(d.fix.accuracyMeters)} m · ${speedText(d.fix.speedMps)}${d.fix.courseDegrees != null ? ` · heading ${Math.round(d.fix.courseDegrees)}°` : ''}` : 'Waiting for fix…'} ok={!!d.fix && d.fix.accuracyMeters <= 50} />
          <Row label="Report feed" value={feedText(d.feed)} ok={d.feed === 'live'} />
          <Row label="Demo road" value={d.corridor ? `${d.corridor.name} · ${(d.corridor.length / 1000).toFixed(1)} km` : 'None (heading only)'} ok={!!d.corridor} />
          {d.recording && <Row label="Recording road" value={`${d.recording.length} points`} ok />}
        </Card>
      )}

      {d.active && d.settings.destination && (
        <Button title="Navigate in Google Maps" onPress={() => d.openMaps(false)} />
      )}

      <Card>
        <Text style={styles.h2}>Lifecycle test</Text>
        <Text style={styles.small}>Synthetic alerts, spoken as “test alert … not a real report”.</Text>
        <View style={styles.row}>
          <Button title="Test object" onPress={() => d.injectTest(false)} disabled={!d.active} style={{ flex: 1 }} />
          <Button title="Test blockage" onPress={() => d.injectTest(true)} disabled={!d.active} style={{ flex: 1 }} />
        </View>
      </Card>
    </ScrollView>
  );
}

/** Smallest picture size that is still at least 640 px wide (keeps uploads small and fast). */
function smallestUseful(sizes: string[]): string | undefined {
  const parsed = sizes.map((s) => {
    const m = s.match(/(\d+)x(\d+)/);
    return m ? { s, w: Math.max(+m[1], +m[2]), h: Math.min(+m[1], +m[2]) } : null;
  }).filter((x): x is { s: string; w: number; h: number } => !!x && x.w >= 640);
  parsed.sort((a, b) => a.w * a.h - b.w * b.h);
  if (parsed[0]) return parsed[0].s;
  const presets = ['Photo640x480', 'vga640x480', 'Low', 'cif352x288'];
  return presets.find((p) => sizes.includes(p));
}

function statusLine(d: Drive): { title: string; detail: string; color: string } {
  if (!d.active) return { title: 'Not driving', detail: 'Pudle is not using location or speaking reports.', color: colors.gray };
  if (d.muted) return { title: 'Drive active · Muted', detail: 'Reports are received but not spoken. Muted reports are not replayed.', color: colors.orange };
  if (d.locationDenied) return { title: 'Drive active · No location', detail: 'Allow location for Expo Go in iOS Settings. Without it Pudle cannot tell what is ahead.', color: colors.red };
  if (!d.settings.convoyId) return { title: 'Drive active · No convoy', detail: 'Create or join a convoy in Settings to share reports.', color: colors.orange };
  if (d.feed === 'offline') return { title: 'Drive active · Offline', detail: 'New reports cannot arrive. This is not an all-clear.', color: colors.red };
  if (d.feed === 'problem') return { title: 'Drive active · Connection problem', detail: 'Reports may be missed. This is not an all-clear.', color: colors.red };
  if (d.feed !== 'live') return { title: 'Drive active · Connecting', detail: 'Waiting for the report feed.', color: colors.orange };
  return { title: 'Drive active · Listening', detail: 'Keep Pudle on screen. Reports ahead on your road are spoken.', color: colors.green };
}

const feedText = (f: string) => ({ idle: 'Idle', connecting: 'Connecting…', live: 'Live (checks every 2 s)', problem: 'Problem', offline: 'Offline' } as Record<string, string>)[f] ?? f;
const speedText = (s?: number | null) => (s == null ? 'speed ?' : `${Math.round(s * 2.237)} mph`);

const styles = StyleSheet.create({
  page: { padding: 16, gap: 14, paddingBottom: 60 },
  status: { borderWidth: 2, borderRadius: 14, padding: 14, gap: 4 },
  statusTitle: { fontSize: 20, fontWeight: '700' },
  h2: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 15 },
  small: { fontSize: 13, color: '#555' },
  row: { flexDirection: 'row', gap: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  camera: { height: 240, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
  badge: { position: 'absolute', left: 8, bottom: 8, backgroundColor: '#000a', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  prompt: { backgroundColor: colors.orange + '30', borderRadius: 12, padding: 12, gap: 8 },
  toggle: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#ccc' },
  toggleOn: { backgroundColor: colors.green },
  toggleText: { color: '#fff', fontWeight: '800' },
});
