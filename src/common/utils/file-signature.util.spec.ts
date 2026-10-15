import {
  detectMimeTypeFromBuffer,
  validateFileContent,
  getTrustedExtension,
} from './file-signature.util';

describe('file-signature.util', () => {
  const validPdfBuffer = Buffer.from('%PDF-1.7 sample content');
  const validJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
  ]);
  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
  ]);
  const invalidBuffer = Buffer.from('hello world random text');

  describe('detectMimeTypeFromBuffer', () => {
    it('should detect PDF magic bytes', () => {
      expect(detectMimeTypeFromBuffer(validPdfBuffer)).toBe('application/pdf');
    });

    it('should detect JPEG magic bytes', () => {
      expect(detectMimeTypeFromBuffer(validJpegBuffer)).toBe('image/jpeg');
    });

    it('should detect PNG magic bytes', () => {
      expect(detectMimeTypeFromBuffer(validPngBuffer)).toBe('image/png');
    });

    it('should return null for unrecognized buffers', () => {
      expect(detectMimeTypeFromBuffer(invalidBuffer)).toBeNull();
      expect(detectMimeTypeFromBuffer(Buffer.from([]))).toBeNull();
      expect(detectMimeTypeFromBuffer(Buffer.from([0x01, 0x02]))).toBeNull();
    });
  });

  describe('validateFileContent', () => {
    it('should validate matching PDF content', () => {
      const result = validateFileContent(validPdfBuffer, 'application/pdf', [
        'application/pdf',
        'image/jpeg',
        'image/png',
      ]);
      expect(result.isValid).toBe(true);
      expect(result.detectedMime).toBe('application/pdf');
    });

    it('should reject when declared MIME does not match magic bytes', () => {
      const result = validateFileContent(validPdfBuffer, 'image/png', [
        'application/pdf',
        'image/jpeg',
        'image/png',
      ]);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('does not match declared MIME type');
    });

    it('should reject when buffer has unknown signature', () => {
      const result = validateFileContent(invalidBuffer, 'application/pdf', [
        'application/pdf',
      ]);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('File signature could not be verified');
    });

    it('should reject when buffer is empty', () => {
      const result = validateFileContent(Buffer.from([]), 'application/pdf');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('empty or missing');
    });

    it('should reject when detected MIME is not in allowed list', () => {
      const result = validateFileContent(
        validPngBuffer,
        'image/png',
        ['application/pdf'], // only PDF allowed
      );
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('not allowed');
    });
  });

  describe('getTrustedExtension', () => {
    it('should map valid MIME types to extensions', () => {
      expect(getTrustedExtension('application/pdf')).toBe('.pdf');
      expect(getTrustedExtension('image/jpeg')).toBe('.jpg');
      expect(getTrustedExtension('image/jpg')).toBe('.jpg');
      expect(getTrustedExtension('image/png')).toBe('.png');
    });

    it('should return empty string for unknown MIME types', () => {
      expect(getTrustedExtension('application/exe')).toBe('');
      expect(getTrustedExtension('text/plain')).toBe('');
    });
  });
});
