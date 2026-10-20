import { api } from './client';
import type { ApiRoute, ApiRouteOrEmpty, RouteCreate, RouteProgressResponse } from './types';

export function createRoute(tripId: string, input: RouteCreate): Promise<ApiRoute> {
  return api.post<ApiRoute>(`/trips/${tripId}/route`, input);
}

/** Always resolves (never rejects for missing route). Returns the envelope;
 *  check `.route` — it is `null` when no route has been saved yet. */
export function getRoute(tripId: string): Promise<ApiRouteOrEmpty> {
  return api.get<ApiRouteOrEmpty>(`/trips/${tripId}/route`);
}

export function getRouteProgress(tripId: string): Promise<RouteProgressResponse> {
  return api.get<RouteProgressResponse>(`/trips/${tripId}/route/progress`);
}
