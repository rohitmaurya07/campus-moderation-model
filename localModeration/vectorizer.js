/**
 * TF-IDF Vectorizer with Word & Character N-Grams
 */

export class TfidfVectorizer {
  constructor(options = {}) {
    this.minDocFreq = options.minDocFreq || 1;
    this.maxFeatures = options.maxFeatures || 3000;
    this.vocabulary = {}; // term -> index
    this.idf = []; // index -> idf value
    this.featureNames = [];
  }

  extractFeatures(text) {
    const clean = (text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ");
    const words = clean.split(/\s+/).filter(w => w.length > 0);
    const ngrams = [];

    // 1. Word unigrams (length >= 2 or significant tokens)
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w.length >= 2) {
        ngrams.push(w);
      }
    }

    // 2. Word bigrams
    for (let i = 0; i < words.length - 1; i++) {
      const w1 = words[i];
      const w2 = words[i + 1];
      if (w1.length >= 2 && w2.length >= 2) {
        ngrams.push(`${w1}_${w2}`);
      }
    }

    // 3. Sub-word character 3-grams & 4-grams (INSIDE individual words of length >= 4)
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w.length >= 4) {
        for (let j = 0; j <= w.length - 3; j++) {
          ngrams.push(`c3_${w.substring(j, j + 3)}`);
        }
        for (let j = 0; j <= w.length - 4; j++) {
          ngrams.push(`c4_${w.substring(j, j + 4)}`);
        }
      }
    }

    return ngrams;
  }

  fit(documents) {
    const docCount = documents.length;
    const docFreq = {};

    for (const doc of documents) {
      const terms = new Set(this.extractFeatures(doc));
      for (const t of terms) {
        docFreq[t] = (docFreq[t] || 0) + 1;
      }
    }

    // Filter by minDocFreq and sort by frequency
    const validTerms = Object.keys(docFreq)
      .filter(t => docFreq[t] >= this.minDocFreq)
      .sort((a, b) => docFreq[b] - docFreq[a])
      .slice(0, this.maxFeatures);

    this.vocabulary = {};
    this.featureNames = validTerms;
    this.idf = [];

    validTerms.forEach((term, idx) => {
      this.vocabulary[term] = idx;
      // Smooth IDF formula: ln((1 + N) / (1 + df)) + 1
      this.idf[idx] = Math.log((1 + docCount) / (1 + docFreq[term])) + 1;
    });

    return this;
  }

  transform(text) {
    const vector = new Float32Array(this.featureNames.length);
    const terms = this.extractFeatures(text);
    if (terms.length === 0) return vector;

    const termCounts = {};
    for (const t of terms) {
      if (this.vocabulary[t] !== undefined) {
        termCounts[t] = (termCounts[t] || 0) + 1;
      }
    }

    let sumSquares = 0;
    for (const [t, count] of Object.entries(termCounts)) {
      const idx = this.vocabulary[t];
      // TF * IDF (sublinear term frequency scaling)
      const tf = 1 + Math.log(count);
      const val = tf * this.idf[idx];
      vector[idx] = val;
      sumSquares += val * val;
    }

    // L2 Normalization
    if (sumSquares > 0) {
      const norm = Math.sqrt(sumSquares);
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }

  toJSON() {
    return {
      vocabulary: this.vocabulary,
      idf: Array.from(this.idf),
      featureNames: this.featureNames,
    };
  }

  static fromJSON(data) {
    const vec = new TfidfVectorizer();
    vec.vocabulary = data.vocabulary;
    vec.idf = new Float32Array(data.idf);
    vec.featureNames = data.featureNames;
    return vec;
  }
}
