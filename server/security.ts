import { HttpError } from './http';

const PASSWORD_ITERATIONS = 310_000;
const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes;
}

async function derivePassword(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, iterationText, saltText, expectedText] = encoded.split('$');
  const iterations = Number(iterationText);
  if (
    algorithm !== 'pbkdf2_sha256'
    || !Number.isInteger(iterations)
    || iterations < PASSWORD_ITERATIONS
    || !saltText
    || !expectedText
  ) {
    return false;
  }

  try {
    const actual = await derivePassword(password, base64ToBytes(saltText), iterations);
    const expected = base64ToBytes(expectedText);
    if (actual.byteLength !== expected.byteLength) return false;
    let difference = 0;
    for (let index = 0; index < actual.byteLength; index += 1) {
      difference |= actual[index] ^ expected[index];
    }
    return difference === 0;
  } catch {
    return false;
  }
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

export function createOpaqueToken() {
  return bytesToBase64(randomBytes(32))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function requireMutationOrigin(request: Request, configuredOrigin?: string) {
  const origin = request.headers.get('origin');
  const expectedOrigin = configuredOrigin || new URL(request.url).origin;
  if (!origin || origin !== expectedOrigin) {
    throw new HttpError(403, 'Request origin is not allowed.');
  }
  if (request.headers.get('x-pudle-csrf') !== '1') {
    throw new HttpError(403, 'CSRF validation failed.');
  }
}
