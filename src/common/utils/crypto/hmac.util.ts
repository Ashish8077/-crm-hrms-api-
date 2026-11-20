import { createHmac } from 'crypto';

export class HmacUtil {
  static hash(value: string, secret: string): string {
    return createHmac('sha256', secret).update(value).digest('hex');
  }
}
