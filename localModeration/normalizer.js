/**
 * CampusNest Local Moderation - Text Normalizer
 * Handles Hinglish, Roman script, character repetitions, leetspeak, and spacing/punctuation obfuscation.
 */

const LEET_MAP = {
  "@": "a",
  "4": "a",
  "8": "b",
  "3": "e",
  "1": "i",
  "!": "i",
  "|": "i",
  "0": "o",
  "$": "s",
  "5": "s",
  "7": "t",
  "+": "t",
};

export const replaceLeetspeak = (str) => {
  if (!str) return "";
  let result = str.toLowerCase();
  for (const [sym, char] of Object.entries(LEET_MAP)) {
    result = result.replaceAll(sym, char);
  }
  return result;
};

export const collapseRepetitions = (str) => {
  if (!str) return "";
  return str.replace(/(.)\1{2,}/g, "$1$1");
};

export const removeMasking = (str) => {
  if (!str) return "";
  const vowelMasked = str.replace(/([b-df-hj-np-tv-z])[\*\@]([b-df-hj-np-tv-z])/gi, "$1u$2");
  return vowelMasked.replace(/[\*\.\-_@#\$\%!\^\&\(\)\+=\\/'\"\`~]/g, "");
};

export const condenseSpacedWords = (str) => {
  if (!str) return str;
  return str.replace(/\b([a-z](?:\s+[a-z]){1,15})\b/gi, (match) => {
    return match.replace(/\s+/g, "");
  });
};

export const normalizeText = (rawText) => {
  if (!rawText || typeof rawText !== "string") return "";
  const trimmed = rawText.trim();
  const lower = trimmed.toLowerCase();
  const deLeeted = replaceLeetspeak(lower);
  const unmasked = removeMasking(deLeeted);
  const condensed = condenseSpacedWords(unmasked);
  const deRepeated = collapseRepetitions(condensed);
  return deRepeated.replace(/\s+/g, " ").trim();
};

export default {
  normalizeText,
  replaceLeetspeak,
  collapseRepetitions,
  removeMasking,
  condenseSpacedWords,
};
