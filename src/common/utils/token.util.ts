import * as crypto from 'crypto';

export class TokenUtil {
  /**
   * Generates a 256-bit cryptographically secure random token, returned as a hex string.
   */
  static generateRefreshToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hashes a token using SHA-256 for secure storage in the database.
   * Uses hex encoding for the digest.
   */
  static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
