import { Router, Request, Response } from 'express';
import Alert from '../models/Alert';
import { io } from '../server';

const router = Router();

// POST /api/alerts/ingress
// Called by the internet-connected gateway device to offload a mesh alert.
router.post('/ingress', async (req: Request, res: Response) => {
    try {
        const { id, type, message, timestamp, status, latitude, longitude } = req.body;

        // Basic validation — all fields are required per the architecture spec
        if (!id || !type || !message || !timestamp || !status || latitude == null || longitude == null) {
            res.status(400).json({ success: false, error: 'Missing required fields in payload.' });
            return;
        }

        // Persist to MongoDB
        const savedAlert = await Alert.create({
            id,
            type,
            message,
            timestamp,
            status,
            latitude,
            longitude,
        });

        // Broadcast to all connected dashboard clients in real-time
        io.emit('new_mesh_alert', savedAlert);

        // Acknowledge the gateway so the mobile app can mark the payload as delivered
        res.status(200).json({ success: true, message: 'Alert received and broadcast.', alert: savedAlert });
    } catch (error: unknown) {
        // Duplicate key error (code 11000) means this alert was already received via another mesh path
        if (typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000) {
            res.status(409).json({ success: false, error: 'Duplicate alert — already ingested.' });
            return;
        }
        console.error('[Ingress] Error saving alert:', error);
        res.status(500).json({ success: false, error: 'Internal server error.' });
    }
});

export default router;
