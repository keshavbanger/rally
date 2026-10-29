import { api } from './client';
import type { ApiAlert, AlertSeverity, AlertStatus, AlertType } from './types';

export function listTripAlerts(
  tripId: string,
  query: { status?: AlertStatus; severity?: AlertSeverity; alert_type?: AlertType; limit?: number } = {}
): Promise<ApiAlert[]> {
  return api.get<ApiAlert[]>(`/trips/${tripId}/alerts`, query);
}

export async function listActiveTripAlerts(tripId: string): Promise<ApiAlert[]> {
  const res = await api.get<ApiAlert[] | { alerts?: ApiAlert[] }>(`/trips/${tripId}/alerts/active`);
  if (Array.isArray(res)) return res;
  if (res && Array.isArray((res as { alerts?: ApiAlert[] }).alerts)) {
    return (res as { alerts: ApiAlert[] }).alerts;
  }
  return [];
}

export function getAlert(alertId: string): Promise<ApiAlert> {
  return api.get<ApiAlert>(`/alerts/${alertId}`);
}

/** Every alert mutation flows through the backend and is only reflected
 * in the UI once it responds successfully (Phase 13, item 18) — never
 * mark an alert resolved locally first. */
export function acknowledgeAlert(alertId: string): Promise<ApiAlert> {
  return api.post<ApiAlert>(`/alerts/${alertId}/acknowledge`);
}

export function resolveAlert(alertId: string): Promise<ApiAlert> {
  return api.post<ApiAlert>(`/alerts/${alertId}/resolve`);
}
