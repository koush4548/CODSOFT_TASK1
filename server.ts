import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { apiRouter } from './server/routes.js';
import { db } from './server/db.js';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // CORS & Security headers for cross-origin preview / iframe resilience
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  });

  // Global middlewares - restrict JSON parsing to 50MB and keep stream routes unblocked
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // API Routes FIRST
  app.use('/api', apiRouter);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'healthy',
      service: 'CloudVault S3 Engine (CODSOFT_TASK1)',
      timestamp: new Date().toISOString(),
    });
  });

  // Dedicated 404 handler for unmatched /api requests (prevents fallback to Vite SPA)
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API endpoint ${req.method} ${req.originalUrl} not found` });
  });

  // API Error handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith('/api')) {
      console.error('[API Catch-all Error]', err);
      const statusCode = err.status || 500;
      return res.status(statusCode).json({
        error: err.message || 'Internal Server Error',
      });
    }
    next(err);
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Ensure healthy storage state and seed verified sample files on startup
  try {
    await db.selfHealAndSeed();
  } catch (err) {
    console.error('[Storage Init] Error running self-heal and seed:', err);
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CloudVault] Server running at http://0.0.0.0:${PORT}`);
  });

  // Prevent socket/connection timeouts during multi-gigabyte or slow network uploads
  server.keepAliveTimeout = 120000;
  server.headersTimeout = 125000;
  server.timeout = 0;
  server.requestTimeout = 0;
}

startServer().catch((err) => {
  console.error('[CloudVault] Fatal error starting server:', err);
  process.exit(1);
});
