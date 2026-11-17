import express from 'express';
import { registerApiRoutes } from './_routes.js';

const app = express();

// Guard against double-parsing when Vercel @vercel/node pre-parses JSON body
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.body && typeof req.body === 'object') {
    return next();
  }
  return express.json()(req, res, next);
});

registerApiRoutes(app, { includeProxy: true });

export default app;
