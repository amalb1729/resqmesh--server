import { Schema, model, Document } from 'mongoose';

// Shape of the raw payload coming from the mobile/hardware mesh gateway
export interface IAlert extends Document {
    id: string;
    type: string;
    message: string;
    timestamp: number;
    status: string;
    latitude: number;
    longitude: number;
}

const AlertSchema = new Schema<IAlert>(
    {
        id: { type: String, required: true, unique: true },
        type: { type: String, required: true },
        message: { type: String, required: true },
        timestamp: { type: Number, required: true },
        status: { type: String, required: true },
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true },
    },
    {
        // Automatically add createdAt / updatedAt for audit purposes
        timestamps: true,
    }
);

const Alert = model<IAlert>('Alert', AlertSchema);

export default Alert;
