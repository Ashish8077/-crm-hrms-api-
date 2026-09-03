export class TimeUtil {
  /**
   * Parses a duration string (e.g., '15m', '7d', '1h', '30s') into seconds.
   *
   * @param duration The duration string to parse
   * @returns The duration in seconds
   * @throws Error if the duration format is invalid
   */
  static parseDurationToSeconds(duration: string): number {
    const match = duration
      .trim()
      .toLowerCase()
      .match(/^(\d+)([dhms])$/);

    if (!match) {
      throw new Error(`Invalid duration format: ${duration}`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 'd':
        return value * 24 * 60 * 60;
      case 'h':
        return value * 60 * 60;
      case 'm':
        return value * 60;
      case 's':
        return value;
      default:
        throw new Error(`Unsupported duration unit: ${unit}`);
    }
  }

  /**
   * Parses a duration string into milliseconds.
   *
   * @param duration The duration string to parse
   * @returns The duration in milliseconds
   * @throws Error if the duration format is invalid
   */
  static parseDurationToMilliseconds(duration: string): number {
    return TimeUtil.parseDurationToSeconds(duration) * 1000;
  }
}
