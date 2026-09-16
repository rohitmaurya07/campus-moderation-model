/**
 * CampusNest Local Moderation Model - Training & Evaluation Pipeline
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeText } from './normalizer.js';
import { TfidfVectorizer } from './vectorizer.js';
import { LogisticRegressionClassifier } from './classifier.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const trainModel = () => {
  const datasetPath = path.join(__dirname, 'dataset.json');
  const rawData = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));

  console.log(`Loaded ${rawData.length} labeled samples from dataset.json.`);

  // Normalized samples
  const samples = rawData.map(item => ({
    text: normalizeText(item.text),
    label: item.label,
  }));

  // Unique categories
  const categories = Array.from(new Set(samples.map(s => s.label)));

  // Stratified 80/20 train/validation split
  const trainData = [];
  const valData = [];

  for (const cat of categories) {
    const catSamples = samples.filter(s => s.label === cat);
    // Shuffle deterministic
    catSamples.sort((a, b) => a.text.localeCompare(b.text));
    const splitIndex = Math.max(1, Math.floor(catSamples.length * 0.8));

    trainData.push(...catSamples.slice(0, splitIndex));
    valData.push(...catSamples.slice(splitIndex));
  }

  console.log(`Training samples: ${trainData.length}, Validation samples: ${valData.length}`);

  // 1. Fit Vectorizer
  const vectorizer = new TfidfVectorizer({ minDocFreq: 1, maxFeatures: 2500 });
  vectorizer.fit(trainData.map(d => d.text));

  const X_train = trainData.map(d => vectorizer.transform(d.text));
  const y_train = trainData.map(d => d.label);

  const X_val = valData.map(d => vectorizer.transform(d.text));
  const y_val = valData.map(d => d.label);

  // 2. Train Classifier
  const classifier = new LogisticRegressionClassifier({
    learningRate: 0.25,
    regLambda: 0.0001,
    epochs: 180,
  });

  classifier.fit(X_train, y_train, categories);

  // 3. Evaluation on Validation Set
  let correct = 0;
  const confusionMatrix = {};
  const metrics = {};

  for (const cat of categories) {
    confusionMatrix[cat] = {};
    for (const c2 of categories) confusionMatrix[cat][c2] = 0;
    metrics[cat] = { tp: 0, fp: 0, fn: 0, tn: 0 };
  }

  for (let i = 0; i < valData.length; i++) {
    const pred = classifier.predict(X_val[i]);
    const actual = y_val[i];
    const predicted = pred.label;

    confusionMatrix[actual][predicted]++;

    if (predicted === actual) {
      correct++;
    }

    for (const cat of categories) {
      if (predicted === cat && actual === cat) metrics[cat].tp++;
      else if (predicted === cat && actual !== cat) metrics[cat].fp++;
      else if (predicted !== cat && actual === cat) metrics[cat].fn++;
      else metrics[cat].tn++;
    }
  }

  const accuracy = (correct / valData.length) * 100;

  console.log("\n========================================================");
  console.log("            LOCAL MODEL VALIDATION METRICS              ");
  console.log("========================================================");
  console.log(`Overall Accuracy: ${accuracy.toFixed(2)}% (${correct}/${valData.length})`);

  console.log("\nPer-Category Metrics:");
  console.log("----------------------------------------------------------------------------------");
  console.log("Category                  | Precision | Recall    | F1-Score  | Support");
  console.log("----------------------------------------------------------------------------------");

  let macroP = 0, macroR = 0, macroF1 = 0;

  for (const cat of categories) {
    const m = metrics[cat];
    const p = m.tp + m.fp > 0 ? m.tp / (m.tp + m.fp) : 0;
    const r = m.tp + m.fn > 0 ? m.tp / (m.tp + m.fn) : 0;
    const f1 = p + r > 0 ? (2 * p * r) / (p + r) : 0;
    const support = m.tp + m.fn;

    macroP += p;
    macroR += r;
    macroF1 += f1;

    const catPad = cat.padEnd(25, " ");
    console.log(`${catPad} | ${(p * 100).toFixed(1)}%     | ${(r * 100).toFixed(1)}%   | ${(f1 * 100).toFixed(1)}%    | ${support}`);
  }

  const numCats = categories.length;
  macroP = (macroP / numCats) * 100;
  macroR = (macroR / numCats) * 100;
  macroF1 = (macroF1 / numCats) * 100;

  console.log("----------------------------------------------------------------------------------");
  console.log(`Macro Average             | ${macroP.toFixed(1)}%     | ${macroR.toFixed(1)}%   | ${macroF1.toFixed(1)}%    | ${valData.length}`);
  console.log("==================================================================================");

  console.log("\nConfusion Matrix (Rows: Actual, Columns: Predicted):");
  console.log(confusionMatrix);

  // 4. Save Model Artifact
  const modelArtifact = {
    version: "1.0.0",
    trainedAt: new Date().toISOString(),
    categories,
    vectorizer: vectorizer.toJSON(),
    classifier: classifier.toJSON(),
    evaluation: {
      accuracy: accuracy.toFixed(2),
      macroPrecision: macroP.toFixed(2),
      macroRecall: macroR.toFixed(2),
      macroF1: macroF1.toFixed(2),
    }
  };

  const modelPath = path.join(__dirname, 'model.json');
  fs.writeFileSync(modelPath, JSON.stringify(modelArtifact, null, 2));
  console.log(`\nTrained model artifact successfully saved to ${modelPath}`);

  return modelArtifact;
};

// If run directly: node train.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  trainModel();
}
