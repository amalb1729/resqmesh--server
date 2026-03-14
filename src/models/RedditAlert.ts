import { Schema, model, Document } from 'mongoose';

// Mirrors the LiveAlert shape used by the Next.js dashboard.
// `redditId` is the raw Reddit post ID (without the "REDDIT-" prefix)
// and is the uniqueness key so we never store the same post twice.
export interface IRedditAlert extends Document {
    redditId:      string;   // e.g. "1abcxyz"
    urgency:       string;   // AlertCategory: MEDICAL | RESCUE | GENERAL …
    sourceDetails: string;   // "NLP: 72%"
    title:         string;
    time:          string;   // human-relative, stored at ingest time
    location:      string;
    lat:           number;
    lng:           number;
    need:          string;
    fullMessage:   string;
    userId:        string;   // "u/authorname"
    alertType:     string;
    message:       string;
    coordinates:   string;
    createdAt:     number;   // Unix ms (post.created_utc * 1000)
}

const RedditAlertSchema = new Schema<IRedditAlert>(
    {
        redditId:      { type: String, required: true, unique: true },
        urgency:       { type: String, required: true },
        sourceDetails: { type: String, required: true },
        title:         { type: String, required: true },
        time:          { type: String, required: true },
        location:      { type: String, required: true },
        lat:           { type: Number, required: true },
        lng:           { type: Number, required: true },
        need:          { type: String, required: true },
        fullMessage:   { type: String, default: '' },
        userId:        { type: String, required: true },
        alertType:     { type: String, required: true },
        message:       { type: String, required: true },
        coordinates:   { type: String, required: true },
        createdAt:     { type: Number, required: true },
    },
    { timestamps: false } // we manage createdAt ourselves (Reddit's epoch)
);

const RedditAlert = model<IRedditAlert>('RedditAlert', RedditAlertSchema);
export default RedditAlert;
