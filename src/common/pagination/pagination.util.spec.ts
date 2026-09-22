import { calculateSkip, buildPaginationMeta } from './pagination.util';

describe('Pagination Utilities', () => {
  describe('calculateSkip', () => {
    it('should return 0 for page 1, limit 20', () => {
      expect(calculateSkip(1, 20)).toBe(0);
    });

    it('should return 20 for page 2, limit 20', () => {
      expect(calculateSkip(2, 20)).toBe(20);
    });

    it('should return 40 for page 3, limit 20', () => {
      expect(calculateSkip(3, 20)).toBe(40);
    });
  });

  describe('buildPaginationMeta', () => {
    it('should handle total = 0 correctly', () => {
      const meta = buildPaginationMeta(0, 1, 20);
      expect(meta).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });

    it('should handle total = 20 exactly fitting one page', () => {
      const meta = buildPaginationMeta(20, 1, 20);
      expect(meta).toEqual({
        page: 1,
        limit: 20,
        total: 20,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      });
    });

    it('should handle total = 21 bleeding into a second page', () => {
      const meta = buildPaginationMeta(21, 1, 20);
      expect(meta).toEqual({
        page: 1,
        limit: 20,
        total: 21,
        totalPages: 2,
        hasNextPage: true,
        hasPreviousPage: false,
      });
    });

    it('should handle page 2 for total 21 correctly', () => {
      const meta = buildPaginationMeta(21, 2, 20);
      expect(meta).toEqual({
        page: 2,
        limit: 20,
        total: 21,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      });
    });

    it('should handle total 100, limit 20 correctly (middle page)', () => {
      const meta = buildPaginationMeta(100, 3, 20);
      expect(meta).toEqual({
        page: 3,
        limit: 20,
        total: 100,
        totalPages: 5,
        hasNextPage: true,
        hasPreviousPage: true,
      });
    });

    it('should handle page beyond totalPages (empty page)', () => {
      const meta = buildPaginationMeta(21, 5, 20);
      expect(meta).toEqual({
        page: 5,
        limit: 20,
        total: 21,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      });
    });
  });
});
