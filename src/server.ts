import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import connectDB from './config/db';
import alertRoutes from './routes/alertRoutes';

// ─── Express App ────────────────────────────────────────────────────────────

// ─── Database ───────────────────────────────────────────────────────────────

connectDB();

const app = express();

// ─── CORS Configuration ─────────────────────────────────────────────────────
// Both origins share the exact same allowedOrigins array — this ensures
// the Express middleware and the Socket.IO CORS policy are always in sync.

const allowedOrigins: string[] = [
    process.env.FRONTEND_URL as string,
    'http://localhost:3000',
].filter(Boolean); // remove undefined if FRONTEND_URL is not set

app.use(
    cors({
        origin: allowedOrigins,
        credentials: true,
    })
);

app.use(express.json());

// ─── HTTP Server ────────────────────────────────────────────────────────────

const httpServer = createServer(app);

// ─── Socket.IO Server ───────────────────────────────────────────────────────

export const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins,
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

// ─── Start Listening ────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 5000;

httpServer.listen(PORT, () => {
    console.log(`[Server] Listening on port ${PORT}`);
});
