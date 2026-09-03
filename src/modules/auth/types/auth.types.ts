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

/** Client metadata required for login audit and security tracking. */
export interface LoginClientMetadata {
  ipAddress: string | null;
  userAgent: string | null;
}
