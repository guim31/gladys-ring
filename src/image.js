// -----------------------------------------------------------------------------
// Fitting a Ring snapshot into the Gladys image limits.
//
// Gladys refuses a camera image whose `image/jpg;base64,...` string exceeds
// 150 KB (`camera.setImage`, checked on the string length), and a widget image
// above 300 KB decoded or 4096 px. Recent Ring cameras can take snapshots
// above that, and the core never recompresses: we do, and only when the
// original does not fit.
//
// sharp (libvips, prebuilt binaries for Alpine on amd64 and arm64) rather
// than a pure JavaScript codec: measured on a 1080p frame, jpeg-js grows the
// process by about 175 MB of RSS, sharp by about 40 MB (shrink-on-load
// decodes the JPEG at a reduced scale). The sandbox has 256 MB.
// -----------------------------------------------------------------------------

import sharp from 'sharp';

// No libvips operation cache (memory), one thread (the sandbox has little CPU).
sharp.cache(false);
sharp.concurrency(1);

export const CAMERA_IMAGE_PREFIX = 'image/jpg;base64,';
// String length bound of the core, prefix included.
export const MAX_CAMERA_IMAGE_LENGTH = 150 * 1024;

// Successive attempts, from the mildest: [max width, JPEG quality].
const ATTEMPTS = [
  [1280, 75],
  [960, 70],
  [640, 65],
  [480, 55],
];

function base64Length(bytes) {
  return Math.ceil(bytes / 3) * 4;
}

export function fitsCameraImage(buffer) {
  return CAMERA_IMAGE_PREFIX.length + base64Length(buffer.length) <= MAX_CAMERA_IMAGE_LENGTH;
}

/**
 * Shrink a JPEG until it fits the camera image limit (which also satisfies the
 * widget image limits). Resolves the input untouched when it already fits.
 * @param {Buffer} buffer JPEG bytes
 * @returns {Promise<Buffer>}
 */
export async function fitJpeg(buffer) {
  if (fitsCameraImage(buffer)) {
    return buffer;
  }
  let last = buffer;
  for (const [width, quality] of ATTEMPTS) {
    last = await sharp(buffer, { limitInputPixels: 4096 * 4096, sequentialRead: true })
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer();
    if (fitsCameraImage(last)) {
      return last;
    }
  }
  return last;
}

/** The SDK camera image format. */
export function toCameraImage(buffer) {
  return `${CAMERA_IMAGE_PREFIX}${buffer.toString('base64')}`;
}
