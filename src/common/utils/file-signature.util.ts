export const MIME_TO_EXTENSION: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

/**
 * Detects the MIME type of a file buffer based on its magic bytes (file signature).
 * Supports PDF, JPEG, and PNG.
 */
export function detectMimeTypeFromBuffer(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 4) {
    return null;
  }

  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A (\x89PNG\r\n\x1a\n)
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // JPEG magic bytes: FF D8 FF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }

  // PDF magic bytes: %PDF (25 50 44 46)
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return 'application/pdf';
  }

  return null;
}

/**
 * Validates file buffer content against declared MIME type and optional allowlist.
 */
export function validateFileContent(
  buffer: Buffer,
  declaredMimeType: string,
  allowedMimeTypes?: readonly string[] | string[],
): { isValid: boolean; detectedMime: string | null; error?: string } {
  if (!buffer || buffer.length === 0) {
    return {
      isValid: false,
      detectedMime: null,
      error: 'File buffer is empty or missing',
    };
  }

  const detectedMime = detectMimeTypeFromBuffer(buffer);

  if (!detectedMime) {
    return {
      isValid: false,
      detectedMime: null,
      error: 'File signature could not be verified or is not supported',
    };
  }

  // Handle image/jpg vs image/jpeg equivalence
  const normalizedDeclared =
    declaredMimeType === 'image/jpg' ? 'image/jpeg' : declaredMimeType;

  //checking Client MIME type to Server detected MIME types
  if (detectedMime !== normalizedDeclared) {
    return {
      isValid: false,
      detectedMime,
      error: `File signature (${detectedMime}) does not match declared MIME type (${declaredMimeType})`,
    };
  }

  // checking Server detectedMime against allowedMimeTypes
  if (allowedMimeTypes && !allowedMimeTypes.includes(detectedMime)) {
    return {
      isValid: false,
      detectedMime,
      error: `File type ${detectedMime} is not allowed`,
    };
  }

  return { isValid: true, detectedMime };
}

/**
 * Returns a trusted file extension based on verified MIME type, avoiding untrusted user input.
 */
export function getTrustedExtension(mimeType: string): string {
  const normalized = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
  return MIME_TO_EXTENSION[normalized] ?? '';
}
