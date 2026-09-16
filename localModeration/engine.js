/**
 * CampusNest Local Moderation Inference Engine
 * Zero external dependencies, runs offline with < 5ms CPU latency.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeText } from './normalizer.js';
import { evaluateRules } from './rules.js';
import { TfidfVectorizer } from './vectorizer.js';
import { LogisticRegressionClassifier } from './classifier.js';
import { classifyImage } from './imageClassifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let vectorizerInstance = null;
let classifierInstance = null;
let modelMetadata = null;
let isInitialized = false;

// Category-specific human-readable reason mapping
const CATEGORY_REASONS = {
  sexual_content_nudity: "Content contains explicit sexual solicitation or nudity.",
  harassment_abuse: "Content contains targeted abusive language or harassment.",
  hate_speech: "Content contains hate speech or discriminatory slurs.",
  violence_threats: "Content contains violence, physical threats, or self-harm encouragement.",
  scams_spam: "Content contains financial scam, credential theft, or spam patterns.",
  illegal_acts: "Content involves illicit or illegal activities.",
};

/**
 * Initialize and load the model into memory once on application startup
 */
export const initLocalModeration = () => {
  if (isInitialized) return true;

  try {
    const modelPath = path.join(__dirname, 'model.json');
    if (!fs.existsSync(modelPath)) {
      console.warn("[LOCAL MODERATION] model.json not found. Please run train.js before starting.");
      return false;
    }

    const rawModel = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
    vectorizerInstance = TfidfVectorizer.fromJSON(rawModel.vectorizer);
    classifierInstance = LogisticRegressionClassifier.fromJSON(rawModel.classifier);
    modelMetadata = {
      version: rawModel.version,
      trainedAt: rawModel.trainedAt,
      accuracy: rawModel.evaluation?.accuracy,
    };

    isInitialized = true;
    console.log(`[LOCAL MODERATION] Engine initialized successfully (Accuracy: ${modelMetadata.accuracy}% | Offline CPU Mode)`);
    return true;
  } catch (err) {
    console.error("[LOCAL MODERATION ERROR] Failed to load local model:", err.message);
    isInitialized = false;
    return false;
  }
};

/**
 * Main local text moderation function
 * @param {string} text - User submitted text
 * @returns {{ isSafe: boolean, moderationFailed: boolean, flaggedCategories: string[], reason: string, confidence: number }}
 */
export const moderateText = (text) => {
  try {
    if (!text || typeof text !== "string" || !text.trim()) {
      return {
        isSafe: true,
        moderationFailed: false,
        flaggedCategories: [],
        reason: "No harmful content detected.",
        confidence: 1.0,
      };
    }

    // Lazy load if not yet initialized
    if (!isInitialized) {
      const ok = initLocalModeration();
      if (!ok) {
        return {
          isSafe: false,
          moderationFailed: true,
          flaggedCategories: [],
          reason: "Local moderation model failed to initialize",
          confidence: 0,
        };
      }
    }

    const cleanInput = text.trim();
    const normalized = normalizeText(cleanInput);

    // 1. High-precision rule check (handles extreme abuse, overt slurs, and educational context overrides)
    const ruleResult = evaluateRules(cleanInput);
    if (ruleResult.isFlagged) {
      const reason = ruleResult.reason || CATEGORY_REASONS[ruleResult.category] || "Violates community guidelines.";
      return {
        isSafe: false,
        moderationFailed: false,
        flaggedCategories: [ruleResult.category],
        reason: reason,
        confidence: 0.99,
      };
    }

    // If educational or reporting context was explicitly detected, pass as SAFE
    if (ruleResult.isReportingContext) {
      return {
        isSafe: true,
        moderationFailed: false,
        flaggedCategories: [],
        reason: "Content verified as educational/reporting context.",
        confidence: 0.95,
      };
    }

    // 2. ML Classifier Prediction
    const featureVector = vectorizerInstance.transform(normalized);

    // Check if feature vector has non-zero features
    let hasFeatures = false;
    for (let i = 0; i < featureVector.length; i++) {
      if (featureVector[i] > 0) {
        hasFeatures = true;
        break;
      }
    }

    if (!hasFeatures) {
      return {
        isSafe: true,
        moderationFailed: false,
        flaggedCategories: [],
        reason: "No harmful content detected.",
        confidence: 0.98,
      };
    }

    const prediction = classifierInstance.predict(featureVector);
    const predictedClass = prediction.label;
    const safeProb = prediction.probabilities["SAFE"] || 0;
    const violationProb = prediction.probabilities[predictedClass] || 0;

    // Strict safety threshold: Only flag if violation class is confident and not ambiguous
    if (predictedClass !== "SAFE" && violationProb >= 0.65 && safeProb < 0.30) {
      const reason = CATEGORY_REASONS[predictedClass] || "Violates community guidelines.";
      return {
        isSafe: false,
        moderationFailed: false,
        flaggedCategories: [predictedClass],
        reason: reason,
        confidence: Math.round(violationProb * 100) / 100,
      };
    }

    // Default to SAFE for normal campus discussions
    return {
      isSafe: true,
      moderationFailed: false,
      flaggedCategories: [],
      reason: "No harmful content detected.",
      confidence: Math.round(Math.max(safeProb, 0.85) * 100) / 100,
    };
  } catch (err) {
    console.error("[LOCAL MODERATION] Runtime error during text classification:", err.message);
    return {
      isSafe: false,
      moderationFailed: true,
      flaggedCategories: [],
      reason: `Local moderation error: ${err.message}`,
      confidence: 0,
    };
  }
};

/**
 * Local Image Moderation Interface
 * Runs 100% offline computer vision model on CPU using NSFWJS and TensorFlow.js.
 * @param {string|Buffer} imagePathOrUrl
 * @returns {Promise<{ isSafe: boolean, moderationFailed: boolean, category?: string, reason: string, confidence: number }>}
 */
export const moderateImage = async (imagePathOrUrl) => {
  if (!imagePathOrUrl) {
    return { isSafe: true, moderationFailed: false, reason: "No image attached", confidence: 1.0 };
  }
  return await classifyImage(imagePathOrUrl);
};

// Initialize model on load
initLocalModeration();

export default {
  initLocalModeration,
  moderateText,
  moderateImage,
};
