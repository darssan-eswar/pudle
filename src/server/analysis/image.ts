import { HttpError, readBodyBytes } from '@/server/http';
import { MAX_ANALYSIS_REQUEST_BYTES, MAX_FRAME_DIMENSION } from './contracts';

export type SupportedImageType = 'image/jpeg' | 'image/webp';

function jpegDimensions(bytes: Uint8Array) {
  if (
    bytes.length < 4
    || bytes[0] !== 0xff
    || bytes[1] !== 0xd8
    || bytes[bytes.length - 2] !== 0xff
    || bytes[bytes.length - 1] !== 0xd9
  ) return null;
  for (let index = 2; index < bytes.length - 1; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd8) return null;
  }
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }
    offset += length;
  }
  return null;
}

function uint24le(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function webpDimensions(bytes: Uint8Array) {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes.length < 30 || ascii(0, 4) !== 'RIFF' || ascii(8, 12) !== 'WEBP') return null;
  const declaredSize = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
  if ((declaredSize >>> 0) + 8 !== bytes.length) return null;
  const chunk = ascii(12, 16);
  if (chunk === 'VP8X') {
    return { width: uint24le(bytes, 24) + 1, height: uint24le(bytes, 27) + 1 };
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function validateFrame(frame: Uint8Array, mimeType: SupportedImageType) {
  if (frame.byteLength === 0 || frame.byteLength > MAX_ANALYSIS_REQUEST_BYTES) {
    throw new HttpError(413, 'Frame must be between 1 byte and 512KB.', 'invalid_frame_size');
  }
  const dimensions = mimeType === 'image/jpeg' ? jpegDimensions(frame) : webpDimensions(frame);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
    throw new HttpError(400, 'Frame is not a valid supported image.', 'invalid_frame');
  }
  if (dimensions.width > MAX_FRAME_DIMENSION || dimensions.height > MAX_FRAME_DIMENSION) {
    throw new HttpError(400, 'Frame dimensions may not exceed 1920px.', 'invalid_dimensions');
  }
  return dimensions;
}

export async function readFrameRequest(request: Request) {
  const mimeType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (mimeType !== 'image/jpeg' && mimeType !== 'image/webp') {
    throw new HttpError(415, 'Content-Type must be image/jpeg or image/webp.', 'invalid_media_type');
  }
  const frame = await readBodyBytes(
    request,
    MAX_ANALYSIS_REQUEST_BYTES,
    () => new HttpError(413, 'Request body may not exceed 512KB.', 'invalid_frame_size'),
  );
  validateFrame(frame, mimeType);
  return { frame, mimeType: mimeType as SupportedImageType };
}
