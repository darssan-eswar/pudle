export type PudyAction =
  | 'remember-fuel-prices'
  | 'remember-charging'
  | 'stop-recording'
  | 'save-current-clip'
  | 'prepare-hazard-report';

export type ParsedPudyRequest =
  | { kind: 'action'; action: PudyAction }
  | { kind: 'question'; topic: 'scene' | 'nearby' }
  | { kind: 'unknown' }
  | { kind: 'missing-wake-phrase' };

export interface PudyRecordingControl {
  isRecording(): boolean;
  stopAndSave(): Promise<
    | { saved: true }
    | { saved: false; error: { message: string } }
  >;
}

const WAKE_PHRASE = /\bhey[\s,]+pudy\b/i;

export function parsePudyRequest(
  input: string,
  requireWakePhrase = false,
): ParsedPudyRequest {
  const normalized = input.trim().toLowerCase();
  if (requireWakePhrase && !WAKE_PHRASE.test(normalized)) {
    return { kind: 'missing-wake-phrase' };
  }
  const command = normalized.replace(WAKE_PHRASE, '').trim();
  // Do not turn a negated preference or action into its positive counterpart.
  if (/\b(no|not|never|don't|dont|do not|stop watching|forget)\b/.test(command)) {
    return { kind: 'unknown' };
  }
  if (/\b(important|remember|interested|watch)\b/.test(command)) {
    if (/\b(gas|fuel|petrol)\b.*\bprices?\b/.test(command)) {
      return { kind: 'action', action: 'remember-fuel-prices' };
    }
    if (/\b(charging|chargers?)\b/.test(command)) {
      return { kind: 'action', action: 'remember-charging' };
    }
  }
  if (/\b(stop|end)\b.*\brecord(ing)?\b/.test(command)) {
    return { kind: 'action', action: 'stop-recording' };
  }
  if (/\b(save|keep)\b.*\b(clip|recording)\b/.test(command)) {
    return { kind: 'action', action: 'save-current-clip' };
  }
  if (/\b(report|prepare)\b.*\b(hazard|debris|crash|flood|road)\b/.test(command)) {
    return { kind: 'action', action: 'prepare-hazard-report' };
  }
  if (/\b(nearby|ahead|route|road)\b/.test(command)) {
    return { kind: 'question', topic: 'nearby' };
  }
  if (/\b(see|scene|camera|visible)\b/.test(command)) {
    return { kind: 'question', topic: 'scene' };
  }
  return { kind: 'unknown' };
}

export function groundPudyAnswer(
  request: ParsedPudyRequest,
  context: {
    sceneLabels: string[];
    nearbyLabels: string[];
    analysisLabels?: string[];
  },
): string {
  if (request.kind === 'missing-wake-phrase') {
    return 'Say “Hey Pudy” followed by your request.';
  }
  if (request.kind === 'unknown') {
    return 'I can describe displayed observations, save a clip, prepare a report, or remember a fuel-price or charging interest. Manage or clear interests in Profile while parked.';
  }
  if (request.kind === 'action') {
    if (request.action.startsWith('remember-')) return 'Preparing a private trip interest.';
    return request.action === 'prepare-hazard-report'
      ? 'Hazard report prepared. Review and confirm it on screen before anything is shared.'
      : request.action === 'save-current-clip'
        ? 'Saving the current recording on this device.'
        : 'Stopping the current recording.';
  }
  const labels = request.topic === 'scene'
    ? [...(context.analysisLabels ?? []), ...context.sceneLabels]
    : context.nearbyLabels;
  if (!labels.length) {
    return request.topic === 'scene'
      ? 'No local scene observations are currently displayed.'
      : 'No nearby road activity is currently displayed.';
  }
  return request.topic === 'scene'
    ? context.analysisLabels?.length
      ? `Current cloud analysis and local scene: ${labels.join(', ')}.`
      : `Local scene: ${labels.join(', ')}.`
    : `Displayed nearby activity: ${labels.join(', ')}.`;
}

export async function stopRecordingForPudy(
  recording: PudyRecordingControl | null,
): Promise<string> {
  if (!recording?.isRecording()) {
    return 'No recording is active. Start one from the camera controls first.';
  }

  const result = await recording.stopAndSave();
  return result.saved
    ? 'The current recording was stopped and saved on this device.'
    : `The recording stopped, but it was not saved. ${result.error.message}`;
}
