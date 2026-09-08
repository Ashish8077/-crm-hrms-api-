import { Request } from 'express';
import { Types } from 'mongoose';

export interface AuthenticatedUser {
  userId: Types.ObjectId;
  sessionId: Types.ObjectId;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
