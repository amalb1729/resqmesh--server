import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import connectDB from './config/db';
import alertRoutes from './routes/alertRoutes';
import redditAlertRoutes from './routes/redditAlertRoutes';
import { startRedditPoller } from './services/redditService';

// ─── Express App ────────────────────────────────────────────────────────────

// ─── Database ───────────────────────────────────────────────────────────────

connectDB().then(() => {
    // Start the Reddit poller only after DB is ready so saves don't fail
    startRedditPoller(io);
});

const app = express();

// ─── CORS Configuration ─────────────────────────────────────────────────────
// TODO [SECURITY WALL]: Replace `origin: '*'` below with a strict allowedOrigins
// whitelist before deploying to production. Example:
//
//   const allowedOrigins = [process.env.FRONTEND_URL, 'http://localhost:3000'].filter(Boolean);
//   app.use(cors({ origin: allowedOrigins, credentials: true }));
//
// Same applies to the Socket.IO cors config further below.

app.use(cors({ origin: '*' }));

app.use(express.json());

// ─── HTTP Server ────────────────────────────────────────────────────────────

const httpServer = createServer(app);

// ─── Socket.IO Server ───────────────────────────────────────────────────────

// TODO [SECURITY WALL]: Replace `origin: '*'` with the allowedOrigins whitelist (see above).
export const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected    → ${socket.id}`);

    socket.on('disconnect', () => {
        console.log(`[Socket.IO] Client disconnected ← ${socket.id}`);
    });
});

// ─── Routes ─────────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
    res.json({ status: 'ResQMesh server is running 🚀' });
});

app.use('/api/alerts', alertRoutes);
app.use('/api/reddit-alerts', redditAlertRoutes);

// ─── Start Listening ────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 5000;

httpServer.listen(PORT, () => {
    console.log(`[Server] Listening on port ${PORT}`);
});
