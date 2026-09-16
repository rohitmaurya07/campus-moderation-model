import fs from 'fs';
import * as tf from '@tensorflow/tfjs';
import * as nsfwjs from 'nsfwjs';
import sharp from 'sharp';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

let nsfwModel = null;
let isLoadingModel = false;
let modelLoadPromise = null;

/**
 * Initialize / Load the NSFW image classification model into memory
 */
export const initImageModel = async () => {
  if (nsfwModel) return nsfwModel;
  if (isLoadingModel) return modelLoadPromise;

  isLoadingModel = true;
  modelLoadPromise = (async () => {
    try {
      console.log("[LOCAL IMAGE MODERATION] Loading local NSFW image classification model...");
      // Loads MobileNetV2 NSFW model
      nsfwModel = await nsfwjs.load();
      console.log("[LOCAL IMAGE MODERATION] NSFW image model loaded successfully (CPU Mode).");
      return nsfwModel;
    } catch (err) {
      console.error("[LOCAL IMAGE MODERATION ERROR] Failed to load NSFW image model:", err.message);
      nsfwModel = null;
      throw err;
    } finally {
      isLoadingModel = false;
    }
  })();

  return modelLoadPromise;
};

/**
 * Helper to decode any image buffer (JPEG, WebP, PNG, GIF, AVIF, BMP) into an RGB Tensor3D
 * @param {Buffer} buffer 
 * @returns {Promise<tf.Tensor3D>}
 */
const convertBufferToTensor = async (buffer) => {
  // 1. Primary: Use sharp (fast, native C++ libvips, handles all modern formats & progressive JPEGs)
  try {
    const { data, info } = await sharp(buffer)
      .rotate() // Auto-orient based on EXIF
      .removeAlpha() // Ensure 3 channels (RGB)
      .raw()
      .toBuffer({ resolveWithObject: true });

    return tf.tensor3d(new Uint8Array(data), [info.height, info.width, 3], 'int32');
  } catch (sharpErr) {
    console.warn(`[LOCAL IMAGE MODERATION] Sharp decoder failed, falling back to JS decoders:`, sharpErr.message);
  }

  // 2. Fallback: Pure JS JPEG decoder
  let width = 0;
  let height = 0;
  let data = null;

  try {
    const rawJpeg = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true });
    width = rawJpeg.width;
    height = rawJpeg.height;
    data = rawJpeg.data;
  } catch (jpegErr) {
    // 3. Fallback: Pure JS PNG decoder
    try {
      const png = PNG.sync.read(buffer);
      width = png.width;
      height = png.height;
      data = png.data;
    } catch (pngErr) {
      throw new Error(`Unsupported or unreadable image format: ${jpegErr.message} | ${pngErr.message}`);
    }
  }

  // Convert RGBA (4 channels) to RGB (3 channels)
  const numPixels = width * height;
  const rgbValues = new Uint8Array(numPixels * 3);
  for (let i = 0; i < numPixels; i++) {
    rgbValues[i * 3] = data[i * 4];       // R
    rgbValues[i * 3 + 1] = data[i * 4 + 1]; // G
    rgbValues[i * 3 + 2] = data[i * 4 + 2]; // B
  }

  return tf.tensor3d(rgbValues, [height, width, 3], 'int32');
};

/**
 * Fetch image buffer from local file path, remote HTTP/HTTPS URL, Base64 data URI, or raw Base64 string
 * @param {string|Buffer} imageInput 
 * @returns {Promise<Buffer>}
 */
const fetchImageBuffer = async (imageInput) => {
  if (Buffer.isBuffer(imageInput)) {
    return imageInput;
  }
  if (typeof imageInput !== 'string') {
    throw new Error('Image input must be a Buffer, URL, base64 string, or file path');
  }

  const trimmed = imageInput.trim();

  // 1. Base64 Data URI (e.g. data:image/jpeg;base64,/9j/4AAQSkZJRg...)
  if (trimmed.startsWith('data:image/')) {
    const base64Index = trimmed.indexOf('base64,');
    if (base64Index !== -1) {
      const base64Data = trimmed.substring(base64Index + 7);
      return Buffer.from(base64Data, 'base64');
    }
  }

  // 2. HTTP / HTTPS URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout
    try {
      const res = await fetch(trimmed, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) {
        throw new Error(`Failed to fetch image URL (HTTP ${res.status}): ${trimmed}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  // 3. Local file path on disk
  if (fs.existsSync(trimmed)) {
    return fs.readFileSync(trimmed);
  }

  // 4. Raw Base64 string check (long string without spaces that decodes to image bytes)
  if (trimmed.length > 100 && /^[A-Za-z0-9+/=]+$/.test(trimmed.slice(0, 100))) {
    try {
      const buf = Buffer.from(trimmed, 'base64');
      if (buf.length > 10) return buf;
    } catch (e) {
      // Not base64
    }
  }

  throw new Error(`Invalid image input: path does not exist, URL unreachable, or unrecognized format.`);
};

/**
 * Classify an image locally on CPU
 * @param {string|Buffer} imageInput - URL, local path, or file Buffer
 * @returns {Promise<{ isSafe: boolean, moderationFailed: boolean, category?: string, reason: string, confidence: number, predictions?: Array<{ className: string, probability: number }> }>}
 */
export const classifyImage = async (imageInput) => {
  if (!imageInput) {
    return {
      isSafe: true,
      moderationFailed: false,
      reason: "No image provided.",
      confidence: 1.0,
    };
  }

  let tensor = null;
  try {
    const model = await initImageModel();
    if (!model) {
      return {
        isSafe: false,
        moderationFailed: true,
        reason: "Image moderation model unavailable",
        confidence: 0,
      };
    }

    const buffer = Buffer.isBuffer(imageInput)
      ? imageInput
      : await fetchImageBuffer(imageInput);

    tensor = await convertBufferToTensor(buffer);
    const predictions = await model.classify(tensor);

    // Categories: Porn, Hentai, Sexy, Neutral, Drawing
    const resultMap = {};
    for (const p of predictions) {
      resultMap[p.className] = p.probability;
    }

    const pornProb = resultMap["Porn"] || 0;
    const hentaiProb = resultMap["Hentai"] || 0;
    const sexyProb = resultMap["Sexy"] || 0;
    const neutralProb = resultMap["Neutral"] || 0;
    const drawingProb = resultMap["Drawing"] || 0;

    console.log(`[LOCAL IMAGE MODERATION] Predictions: Porn=${(pornProb * 100).toFixed(1)}%, Hentai=${(hentaiProb * 100).toFixed(1)}%, Sexy=${(sexyProb * 100).toFixed(1)}%, Neutral=${(neutralProb * 100).toFixed(1)}%, Drawing=${(drawingProb * 100).toFixed(1)}%`);

    // Flagging threshold: explicit sexual content or heavy nudity
    if (pornProb > 0.40 || hentaiProb > 0.40 || (sexyProb > 0.70 && neutralProb < 0.25)) {
      const topViolationProb = Math.max(pornProb, hentaiProb, sexyProb);
      return {
        isSafe: false,
        moderationFailed: false,
        category: "sexual_content_nudity",
        reason: "Image contains explicit sexual content, nudity, or inappropriate imagery.",
        confidence: Math.round(topViolationProb * 100) / 100,
        predictions,
      };
    }

    // Image is safe
    return {
      isSafe: true,
      moderationFailed: false,
      reason: "Image passed local safety verification.",
      confidence: Math.round((neutralProb + drawingProb) * 100) / 100,
      predictions,
    };
  } catch (err) {
    console.error("[LOCAL IMAGE MODERATION ERROR]", err.message);
    return {
      isSafe: false,
      moderationFailed: true,
      reason: `Image processing error: ${err.message}`,
      confidence: 0,
    };
  } finally {
    if (tensor) {
      try {
        tensor.dispose();
      } catch (dispErr) {
        // Ignore dispose error
      }
    }
  }
};

export default {
  initImageModel,
  classifyImage,
};
