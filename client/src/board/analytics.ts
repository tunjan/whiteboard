import type { AnalyticsRange, AnalyticsSummary } from '@whiteboard/shared';

/** The tutor's attendance register. Tutor-only on the server. */
export async function fetchAnalytics(
  days: AnalyticsRange,
  signal?: AbortSignal,
): Promise<AnalyticsSummary> {
  const res = await fetch(`/api/analytics?days=${days}`, {
    credentials: 'include',
    signal,
  });
  if (!res.ok) throw new Error(`Analytics request failed (${res.status})`);
  return (await res.json()) as AnalyticsSummary;
}
