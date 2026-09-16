/**
 * CampusNest Moderation Client - Integration Example
 * 
 * You can copy this helper into your main backend (Node.js, Express, Next.js, etc.)
 * to moderate posts, confessions, comments, or profile pictures with one line of code!
 */

export class ModerationClient {
  /**
   * @param {Object} [config]
   * @param {string} [config.baseUrl] - Moderation API URL (default: http://localhost:5001)
   * @param {string} [config.apiKey] - Optional API Key
   */
  constructor(config = {}) {
    this.baseUrl = (config.baseUrl || process.env.MODERATION_SERVICE_URL || 'http://localhost:5001').replace(/\/$/, '');
    this.apiKey = config.apiKey || process.env.MODERATION_API_KEY || '';
  }

  _getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }
    return headers;
  }

  /**
   * Verify text content
   * @param {string} text - The post or comment text
   * @param {string} [context] - Context tag (e.g. 'post', 'confession', 'comment')
   * @returns {Promise<{ isSafe: boolean, reason: string, flaggedCategories: string[], confidence: number, latencyMs: number }>}
   */
  async verifyText(text, context = 'post') {
    const response = await fetch(`${this.baseUrl}/api/v1/moderate/text`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ text, context }),
    });

    if (!response.ok && response.status !== 503) {
      throw new Error(`Moderation request failed (HTTP ${response.status}): ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * Verify image content (by URL or Base64)
   * @param {string} imageUrlOrBase64 
   * @returns {Promise<{ isSafe: boolean, reason: string, category?: string, confidence: number, predictions?: Array }>}
   */
  async verifyImage(imageUrlOrBase64) {
    const isBase64 = imageUrlOrBase64.startsWith('data:image/') || imageUrlOrBase64.length > 500;
    const body = isBase64
      ? { imageBase64: imageUrlOrBase64 }
      : { imageUrl: imageUrlOrBase64 };

    const response = await fetch(`${this.baseUrl}/api/v1/moderate/image`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok && response.status !== 503) {
      throw new Error(`Image moderation request failed (HTTP ${response.status}): ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * Verify combined text and optional image
   * @param {Object} params
   * @param {string} [params.text]
   * @param {string} [params.imageUrl]
   * @param {string} [params.imageBase64]
   * @param {string} [params.context]
   */
  async verifyContent({ text = '', imageUrl = '', imageBase64 = '', context = 'general' }) {
    const response = await fetch(`${this.baseUrl}/api/v1/moderate`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ text, imageUrl, imageBase64, context }),
    });

    if (!response.ok && response.status !== 503) {
      throw new Error(`Moderation request failed (HTTP ${response.status}): ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * Batch moderate an array of items
   * @param {Array<{ id?: string|number, text?: string, imageUrl?: string, imageBase64?: string, context?: string }>} items
   */
  async verifyBatch(items) {
    const response = await fetch(`${this.baseUrl}/api/v1/moderate/batch`, {
      method: 'POST',
      headers: this._getHeaders(),
      body: JSON.stringify({ items }),
    });

    if (!response.ok) {
      throw new Error(`Batch moderation request failed (HTTP ${response.status}): ${await response.text()}`);
    }

    return await response.json();
  }

  /**
   * Check microservice health & engine status
   */
  async checkHealth() {
    const response = await fetch(`${this.baseUrl}/health`);
    return await response.json();
  }
}

// -------------------------------------------------------------
// Quick Demo / Self-test when run directly: node client-example.js
// -------------------------------------------------------------
async function runDemo() {
  console.log('--- Testing ModerationClient SDK ---');
  const client = new ModerationClient({ baseUrl: 'http://localhost:5001' });

  try {
    const health = await client.checkHealth();
    console.log('Health Check:', health);

    // 1. Test Safe Post
    console.log('\n1. Checking Safe Text...');
    const safeRes = await client.verifyText('Hey everyone! Is the central library open till midnight today?');
    console.log('Verdict:', safeRes.isSafe ? ' APPROVED' : ' REJECTED', '| Reason:', safeRes.reason, `(${safeRes.latencyMs}ms)`);

    // 2. Test Toxic Text
    console.log('\n2. Checking Abusive Slur Text...');
    const abuseRes = await client.verifyText('Tu bhosdike chup reh samjha na madarchod');
    console.log('Verdict:', abuseRes.isSafe ? ' APPROVED' : ' REJECTED', '| Reason:', abuseRes.reason, '| Flags:', abuseRes.flaggedCategories);

    // 3. Test Scam Text
    console.log('\n3. Checking Phishing/Scam Text...');
    const scamRes = await client.verifyText('Win 50000 cash prize instantly! Send me your bank account password and OTP');
    console.log('Verdict:', scamRes.isSafe ? ' APPROVED' : ' REJECTED', '| Reason:', scamRes.reason, '| Flags:', scamRes.flaggedCategories);

    // 4. Test Educational Override Text
    console.log('\n4. Checking Educational Context...');
    const eduRes = await client.verifyText('Attended a university workshop on sexual harassment prevention and filing a complaint.');
    console.log('Verdict:', eduRes.isSafe ? ' APPROVED' : ' REJECTED', '| Reason:', eduRes.reason);

    // 5. Test Batch
    console.log('\n5. Checking Batch Moderation...');
    const batchRes = await client.verifyBatch([
      { id: 'item-1', text: 'Good morning professors and classmates!' },
      { id: 'item-2', text: 'I will kill you if I see you near the gate' },
      { id: 'item-3', text: 'Looking for a study partner for CS201 exams.' },
    ]);
    console.log(`Batch processed: ${batchRes.total} items. Approved: ${batchRes.approved}, Flagged: ${batchRes.flagged} in ${batchRes.totalLatencyMs}ms`);

  } catch (err) {
    console.error('Error running demo client:', err.message);
  }
}

if (process.argv[1] && process.argv[1].endsWith('client-example.js')) {
  runDemo();
}

export default ModerationClient;
