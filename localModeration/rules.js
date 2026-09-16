/**
 * Rule-Based Safety Engine for Fast Pre-filtering and Context Verification
 */

import { normalizeText, removeMasking } from "./normalizer.js";

// Educational / Reporting phrases that indicate benign discussion
const REPORTING_EDUCATIONAL_PATTERNS = [
  /\b(report|reporting|reported|complaint|filing\s+a\s+complaint)\s+(harassment|abuse|threat|incident|crime|scam|inappropriate)\b/i,
  /\b(discussed|covered|lecture\s+on|workshop\s+on|awareness\s+about|policy\s+on|prevention\s+of)\s+(sexual\s+harassment|bullying|cyberbullying|consent|mental\s+health|harassment|discrimination)\b/i,
  /\b(definition\s+of|education\s+about|seminar\s+on|session\s+about)\b/i,
];

// High severity patterns with specific category tags
const SEVERE_PATTERNS = [
  {
    category: "sexual_content_nudity",
    regex: /\b(send\s+(?:me\s+)?(?:your\s+)?(?:nudes?|private\s+pics?|nangi\s+photo)|escort\s+service|casual\s+sex\s+tonight|pornographic\s+videos?|leaked\s+mms|adult\s+sex\s+chat|xxx\s+sex\s+clips?)\b/i,
    reason: "Content contains explicit sexual solicitation or pornography requests.",
  },
  {
    category: "violence_threats",
    regex: /\b(i\s+will\s+(?:kill|murder|beat|stab|slash|shoot|assault)\s+you|kill\s+yourself\s+now|commit\s+suicide|jump\s+off\s+the\s+roof|bring(?:ing)?\s+a\s+(?:knife|gun|bomb)|break\s+your\s+bones)\b/i,
    reason: "Content contains direct threats of physical violence or self-harm encouragement.",
  },
  {
    category: "scams_spam",
    regex: /\b(send\s+(?:me\s+)?(?:your\s+)?otp|bank\s+account\s+password|win\s+lottery\s+prize|crypto\s+betting\s+scheme|double\s+your\s+money\s+in|pay\s+registration\s+fee\s+to\s+win)\b/i,
    reason: "Content contains financial scam, credential theft, or phishing patterns.",
  },
  {
    category: "illegal_acts",
    regex: /\b(sell\s+(?:me\s+)?(?:illegal\s+drugs?|weed|ganja|cocaine|mdma)|leaked\s+(?:question\s+paper|exam\s+paper)|cheating\s+network\s+for|fake\s+degree\s+certificates?|blackmail.*transfer\s+money)\b/i,
    reason: "Content involves illegal drug distribution, exam leaks, or illicit acts.",
  },
  {
    category: "harassment_abuse",
    regex: /\b(madarchod|madarchodh|behenchod|bhenchod|bhosdike|bhosdika|bsdk|bkl|chutiya|chutye|chutiye|randi|gandu|gaandu|lauda|lawda|lund|kuttiya|fuck|asshole|bitch|bastard|idiot.*die)\b/i,
    reason: "Content contains severe abusive language, targeted slurs, or harassment.",
  },
  {
    category: "hate_speech",
    regex: /\b(lower\s+caste.*shouldn't\s+exist|muslims\s+are\s+terrorists|kill\s+all\s+members\s+of|dalits\s+should\s+know\s+their\s+place|transgender.*abominations|terrorist\s+religion)\b/i,
    reason: "Content contains targeted hate speech or discriminatory attacks.",
  },
];

/**
 * Checks if the text is primarily educational or incident reporting
 */
export const isEducationalOrReporting = (text) => {
  if (!text) return false;
  return REPORTING_EDUCATIONAL_PATTERNS.some(pat => pat.test(text));
};

/**
 * Evaluates text against high-precision safety rules
 */
export const evaluateRules = (rawText) => {
  if (!rawText || typeof rawText !== "string") {
    return { isFlagged: false };
  }

  const normalized = normalizeText(rawText);
  const unmasked = removeMasking(rawText);

  // If text is in an educational or reporting context, do not flag via generic regex
  if (isEducationalOrReporting(rawText) || isEducationalOrReporting(normalized)) {
    return { isFlagged: false, isReportingContext: true };
  }

  for (const rule of SEVERE_PATTERNS) {
    if (rule.regex.test(rawText) || rule.regex.test(normalized) || rule.regex.test(unmasked)) {
      return {
        isFlagged: true,
        category: rule.category,
        reason: rule.reason,
      };
    }
  }

  return { isFlagged: false };
};

export default {
  evaluateRules,
  isEducationalOrReporting,
};
