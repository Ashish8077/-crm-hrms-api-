import { Transform } from 'class-transformer';

export function TrimString() {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}
