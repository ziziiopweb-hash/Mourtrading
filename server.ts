import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { clerkMiddleware } from '@clerk/express';
import { WebSocketServer } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  buildServiceReadiness,
  ENV,
  getPublicClerkConfig,
  getPublicSupabaseConfig,
  isClerkConfigured,
  isSupabaseServiceRoleConfigured,
  validateEnvironmentConfig,
} from './server/config/env.ts';
import { binanceMarket } from './server/services/binanceMarket.ts';
import { monitorEngine } from './server/services/monitorEngine.ts';
import { testSupabaseDatabaseConnection } from './server/services/supabase.ts';
import marketRouter from './server/routes/market.ts';
import authRouter from './server/routes/auth.ts';
import aiRouter from './server/routes/ai.ts';
import userRouter from './server/routes/user.ts';
import signalsRouter from './server/routes/signals.ts';
import adminRouter from './server/routes/admin.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function bootstrap() {
  const envCheck = validateEnvironmentConfig();
  const app = express();
  app.set('trust proxy', 1);

  // Relax cross-origin policies so AI Studio iframe preview and external Clerk/CDN scripts never get blocked
  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));

  // Mount Clerk Express middleware ONLY on /api/* (and never on HTML/Vite document requests)
  // so Clerk dev-browser handshake never issues 307 redirects on iframe page loads.
  if (isClerkConfigured()) {
    const clerkApiAuth = clerkMiddleware({
      publishableKey: ENV.CLERK_PUBLISHABLE_KEY,
      secretKey: ENV.CLERK_SECRET_KEY,
    });
    app.use('/api', (req, res, next) => {
      const dest = req.headers['sec-fetch-dest'];
      if (dest === 'document' || dest === 'iframe') {
        next();
        return;
      }
      clerkApiAuth(req, res, next);
    });
  }

  // Public health & client config (never exposes secrets)
  app.get('/api/health', async (req, res) => {
    const force = req.query.refresh === '1';
    const marketStatus = binanceMarket.getStatus();
    const supabaseHealth = isSupabaseServiceRoleConfigured()
      ? await testSupabaseDatabaseConnection(force)
      : {
          configured: true,
          serviceRoleConfigured: false,
          connected: true,
          schemaReady: true,
        };
    const readiness = buildServiceReadiness(marketStatus, supabaseHealth);
    res.json({
      ok: true,
      service: 'MourTrading',
      timestamp: new Date().toISOString(),
      readiness,
      clerkConfig: getPublicClerkConfig(),
      supabaseConfig: getPublicSupabaseConfig(),
    });
  });

  app.use('/api/market', marketRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/user', userRouter);
  app.use('/api/signals', signalsRouter);
  app.use('/api/admin', adminRouter);

  // API 404 handler
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  if (ENV.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname);
    const clientDist = path.join(distDir, '..', 'dist');
    const resolvedDist = distDir.endsWith('dist') ? distDir : clientDist;
    app.use(express.static(resolvedDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(resolvedDist, 'index.html'));
    });
  }

  const server = http.createServer(app);

  // WebSocket server broadcasting real-time Binance Spot ticks to browser clients
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const urlPath = request.url?.split('?')[0];
    if (urlPath === '/ws/market') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else if (ENV.NODE_ENV === 'production') {
      socket.destroy();
    }
  });

  wss.on('connection', (ws) => {
    ws.send(
      JSON.stringify({
        type: 'status',
        status: binanceMarket.getStatus(),
      }),
    );
  });

  // Throttle WS broadcasts to max every 800ms for smooth mobile performance
  let pendingUpdates = new Map<string, { symbol: string; price: number; high24h: number; low24h: number }>();
  binanceMarket.onPriceTick((updates) => {
    for (const u of updates) {
      pendingUpdates.set(u.symbol, u);
    }
  });

  setInterval(() => {
    if (pendingUpdates.size === 0 || wss.clients.size === 0) {
      pendingUpdates.clear();
      return;
    }
    const batch = Array.from(pendingUpdates.values());
    pendingUpdates = new Map();
    const payload = JSON.stringify({
      type: 'tickers',
      ts: Date.now(),
      data: batch,
    });
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
  }, 800);

  binanceMarket.start();
  monitorEngine.start();

  server.listen(ENV.PORT, '0.0.0.0', () => {
    console.log(
      `MourTrading server listening on http://0.0.0.0:${ENV.PORT} (Clerk: ${envCheck.clerkConfigured ? 'configured' : 'awaiting key'}, Persistence: ${envCheck.supabaseServerConfigured ? 'Supabase (with local fallback)' : 'local store (.mourtrading-data/store.json)'}, Gemini: ${envCheck.geminiConfigured ? 'configured' : 'awaiting key'})`,
    );
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start MourTrading server:', err);
  process.exit(1);
});
