import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'http';
import path from 'path';
import { registerApiRoutes } from './api/_routes.js';

async function startServer() {
  const app = express();
  const server = createServer(app);

  const PORT = Number(process.env.PORT) || 3000;
  app.use(express.json());

  registerApiRoutes(app, { includeProxy: true });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const isHmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: isHmrDisabled
        ? {
            middlewareMode: true,
            hmr: false,
            watch: null,
          }
        : {
            middlewareMode: true,
            hmr: {
              server,
              path: '/vite-hmr',
            },
          },
      appType: 'spa',
    });

    if (isHmrDisabled) {
      app.get('/@vite/client', async (_req, res, next) => {
        try {
          const transformed = await vite.transformRequest('/@vite/client');
          if (!transformed) return next();
          const code = transformed.code
            .replace(
              'transport.connect(createHMRHandler(handleMessage));',
              '/* HMR disabled */'
            )
            .replace(
              'throw new Error("send was called before connect");',
              'return;'
            )
            .replace(
              'throw new Error("invoke was called before connect");',
              'return null;'
            );
          res.setHeader('Content-Type', 'application/javascript');
          res.setHeader('Cache-Control', 'no-store');
          return res.send(code);
        } catch {
          return next();
        }
      });
    }

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
