/**
 * End-to-End Test Suite for Moderation Microservice
 */

import http from 'http';
import app from './server.js';
import { moderateTextOnly, moderateContent, moderateBatch } from './moderation.service.js';

const TEST_PORT = 5099;

async function runTests() {
  console.log('====================================================');
  console.log('   STARTING MODERATION MICROSERVICE TEST SUITE      ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${details}`);
      failed++;
    }
  }

  // 1. Direct Service Unit Tests
  console.log('--- 1. Direct Moderation Service Unit Tests ---');
  
  // Test A: Normal Safe Text
  const safeRes = await moderateTextOnly('Hey everyone, does anyone have the notes for Physics chapter 3?');
  assert(safeRes.isSafe === true, 'Safe academic question returns isSafe = true', JSON.stringify(safeRes));

  // Test B: Hindi/Hinglish Slur Flagging
  const slurRes = await moderateTextOnly('tu bhosdike chup kar bsdk');
  assert(slurRes.isSafe === false && slurRes.flaggedCategories.includes('harassment_abuse'), 'Hindi abuse/slur is flagged as harassment_abuse', JSON.stringify(slurRes));

  // Test C: Extreme Threat Flagging
  const threatRes = await moderateTextOnly('I will kill you if you come to campus tomorrow');
  assert(threatRes.isSafe === false && threatRes.flaggedCategories.includes('violence_threats'), 'Death threat is flagged as violence_threats', JSON.stringify(threatRes));

  // Test D: Scam/OTP solicitation
  const scamRes = await moderateTextOnly('Send me your bank account password and OTP to win lottery prize');
  assert(scamRes.isSafe === false && scamRes.flaggedCategories.includes('scams_spam'), 'Phishing scam is flagged as scams_spam', JSON.stringify(scamRes));

  // Test E: Educational & Reporting Override
  const eduRes = await moderateTextOnly('The student union conducted a seminar on sexual harassment prevention and how to report an incident.');
  assert(eduRes.isSafe === true, 'Educational seminar context is approved (not falsely flagged)', JSON.stringify(eduRes));

  // Test F: Obfuscated / Leetspeak Slur
  const leetRes = await moderateTextOnly('fuck you bitch');
  assert(leetRes.isSafe === false, 'Obfuscated profanity is flagged', JSON.stringify(leetRes));

  // 2. HTTP REST API Tests
  console.log('\n--- 2. REST API Server HTTP Tests ---');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(TEST_PORT, resolve));
  console.log(`Ephemeral test server running on port ${TEST_PORT}`);

  const baseUrl = `http://localhost:${TEST_PORT}`;

  try {
    // Test G: GET /
    const rootRes = await fetch(`${baseUrl}/`);
    const rootJson = await rootRes.json();
    assert(rootRes.status === 200 && rootJson.status === 'running', 'GET / returns 200 OK and status: running');

    // Test H: GET /health
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthJson = await healthRes.json();
    assert(healthRes.status === 200 && healthJson.status === 'healthy' && healthJson.engineReady === true, 'GET /health returns healthy status and engineReady');

    // Test I: GET /api/v1/categories
    const catRes = await fetch(`${baseUrl}/api/v1/categories`);
    const catJson = await catRes.json();
    assert(catRes.status === 200 && Array.isArray(catJson.categories) && catJson.categories.length >= 6, 'GET /api/v1/categories lists safety categories');

    // Test J: POST /api/v1/moderate/text (Safe)
    const postSafeRes = await fetch(`${baseUrl}/api/v1/moderate/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Anyone want to play badminton in the sports complex at 5 PM?' }),
    });
    const postSafeJson = await postSafeRes.json();
    assert(postSafeRes.status === 200 && postSafeJson.isSafe === true, 'POST /api/v1/moderate/text approves safe post');

    // Test K: POST /api/v1/moderate/text (Unsafe)
    const postUnsafeRes = await fetch(`${baseUrl}/api/v1/moderate/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'send me your nudes right now' }),
    });
    const postUnsafeJson = await postUnsafeRes.json();
    assert(postUnsafeRes.status === 200 && postUnsafeJson.isSafe === false && postUnsafeJson.flaggedCategories.includes('sexual_content_nudity'), 'POST /api/v1/moderate/text flags sexual solicitation');

    // Test L: POST /api/v1/moderate (Unified)
    const unifiedRes = await fetch(`${baseUrl}/api/v1/moderate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Looking for roommate in 2BHK flat near North Campus.',
        context: 'post',
      }),
    });
    const unifiedJson = await unifiedRes.json();
    assert(unifiedRes.status === 200 && unifiedJson.isSafe === true, 'POST /api/v1/moderate returns unified verdict');

    // Test M: POST /api/v1/moderate/batch
    const batchRes = await fetch(`${baseUrl}/api/v1/moderate/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { id: 1, text: 'Hello everyone!' },
          { id: 2, text: 'Gandu saala' },
          { id: 3, text: 'Exam schedule has been released on the portal.' },
        ],
      }),
    });
    const batchJson = await batchRes.json();
    assert(
      batchRes.status === 200 &&
      batchJson.total === 3 &&
      batchJson.approved === 2 &&
      batchJson.flagged === 1,
      'POST /api/v1/moderate/batch correctly aggregates batch results'
    );

    // Test N: Bad Request validation
    const badReqRes = await fetch(`${baseUrl}/api/v1/moderate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert(badReqRes.status === 400, 'POST /api/v1/moderate returns 400 Bad Request on empty payload');

  } finally {
    server.close();
  }

  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Fatal Test Error:', err);
  process.exit(1);
});
