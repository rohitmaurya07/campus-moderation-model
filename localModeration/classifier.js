//  Multinomial Logistic Regression Classifier with Class Weighting & Softmax Probabilities

export class LogisticRegressionClassifier {
  constructor(options = {}) {
    this.learningRate = options.learningRate || 0.3;
    this.regLambda = options.regLambda || 0.0001; // L2 regularization
    this.epochs = options.epochs || 220;
    this.classes = [];
    this.weights = null;
    this.biases = null;
  }

  softmax(logits) {
    let max = -Infinity;
    for (let i = 0; i < logits.length; i++) {
      if (logits[i] > max) max = logits[i];
    }
    const exps = new Float32Array(logits.length);
    let sum = 0;
    for (let i = 0; i < logits.length; i++) {
      exps[i] = Math.exp(logits[i] - max);
      sum += exps[i];
    }
    for (let i = 0; i < logits.length; i++) {
      exps[i] /= sum;
    }
    return exps;
  }

  fit(X, y, classes) {
    this.classes = classes;
    const numSamples = X.length;
    const numFeatures = X[0].length;
    const numClasses = classes.length;

    this.weights = Array.from({ length: numClasses }, () => new Float32Array(numFeatures));
    this.biases = new Float32Array(numClasses);

    // Compute class frequencies
    const classCounts = new Float32Array(numClasses);
    const classIndices = y.map(label => {
      const idx = this.classes.indexOf(label);
      classCounts[idx]++;
      return idx;
    });

    // Moderate class weights (square root dampened to prevent runaway biases)
    const classWeights = new Float32Array(numClasses);
    for (let c = 0; c < numClasses; c++) {
      const rawWeight = numSamples / (numClasses * Math.max(1, classCounts[c]));
      classWeights[c] = Math.sqrt(rawWeight);
    }

    for (let epoch = 0; epoch < this.epochs; epoch++) {
      const lr = this.learningRate / (1 + 0.002 * epoch);

      for (let i = 0; i < numSamples; i++) {
        const x = X[i];
        const targetIdx = classIndices[i];
        const weightMultiplier = classWeights[targetIdx];

        // Compute logits
        const logits = new Float32Array(numClasses);
        for (let c = 0; c < numClasses; c++) {
          let score = this.biases[c];
          const w = this.weights[c];
          for (let f = 0; f < numFeatures; f++) {
            score += w[f] * x[f];
          }
          logits[c] = score;
        }

        const probs = this.softmax(logits);

        // L2 Regularized gradient step
        for (let c = 0; c < numClasses; c++) {
          const target = c === targetIdx ? 1 : 0;
          const error = (probs[c] - target) * weightMultiplier;

          const w = this.weights[c];
          for (let f = 0; f < numFeatures; f++) {
            if (x[f] !== 0) {
              w[f] -= lr * (error * x[f] + this.regLambda * w[f]);
            }
          }
          // Regularize biases toward 0
          this.biases[c] -= lr * (error + 0.01 * this.biases[c]);
        }
      }
    }

    return this;
  }

  predictProba(x) {
    const numClasses = this.classes.length;
    const numFeatures = x.length;
    const logits = new Float32Array(numClasses);

    for (let c = 0; c < numClasses; c++) {
      let score = this.biases[c];
      const w = this.weights[c];
      for (let f = 0; f < numFeatures; f++) {
        score += w[f] * x[f];
      }
      logits[c] = score;
    }

    const probs = this.softmax(logits);
    const probMap = {};
    for (let c = 0; c < numClasses; c++) {
      probMap[this.classes[c]] = probs[c];
    }
    return probMap;
  }

  predict(x) {
    const probs = this.predictProba(x);
    let bestClass = this.classes[0];
    let maxProb = -1;

    for (const [cls, prob] of Object.entries(probs)) {
      if (prob > maxProb) {
        maxProb = prob;
        bestClass = cls;
      }
    }

    return { label: bestClass, confidence: maxProb, probabilities: probs };
  }

  toJSON() {
    return {
      classes: this.classes,
      weights: this.weights.map(w => Array.from(w)),
      biases: Array.from(this.biases),
    };
  }

  static fromJSON(data) {
    const clf = new LogisticRegressionClassifier();
    clf.classes = data.classes;
    clf.weights = data.weights.map(w => new Float32Array(w));
    clf.biases = new Float32Array(data.biases);
    return clf;
  }
}
