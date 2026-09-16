/**
 * CampusNest Standalone Moderation Service
 * Production-ready service layer for real-time offline text & image moderation.
 */

import { moderateText, moderateImage, initLocalModeration } from "./localModeration/engine.js";
import { evaluateRules } from "./localModeration/rules.js";

export const GENERIC_REJECTION_MESSAGE =
  "This content violates community safety guidelines and cannot be published.";
export const MODERATION_UNAVAILABLE_MESSAGE =
  "Content could not be verified right now. Please try again later.";

// Initialize local moderation engine on startup
initLocalModeration();

/**
 * Fast synchronous pattern & rule pre-check
 * @param {string} text 
 * @returns {{ isSafe: boolean, moderationFailed: boolean, flaggedCategories: string[], reason?: string }}
 */
export const fastPatternCheck = (text) => {
  if (!text || typeof text !== "string") {
    return { isSafe: true, moderationFailed: false, flaggedCategories: [] };
  }

  const ruleResult = evaluateRules(text);
  if (ruleResult.isFlagged) {
    return {
      isSafe: false,
      moderationFailed: false,
      reason: ruleResult.reason || "Violates community guidelines.",
      flaggedCategories: [ruleResult.category],
    };
  }

  return { isSafe: true, moderationFailed: false, flaggedCategories: [] };
};

/**
 * Moderate text string
 * @param {string} text 
 * @returns {Promise<{ isSafe: boolean, moderationFailed: boolean, message?: string, reason: string, flaggedCategories: string[], confidence: number, latencyMs: number }>}
 */
export const moderateTextOnly = async (text = "") => {
  const start = performance.now();
  const cleanText = (text || "").trim();

  if (!cleanText) {
    return {
      isSafe: true,
      moderationFailed: false,
      reason: "Empty text content.",
      flaggedCategories: [],
      confidence: 1.0,
      latencyMs: Math.round(performance.now() - start),
    };
  }

  const result = moderateText(cleanText);
  const latencyMs = Math.round(performance.now() - start);

  if (result.moderationFailed) {
    return {
      isSafe: false,
      moderationFailed: true,
      message: MODERATION_UNAVAILABLE_MESSAGE,
      reason: result.reason,
      flaggedCategories: [],
      confidence: 0,
      latencyMs,
    };
  }

  if (!result.isSafe) {
    return {
      isSafe: false,
      moderationFailed: false,
      message: GENERIC_REJECTION_MESSAGE,
      reason: result.reason,
      flaggedCategories: result.flaggedCategories,
      confidence: result.confidence,
      latencyMs,
    };
  }

  return {
    isSafe: true,
    moderationFailed: false,
    reason: result.reason || "No harmful content detected.",
    flaggedCategories: [],
    confidence: result.confidence || 0.95,
    latencyMs,
  };
};

/**
 * Moderate an image input (URL, base64, buffer, or file path)
 * @param {string|Buffer} imageInput 
 * @returns {Promise<{ isSafe: boolean, moderationFailed: boolean, message?: string, reason: string, category?: string, confidence: number, predictions?: Array<{ className: string, probability: number }>, latencyMs: number }>}
 */
export const moderateImageOnly = async (imageInput) => {
  const start = performance.now();
  if (!imageInput) {
    return {
      isSafe: true,
      moderationFailed: false,
      reason: "No image provided.",
      confidence: 1.0,
      latencyMs: Math.round(performance.now() - start),
    };
  }

  const result = await moderateImage(imageInput);
  const latencyMs = Math.round(performance.now() - start);

  if (result.moderationFailed) {
    return {
      isSafe: false,
      moderationFailed: true,
      message: MODERATION_UNAVAILABLE_MESSAGE,
      reason: result.reason || "Image moderation unavailable",
      confidence: 0,
      latencyMs,
    };
  }

  if (!result.isSafe) {
    return {
      isSafe: false,
      moderationFailed: false,
      message: GENERIC_REJECTION_MESSAGE,
      reason: result.reason,
      category: result.category || "sexual_content_nudity",
      confidence: result.confidence,
      predictions: result.predictions,
      latencyMs,
    };
  }

  return {
    isSafe: true,
    moderationFailed: false,
    reason: result.reason || "Image passed safety verification.",
    confidence: result.confidence,
    predictions: result.predictions,
    latencyMs,
  };
};

/**
 * Unified content moderation for both text and optional image
 * @param {Object} params
 * @param {string} [params.text] - Post, confession, or message text
 * @param {string} [params.imageUrl] - Image URL
 * @param {string} [params.imageBase64] - Base64 encoded image string or data URI
 * @param {Buffer} [params.imageBuffer] - Raw image buffer (from multipart file upload)
 * @param {string} [params.context] - Optional context ('post', 'confession', 'comment', 'chat', etc.)
 * @returns {Promise<{ isSafe: boolean, moderationFailed: boolean, message?: string, reason: string, flaggedCategories: string[], confidence: number, textResult?: object, imageResult?: object, latencyMs: number, timestamp: string }>}
 */
export const moderateContent = async ({
  text = "",
  imageUrl = "",
  imageBase64 = "",
  imageBuffer = null,
  context = "general",
}) => {
  const start = performance.now();
  const cleanText = (text || "").trim();
  const imageInput = imageBuffer || imageBase64 || imageUrl;
  const hasImage = Boolean(imageInput);

  // If both text and image are empty
  if (!cleanText && !hasImage) {
    return {
      isSafe: false,
      moderationFailed: false,
      message: "Content cannot be empty. Please provide text or an image.",
      reason: "Empty content",
      flaggedCategories: [],
      confidence: 1.0,
      latencyMs: Math.round(performance.now() - start),
      timestamp: new Date().toISOString(),
    };
  }

  let textResult = null;
  let imageResult = null;
  const flaggedCategories = [];
  let rejectionReason = "";
  let overallConfidence = 1.0;

  try {
    // 1. Moderate text if present
    if (cleanText) {
      textResult = await moderateTextOnly(cleanText);
      if (textResult.moderationFailed) {
        return {
          isSafe: false,
          moderationFailed: true,
          message: MODERATION_UNAVAILABLE_MESSAGE,
          reason: textResult.reason,
          flaggedCategories: [],
          textResult,
          latencyMs: Math.round(performance.now() - start),
          timestamp: new Date().toISOString(),
        };
      }

      if (!textResult.isSafe) {
        flaggedCategories.push(...textResult.flaggedCategories);
        rejectionReason = textResult.reason;
        overallConfidence = textResult.confidence;
      }
    }

    // 2. Moderate image if present
    if (hasImage) {
      imageResult = await moderateImageOnly(imageInput);
      if (imageResult.moderationFailed) {
        return {
          isSafe: false,
          moderationFailed: true,
          message: MODERATION_UNAVAILABLE_MESSAGE,
          reason: imageResult.reason,
          flaggedCategories: [],
          textResult,
          imageResult,
          latencyMs: Math.round(performance.now() - start),
          timestamp: new Date().toISOString(),
        };
      }

      if (!imageResult.isSafe) {
        if (imageResult.category && !flaggedCategories.includes(imageResult.category)) {
          flaggedCategories.push(imageResult.category);
        }
        if (!rejectionReason) {
          rejectionReason = imageResult.reason;
        } else {
          rejectionReason += " | " + imageResult.reason;
        }
        overallConfidence = Math.min(overallConfidence, imageResult.confidence);
      }
    }

    const isSafe = flaggedCategories.length === 0;
    const latencyMs = Math.round(performance.now() - start);

    return {
      isSafe,
      moderationFailed: false,
      message: isSafe ? undefined : GENERIC_REJECTION_MESSAGE,
      reason: isSafe ? "All content passed safety verification." : rejectionReason,
      flaggedCategories,
      confidence: overallConfidence,
      context,
      textResult: textResult ? {
        isSafe: textResult.isSafe,
        reason: textResult.reason,
        flaggedCategories: textResult.flaggedCategories,
        confidence: textResult.confidence,
      } : null,
      imageResult: imageResult ? {
        isSafe: imageResult.isSafe,
        reason: imageResult.reason,
        category: imageResult.category,
        confidence: imageResult.confidence,
      } : null,
      latencyMs,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[MODERATION SERVICE ERROR]", err);
    return {
      isSafe: false,
      moderationFailed: true,
      message: MODERATION_UNAVAILABLE_MESSAGE,
      reason: "Internal moderation error: " + err.message,
      flaggedCategories: [],
      latencyMs: Math.round(performance.now() - start),
      timestamp: new Date().toISOString(),
    };
  }
};

/**
 * Moderate a batch of items
 * @param {Array<Object>} items - Array of { id, text, imageUrl, imageBase64, context }
 * @returns {Promise<Array<Object>>}
 */
export const moderateBatch = async (items = []) => {
  if (!Array.isArray(items) || items.length === 0) return [];
  const results = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const modRes = await moderateContent({
      text: item.text,
      imageUrl: item.imageUrl,
      imageBase64: item.imageBase64,
      context: item.context || "batch",
    });
    results.push({
      id: item.id !== undefined ? item.id : i,
      ...modRes,
    });
  }
  return results;
};

/**
 * List all supported categories & definitions
 */
export const getSupportedCategories = () => [
  {
    id: "harassment_abuse",
    name: "Harassment & Abuse",
    description: "Targeted abusive language, personal attacks, intimidation, or severe vulgar slurs.",
  },
  {
    id: "sexual_content_nudity",
    name: "Sexual Content & Nudity",
    description: "Explicit pornography, sexual solicitation, unsolicited sexual advances, and NSFW imagery.",
  },
  {
    id: "hate_speech",
    name: "Hate Speech",
    description: "Attacks or slurs based on religion, caste, race, ethnicity, sexual orientation, gender, or disability.",
  },
  {
    id: "violence_threats",
    name: "Violence & Threats",
    description: "Physical violence threats, weapon possession, self-harm encouragement, and suicide prompts.",
  },
  {
    id: "scams_spam",
    name: "Scams & Financial Fraud",
    description: "Phishing, OTP solicitation, lottery scams, fake betting schemes, and credential theft.",
  },
  {
    id: "illegal_acts",
    name: "Illegal Activities",
    description: "Illicit drug distribution, exam question paper leaks, cheating networks, and blackmail.",
  },
];

export default {
  moderateContent,
  moderateTextOnly,
  moderateImageOnly,
  moderateBatch,
  fastPatternCheck,
  getSupportedCategories,
  GENERIC_REJECTION_MESSAGE,
  MODERATION_UNAVAILABLE_MESSAGE,
};
