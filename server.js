/**
 * Standalone Content Moderation REST API Microservice
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  moderateContent,
  moderateTextOnly,
  moderateImageOnly,
  moderateBatch,
  getSupportedCategories,
} from './moderation.service.js';
import { initLocalModeration } from './localModeration/engine.js';
import { trainModel } from './localModeration/train.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;
const API_KEY = process.env.API_KEY || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const MAX_BODY_SIZE = process.env.MAX_BODY_SIZE || '25mb';
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '600', 10);

// Initialize Moderation Engine on startup
const isEngineReady = initLocalModeration();

// ==========================================
// Security & Middleware Configuration
// ==========================================

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map(s => s.trim()),
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
}));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(':method :url :status :res[content-length] - :response-time ms'));
}

app.use(express.json({ limit: MAX_BODY_SIZE }));
app.use(express.urlencoded({ extended: true, limit: MAX_BODY_SIZE }));

// Multer memory storage for direct image uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB image limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WebP, GIF, etc.) are allowed!'), false);
    }
  },
});

// Rate Limiter
const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    message: 'Rate limit exceeded. Please try again later.',
  },
});
app.use('/api/', limiter);

// Optional API Key Authentication Middleware
const authenticateApiKey = (req, res, next) => {
  if (!API_KEY) {
    // If no API_KEY is set in environment, allow open access
    return next();
  }

  const clientKey = req.headers['x-api-key'] || (
    req.headers['authorization'] && req.headers['authorization'].startsWith('Bearer ')
      ? req.headers['authorization'].slice(7)
      : null
  );

  if (!clientKey || clientKey !== API_KEY) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing API key. Provide x-api-key header or Bearer token.',
    });
  }

  next();
};

// Routes
/**
 * Root Index & API Documentation
 */
app.get('/', (req, res) => {
  res.json({
    service: 'CampusNest Content Moderation Microservice',
    status: 'running',
    version: '1.0.0',
    documentation: {
      health: 'GET /health',
      categories: 'GET /api/v1/categories',
      unifiedModeration: 'POST /api/v1/moderate',
      textModeration: 'POST /api/v1/moderate/text',
      imageModeration: 'POST /api/v1/moderate/image',
      batchModeration: 'POST /api/v1/moderate/batch',
      trainModel: 'POST /api/v1/train',
    },
  });
});

// Health Check & Model Info
app.get('/health', (req, res) => {
  let modelMetadata = null;
  try {
    const modelPath = path.join(__dirname, 'localModeration', 'model.json');
    if (fs.existsSync(modelPath)) {
      const raw = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
      modelMetadata = {
        version: raw.version,
        trainedAt: raw.trainedAt,
        categories: raw.categories,
        evaluation: raw.evaluation,
      };
    }
  } catch (e) {
    modelMetadata = { error: e.message };
  }

  res.json({
    status: 'healthy',
    engineReady: isEngineReady,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    memoryUsageMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    model: modelMetadata,
  });
});

/**
 * List supported moderation categories
 */
app.get('/api/v1/categories', (req, res) => {
  res.json({
    success: true,
    categories: getSupportedCategories(),
  });
});

/**
 * Unified Content Moderation Endpoint (Text + Optional Image URL / Base64 / File)
 * Supports JSON: { text, imageUrl, imageBase64, context }
 * Supports Multipart Form: text, context, image file
 */
app.post(
  '/api/v1/moderate',
  authenticateApiKey,
  upload.single('image'),
  async (req, res) => {
    try {
      const text = req.body.text || '';
      const imageUrl = req.body.imageUrl || req.body.url || '';
      const imageBase64 = req.body.imageBase64 || req.body.image_base64 || '';
      const context = req.body.context || 'general';
      const imageBuffer = req.file ? req.file.buffer : null;

      if (!text && !imageUrl && !imageBase64 && !imageBuffer) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Please provide text, imageUrl, imageBase64, or attach an image file.',
        });
      }

      const result = await moderateContent({
        text,
        imageUrl,
        imageBase64,
        imageBuffer,
        context,
      });

      const statusCode = result.moderationFailed ? 503 : 200;
      return res.status(statusCode).json(result);
    } catch (err) {
      console.error('[API /api/v1/moderate] Error:', err);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: err.message,
      });
    }
  }
);

/**
 * Text Moderation Endpoint (Ultra fast < 5ms CPU)
 * Body: { text: string, context?: string }
 */
app.post('/api/v1/moderate/text', authenticateApiKey, async (req, res) => {
  try {
    const { text, context } = req.body;
    if (typeof text !== 'string') {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'The "text" field is required and must be a string.',
      });
    }

    const result = await moderateTextOnly(text);
    const statusCode = result.moderationFailed ? 503 : 200;

    return res.status(statusCode).json({
      ...result,
      context: context || 'text',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API /api/v1/moderate/text] Error:', err);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: err.message,
    });
  }
});

/**
 * Image Moderation Endpoint (NSFW / Explicit Content)
 * Supports JSON: { imageUrl: string, imageBase64?: string }
 * Supports Multipart Form: attached file in 'image' or 'file'
 */
app.post(
  '/api/v1/moderate/image',
  authenticateApiKey,
  upload.single('image'),
  async (req, res) => {
    try {
      const imageUrl = req.body.imageUrl || req.body.url || '';
      const imageBase64 = req.body.imageBase64 || req.body.image_base64 || '';
      const imageBuffer = req.file ? req.file.buffer : null;
      const imageInput = imageBuffer || imageBase64 || imageUrl;

      if (!imageInput) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Please provide imageUrl, imageBase64, or attach an image file.',
        });
      }

      const result = await moderateImageOnly(imageInput);
      const statusCode = result.moderationFailed ? 503 : 200;

      return res.status(statusCode).json({
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[API /api/v1/moderate/image] Error:', err);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: err.message,
      });
    }
  }
);

/**
 * Batch Moderation Endpoint
 * Body: { items: [ { id?: string|number, text?: string, imageUrl?: string, imageBase64?: string, context?: string } ] }
 */
app.post('/api/v1/moderate/batch', authenticateApiKey, async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'The "items" field must be a non-empty array of objects.',
      });
    }

    if (items.length > 100) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Maximum batch size is 100 items per request.',
      });
    }

    const start = performance.now();
    const results = await moderateBatch(items);
    const totalLatencyMs = Math.round(performance.now() - start);

    const flaggedCount = results.filter(r => !r.isSafe).length;

    return res.status(200).json({
      success: true,
      total: items.length,
      flagged: flaggedCount,
      approved: items.length - flaggedCount,
      totalLatencyMs,
      results,
    });
  } catch (err) {
    console.error('[API /api/v1/moderate/batch] Error:', err);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: err.message,
    });
  }
});

/**
 * Retrain Model Endpoint (Admin / Development)
 */
app.post('/api/v1/train', authenticateApiKey, async (req, res) => {
  try {
    console.log('[API /api/v1/train] Retraining requested...');
    const result = trainModel();
    initLocalModeration(); // reload updated model in memory
    return res.status(200).json({
      success: true,
      message: 'Model retrained and reloaded into memory successfully.',
      evaluation: result.evaluation,
      trainedAt: result.trainedAt,
    });
  } catch (err) {
    console.error('[API /api/v1/train] Training error:', err);
    return res.status(500).json({
      error: 'Training Failed',
      message: err.message,
    });
  }
});

// ==========================================
// 404 & Global Error Handling
// ==========================================

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Endpoint ${req.method} ${req.url} does not exist. Refer to GET / for API documentation.`,
  });
});

app.use((err, req, res, next) => {
  console.error('[SERVER GLOBAL ERROR]', err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'File Upload Error', message: err.message });
  }
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message || 'An unexpected error occurred.',
  });
});

// Start Server
if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(PORT, "0.0.0.0",() => {
    console.log(` CampusNest Moderation Microservice`);
    console.log(` Server running on http://localhost:${PORT}`);
    console.log(` Health Check:       http://localhost:${PORT}/health`);
    console.log(` API Documentation:  http://localhost:${PORT}/`);
    console.log(` Engine State:       ${isEngineReady ? 'INITIALIZED (Offline CPU Mode)' : 'INITIALIZATION FAILED'}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[SERVER] Gracefully shutting down...');
    server.close(() => {
      console.log('[SERVER] Closed all active connections.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export default app;
