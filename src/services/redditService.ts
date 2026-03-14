/**
 * redditService.ts
 *
 * Runs entirely on the Node.js backend.
 * Polls r/ResQMesh, geocodes new posts via Nominatim,
 * persists them to MongoDB, and broadcasts via Socket.IO.
 *
 * Called once from server.ts after DB is ready.
 */

import { Server } from 'socket.io';
import RedditAlert from '../models/RedditAlert';

// ── Config ────────────────────────────────────────────────────────────────────
const SUBREDDIT       = 'ResQMesh';
const REDDIT_BASE     = `https://www.reddit.com/r/${SUBREDDIT}/new.json?limit=25`;
const POLL_INTERVAL   = 10_000; // 10 seconds — fast enough for near-instant delivery
const NOMINATIM_URL   = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT      = 'ResQMesh/1.0 (disaster-response-dashboard; server-poller)';
const DEFAULT_COORDS  = { lat: 20.5937, lng: 78.9629 };

// Tracks the Reddit fullname (e.g. "t3_1rtplch") of the most recently seen post.
// On subsequent polls we pass ?before=<name> so Reddit only returns newer posts.
let latestPostName: string | null = null;

// ── In-process geocode cache ─────────────────────────────────────────────────
const geocodeCache = new Map<string, { lat: number; lng: number }>();

async function geocode(query: string): Promise<{ lat: number; lng: number }> {
    const key = query.toLowerCase().trim();
    if (geocodeCache.has(key)) return geocodeCache.get(key)!;

    try {
        const url = `${NOMINATIM_URL}?q=${encodeURIComponent(key)}&format=json&limit=1&addressdetails=0`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5_000);
        const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' },
            signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) {
            const data: Array<{ lat: string; lon: string }> = await res.json();
            if (data.length) {
                const coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
                geocodeCache.set(key, coords);
                return coords;
            }
        }
    } catch (err) {
        console.warn(`[RedditService] Geocode failed for "${query}":`, err);
    }

    geocodeCache.set(key, DEFAULT_COORDS);
    return DEFAULT_COORDS;
}

// ── NLP keyword arrays (used by resolveUrgencyAndType below) ─────────────────
const criticalKw = [
    'trapped','collapse','collapsed','sos','mayday','explosion',
    'gas leak','casualties','critical','urgent rescue','people died',
    'power outage','grid failure','missing','buried','fire spreading',
];
const rescueKw = [
    'stranded','stuck','flooded','flood','need rescue','cut off',
    'no electricity','road blocked','shelter needed','displaced',
    'evacuating','injured','ambulance','rescue','help needed',
];
const alertTypeKw: Record<string, string[]> = {
    Fire:    ['fire','smoke','burning','gas leak','explosion','blaze'],
    Flood:   ['flood','flooding','water rising','submerged','drainage','rain'],
    Medical: ['injured','medical','hospital','ambulance','trauma','unconscious','bleeding'],
    Rescue:  ['trapped','stranded','rescue','collapsed','buried','missing'],
};

// ── Flair → AlertCategory canonical mapping ───────────────────────────────────
// These must match the flairs set up on r/ResQMesh exactly (case-insensitive).
const FLAIR_TO_CATEGORY: Record<string, string> = {
    'medical':         'MEDICAL',
    'rescue':          'RESCUE',
    'food':            'FOOD',
    'trapped':         'TRAPPED',
    'general':         'GENERAL',
    'other':           'OTHER',
    'critical':        'MEDICAL',   // r/ResQMesh uses 'Critical' flair
    'food & water':    'FOOD',
    'food and water':  'FOOD',
};

// Human-readable label for each AlertCategory (mirrors alertConfig.ts on frontend)
const CATEGORY_LABEL: Record<string, string> = {
    MEDICAL: 'Medical',
    RESCUE:  'Rescue',
    FOOD:    'Food & Water',
    TRAPPED: 'Trapped',
    GENERAL: 'General',
    OTHER:   'Other',
};

// ── Resolve urgency: flair wins, NLP is the fallback ─────────────────────────
function resolveUrgencyAndType(
    text: string,
    flair: string
): { urgency: string; alertType: string; sourcedFromFlair: boolean } {
    const flairKey = flair.trim().toLowerCase();
    if (flairKey && FLAIR_TO_CATEGORY[flairKey]) {
        const urgency = FLAIR_TO_CATEGORY[flairKey];
        return { urgency, alertType: CATEGORY_LABEL[urgency] ?? flair, sourcedFromFlair: true };
    }

    const l = text.toLowerCase();
    let urgency = 'GENERAL';
    if (criticalKw.some(k => l.includes(k))) urgency = 'MEDICAL';
    else if (rescueKw.some(k => l.includes(k))) urgency = 'RESCUE';

    let alertType = 'Rescue';
    for (const [type, kws] of Object.entries(alertTypeKw)) {
        if (kws.some(k => l.includes(k))) { alertType = type; break; }
    }

    return { urgency, alertType, sourcedFromFlair: false };
}


function extractLocationName(text: string): string | null {
    const m1 = text.match(/location\s*[:\-]\s*([^\n,\.]{2,60})/i);
    if (m1) return m1[1].trim();
    const m2 = text.match(/(?:in|at|near|from)\s+([A-Z][a-zA-Z\s]{2,40})(?:[,\.\n]|$)/);
    if (m2) return m2[1].trim();
    const m3 = text.match(/\(([A-Z][a-zA-Z\s]{2,30})\)/);
    if (m3) return m3[1].trim();
    return null;
}

function calcConfidence(text: string, score: number): number {
    const l = text.toLowerCase();
    let c = 40;
    c += Math.min([...criticalKw, ...rescueKw].filter(k => l.includes(k)).length * 10, 40);
    if (score > 10)  c += 5;
    if (score > 50)  c += 5;
    if (score > 100) c += 5;
    return Math.min(c, 97);
}

function timeAgo(utcSeconds: number): string {
    const min = Math.floor((Date.now() - utcSeconds * 1000) / 60_000);
    if (min < 1)  return 'just now';
    if (min < 60) return `${min} min ago`;
    return `${Math.floor(min / 60)} hr ago`;
}

// ── Reddit post type ──────────────────────────────────────────────────────────
interface RedditPost {
    id: string;
    name: string;
    title: string;
    selftext: string;
    author: string;
    created_utc: number;
    score: number;
    link_flair_text: string | null;
}

// ── Plain data shape (no Mongoose Document fields needed for insert) ──────────
interface RedditAlertData {
    redditId: string; urgency: string; sourceDetails: string; title: string;
    time: string; location: string; lat: number; lng: number; need: string;
    fullMessage: string; userId: string; alertType: string; message: string;
    coordinates: string; createdAt: number;
}

// ── Convert a Reddit post → RedditAlertData ───────────────────────────────────
async function postToAlert(post: RedditPost): Promise<RedditAlertData> {
    const fullText = `${post.title} ${post.selftext}`;
    const flair    = post.link_flair_text ?? '';

    const { urgency, alertType, sourcedFromFlair } = resolveUrgencyAndType(fullText, flair);

    // sourceDetails: show flair origin or NLP confidence
    const confidence    = calcConfidence(fullText, post.score);
    const sourceDetails = sourcedFromFlair
        ? `Flair: ${flair}`
        : `NLP: ${confidence}%`;

    const locationName    = extractLocationName(fullText);
    const { lat, lng }    = locationName ? await geocode(locationName) : DEFAULT_COORDS;
    const displayLocation = locationName ?? 'Unknown Location';
    const coords = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`;

    return {
        redditId:      post.id,
        urgency,
        sourceDetails,
        // Strip any manual [CATEGORY] prefix from title, and also the flair text if repeated
        title:         post.title.replace(/^\[.*?\]\s*/i, '').trim(),
        time:          timeAgo(post.created_utc),
        location:      displayLocation,
        lat,
        lng,
        need:          alertType,
        fullMessage:   post.selftext || post.title,
        userId:        `u/${post.author}`,
        alertType,
        message:       (post.selftext || post.title).slice(0, 200),
        coordinates:   coords,
        createdAt:     post.created_utc * 1000,
    };
}

// ── Fetch Reddit + persist new posts ─────────────────────────────────────────
async function pollAndPersist(io: Server): Promise<void> {
    try {
        // After the first poll, only ask Reddit for posts newer than our last
        // known one via `before=` — keeps each request tiny and fast.
        const url = latestPostName
            ? `${REDDIT_BASE}&before=${encodeURIComponent(latestPostName)}`
            : REDDIT_BASE;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) { console.warn(`[RedditService] Reddit returned ${res.status}`); return; }

        const json = await res.json();
        const posts: RedditPost[] = (json?.data?.children ?? []).map(
            (c: { data: RedditPost }) => c.data
        );

        // Always advance the cursor to the newest post we've seen.
        if (posts.length > 0) {
            latestPostName = posts[0].name; // /new is sorted newest-first
        }

        if (!posts.length) return;

        // DB dedup — safety net for restarts / race conditions
        const ids = posts.map(p => p.id);
        const existing = await RedditAlert.find({ redditId: { $in: ids } }).select('redditId').lean();
        const existingIds = new Set(existing.map(d => d.redditId));

        const newPosts = posts.filter(p => !existingIds.has(p.id));
        if (!newPosts.length) {
            return; // silent — normal when polling every 10 s
        }

        console.log(`[RedditService] ${newPosts.length} new post(s) — geocoding & saving…`);

        // Geocode all new posts concurrently
        const alerts = await Promise.all(newPosts.map(postToAlert));

        // Bulk-insert (ordered: false → continue on duplicate key errors)
        await RedditAlert.insertMany(alerts.map(a => ({ ...a })), { ordered: false }).catch(() => {});

        // Broadcast each new alert as the dashboard-ready LiveAlert shape
        for (const alert of alerts) {
            const liveAlert = {
                id:            `REDDIT-${alert.redditId}`,
                urgency:       alert.urgency,
                source:        'social' as const,
                sourceDetails: alert.sourceDetails,
                title:         alert.title,
                time:          alert.time,
                location:      alert.location,
                lat:           alert.lat,
                lng:           alert.lng,
                need:          alert.need,
                fullMessage:   alert.fullMessage,
                userId:        alert.userId,
                alertType:     alert.alertType,
                message:       alert.message,
                coordinates:   alert.coordinates,
                createdAt:     alert.createdAt,
            };
            io.emit('new_reddit_alert', liveAlert);
            console.log(`[RedditService] Broadcast → ${liveAlert.title}`);
        }
    } catch (err) {
        console.error('[RedditService] Poll error:', err);
    }
}

// ── Public: start the poller ──────────────────────────────────────────────────
export function startRedditPoller(io: Server): void {
    console.log(`[RedditService] Poller started — interval ${POLL_INTERVAL / 1000}s`);
    pollAndPersist(io);
    setInterval(() => pollAndPersist(io), POLL_INTERVAL);
}
