import { Router, Request, Response } from 'express';
import RedditAlert from '../models/RedditAlert';

const router = Router();

/**
 * GET /api/reddit-alerts
 * Returns the 50 most recent Reddit alerts from DB.
 * Called by the dashboard on Socket.IO connect to hydrate historical posts
 * (same pattern as GET /api/alerts for mesh alerts).
 */
router.get('/', async (_req: Request, res: Response) => {
    try {
        const alerts = await RedditAlert.find()
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        // Map to the LiveAlert shape the frontend expects
        const liveAlerts = alerts.map(a => ({
            id:            `REDDIT-${a.redditId}`,
            urgency:       a.urgency,
            source:        'social' as const,
            sourceDetails: a.sourceDetails,
            title:         a.title,
            time:          a.time,
            location:      a.location,
            lat:           a.lat,
            lng:           a.lng,
            need:          a.need,
            fullMessage:   a.fullMessage,
            userId:        a.userId,
            alertType:     a.alertType,
            message:       a.message,
            coordinates:   a.coordinates,
            createdAt:     a.createdAt,
        }));

        res.status(200).json({ success: true, alerts: liveAlerts });
    } catch (error) {
        console.error('[RedditAlerts] Error fetching from DB:', error);
        res.status(500).json({ success: false, error: 'Internal server error.' });
    }
});

export default router;
