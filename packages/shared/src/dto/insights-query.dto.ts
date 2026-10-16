import { IsIn, IsOptional } from 'class-validator';

/** Time windows the insights endpoint reports on, newest bucket last. */
export const INSIGHT_RANGES = ['15m', '1h', '24h', '7d'] as const;
export type InsightsRange = (typeof INSIGHT_RANGES)[number];

/** Window length and bucket size per range: each range draws about 24 to 30 bars. */
export const INSIGHT_WINDOWS: Record<
  InsightsRange,
  { rangeMs: number; bucketMs: number }
> = {
  '15m': { rangeMs: 15 * 60_000, bucketMs: 30_000 },
  '1h': { rangeMs: 60 * 60_000, bucketMs: 2 * 60_000 },
  '24h': { rangeMs: 24 * 3_600_000, bucketMs: 3_600_000 },
  '7d': { rangeMs: 7 * 86_400_000, bucketMs: 6 * 3_600_000 },
};

export class InsightsQueryDto {
  @IsOptional()
  @IsIn(INSIGHT_RANGES, { message: `range must be one of: ${INSIGHT_RANGES.join(', ')}` })
  range?: InsightsRange;
}
