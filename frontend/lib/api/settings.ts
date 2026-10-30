import { api } from './client';

export interface ApiUserSettings {
  user_id: string;
  alert_sensitivity: 'LOW' | 'MEDIUM' | 'HIGH';
  separation_threshold_m: number;
  route_deviation_threshold_m: number;
  notifications_alerts: boolean;
  notifications_sos: boolean;
  notifications_connectivity: boolean;
  notifications_trip_summaries: boolean;
  sound_alerts_enabled: boolean;
  location_sharing: boolean;
  theme: 'dark' | 'light' | 'system';
  units: 'Metric' | 'Imperial';
  created_at: string;
  updated_at: string;
}

export type UserSettingsUpdate = Partial<
  Omit<ApiUserSettings, 'user_id' | 'created_at' | 'updated_at'>
>;

export function getSettings(): Promise<ApiUserSettings> {
  return api.get<ApiUserSettings>('/settings');
}

export function updateSettings(data: UserSettingsUpdate): Promise<ApiUserSettings> {
  return api.patch<ApiUserSettings>('/settings', data);
}
