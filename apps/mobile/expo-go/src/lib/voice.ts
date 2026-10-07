// Speaks fixed phrases: Gemini voice persona when it arrives quickly, otherwise the phone's voice.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Speech from 'expo-speech';
import type { Persona } from '../core/phrases';
import { synthesize } from './backend';

let current: AudioPlayer | null = null;
let generation = 0;
let modeSet = false;

const DEVICE_PITCH: Record<Persona, number> = { copilot: 1.0, buddy: 1.1, pro: 0.95, hype: 1.2 };
const DEVICE_RATE: Record<Persona, number> = { copilot: 1.0, buddy: 1.05, pro: 1.0, hype: 1.12 };

export interface SpeakResult { startedAt: number; voice: string }

export async function speak(text: string, persona: Persona, cloud: boolean): Promise<SpeakResult> {
  const myGeneration = ++generation;
  stopSpeaking(false);
  if (!modeSet) {
    await setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers' }).catch(() => {});
    modeSet = true;
  }
  if (cloud) {
    try {
      const base64 = await synthesize(text, persona, 3500);
      if (myGeneration !== generation) return { startedAt: Date.now(), voice: 'superseded' };
      const file = new File(Paths.cache, `pudle-voice-${myGeneration}.wav`);
      file.create({ overwrite: true });
      file.write(base64, { encoding: 'base64' });
      const player = createAudioPlayer({ uri: file.uri });
      current = player;
      player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) { player.remove(); if (current === player) current = null; }
      });
      player.play();
      return { startedAt: Date.now(), voice: `gemini:${persona}` };
    } catch {
      if (myGeneration !== generation) return { startedAt: Date.now(), voice: 'superseded' };
    }
  }
  Speech.speak(text, { language: 'en-US', pitch: DEVICE_PITCH[persona], rate: DEVICE_RATE[persona] });
  return { startedAt: Date.now(), voice: 'on-device' };
}

export function stopSpeaking(bump = true) {
  if (bump) generation++;
  Speech.stop();
  if (current) {
    try { current.pause(); current.remove(); } catch { /* already released */ }
    current = null;
  }
}
