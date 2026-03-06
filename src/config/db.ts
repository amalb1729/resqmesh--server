import mongoose from 'mongoose';

const connectDB = async (): Promise<void> => {
    const uri = process.env.MONGO_URI;
    if (!uri) {
        console.error('[DB] MONGO_URI is not set. Skipping database connection.');
        return;
    }

    try {
        await mongoose.connect(uri);
        console.log('[DB] MongoDB connected successfully');
    } catch (error) {
        console.error('[DB] MongoDB connection failed:', error);
        process.exit(1);
    }
};

export default connectDB;
