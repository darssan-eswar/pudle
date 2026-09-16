import type {
  LocalModelAdapter,
  LocalModelCapability,
  LocalObservation,
} from './contracts';

const MODEL_NAME = 'coco-ssd-lite_mobilenet_v2';
const MAX_OBSERVATIONS = 4;
const MIN_CONFIDENCE = 0.6;

interface CocoPrediction {
  class: string;
  score: number;
}

interface CocoDetector {
  detect(input: HTMLVideoElement): Promise<CocoPrediction[]>;
  dispose?: () => void;
}

type CocoLoader = (signal: AbortSignal) => Promise<CocoDetector>;

function abortError(): DOMException {
  return new DOMException('Local inference was cancelled.', 'AbortError');
}

async function loadCocoDetector(signal: AbortSignal): Promise<CocoDetector> {
  const [tf, coco] = await Promise.all([
    import('@tensorflow/tfjs'),
    import('@tensorflow-models/coco-ssd'),
  ]);
  if (signal.aborted) throw abortError();
  await tf.ready();
  if (signal.aborted) throw abortError();
  const detector = await coco.load({ base: 'lite_mobilenet_v2' });
  if (signal.aborted) {
    detector.dispose();
    throw abortError();
  }
  return detector;
}

export function localModelCapability(): LocalModelCapability {
  if (
    typeof window === 'undefined'
    || typeof document === 'undefined'
    || typeof HTMLVideoElement === 'undefined'
  ) {
    return {
      supported: false,
      reason: 'Local scene detection requires a visible browser page.',
    };
  }
  return { supported: true };
}

export function createCocoSsdAdapter(
  loader: CocoLoader = loadCocoDetector,
): LocalModelAdapter<HTMLVideoElement> {
  let detector: CocoDetector | undefined;

  return {
    source: 'local-model',
    model: MODEL_NAME,
    capability: localModelCapability,
    async load(signal) {
      detector?.dispose?.();
      detector = undefined;
      const loaded = await loader(signal);
      if (signal.aborted) {
        loaded.dispose?.();
        throw abortError();
      }
      detector = loaded;
    },
    async infer(video, signal): Promise<LocalObservation[]> {
      if (!detector) throw new Error('The local model is not ready.');
      if (!video.videoWidth || !video.videoHeight || video.readyState < 2) {
        throw new Error('A current camera frame is not available.');
      }
      if (signal.aborted) throw abortError();
      const predictions = await detector.detect(video);
      if (signal.aborted) throw abortError();
      return predictions
        .filter(
          (item) =>
            typeof item.class === 'string'
            && item.class.trim().length > 0
            && item.class.length <= 80
            && Number.isFinite(item.score)
            && item.score >= MIN_CONFIDENCE
            && item.score <= 1,
        )
        .slice(0, MAX_OBSERVATIONS)
        .map((item) => ({
          label: item.class.trim(),
          confidence: item.score,
        }));
    },
    dispose() {
      detector?.dispose?.();
      detector = undefined;
    },
  };
}
