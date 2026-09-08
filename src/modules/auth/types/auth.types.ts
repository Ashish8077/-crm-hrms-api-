import { Types } from 'mongoose';

/** Result of a successful login operation. */
export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
  };
}

/** Client metadata required for audit and security tracking. */
export interface ClientMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}

/** Result of a successful refresh operation. */
export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
  };
}

export interface LogoutData {
  userId: Types.ObjectId;
  sessionId: Types.ObjectId;
  ipAddress: string | null;
  userAgent: string | null;
}
