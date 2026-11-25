import mongoose, { Schema } from 'mongoose';
const userSchema = new Schema({ email: String, name: { type: String, required: true }, createdAt: Date });
export const User = mongoose.model('User', userSchema);
