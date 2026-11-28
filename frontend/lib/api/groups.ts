import { api } from './client';
import type { ApiDestinationSuggestion, ApiGroup, ApiGroupListItem, ApiGroupMember, ArrivalStatus, JourneyMode } from './types';

export function listMyGroups(): Promise<ApiGroupListItem[]> {
  return api.get<ApiGroupListItem[]>('/groups');
}

export function createGroup(input: {
  name: string;
  destination_name?: string;
  latitude?: number;
  longitude?: number;
  journey_mode?: JourneyMode;
  meetup_name?: string;
  meetup_latitude?: number;
  meetup_longitude?: number;
}): Promise<ApiGroup> {
  return api.post<ApiGroup>('/groups', input);
}

export function joinGroup(joinCode: string): Promise<ApiGroup> {
  return api.post<ApiGroup>('/groups/join', { join_code: joinCode });
}

export function getGroup(groupId: string): Promise<ApiGroup> {
  return api.get<ApiGroup>(`/groups/${groupId}`);
}

export function getGroupMembers(groupId: string): Promise<ApiGroupMember[]> {
  return api.get<ApiGroupMember[]>(`/groups/${groupId}/members`);
}

export function leaveGroup(groupId: string): Promise<void> {
  return api.post<void>(`/groups/${groupId}/leave`);
}

export function removeMember(groupId: string, targetUserId: string): Promise<void> {
  return api.delete<void>(`/groups/${groupId}/members/${targetUserId}`);
}

export function transferLeadership(groupId: string, newLeaderId: string): Promise<void> {
  return api.post<void>(`/groups/${groupId}/transfer-leadership`, { new_leader_id: newLeaderId });
}

export function setMeetupLocation(
  groupId: string,
  input: { meetup_name: string; latitude: number; longitude: number }
): Promise<ApiGroup> {
  return api.post<ApiGroup>(`/groups/${groupId}/meetup`, input);
}

export function updateReadiness(
  groupId: string,
  arrivalStatus: ArrivalStatus
): Promise<ApiGroupMember> {
  return api.post<ApiGroupMember>(`/groups/${groupId}/readiness`, { arrival_status: arrivalStatus });
}

export function getReadiness(groupId: string): Promise<{
  group_id: string;
  journey_mode: JourneyMode;
  session_status: string;
  total_members: number;
  ready_members: number;
  arrived_members: number;
  all_ready: boolean;
  readiness_percentage: number;
}> {
  return api.get(`/groups/${groupId}/readiness`);
}

export function suggestDestination(
  groupId: string,
  input: { destination_name: string; latitude: number; longitude: number }
): Promise<ApiDestinationSuggestion> {
  return api.post<ApiDestinationSuggestion>(`/groups/${groupId}/suggestions`, input);
}

export function listSuggestions(groupId: string): Promise<ApiDestinationSuggestion[]> {
  return api.get<ApiDestinationSuggestion[]>(`/groups/${groupId}/suggestions`);
}

export function approveSuggestion(groupId: string, suggestionId: string): Promise<ApiDestinationSuggestion> {
  return api.post<ApiDestinationSuggestion>(`/groups/${groupId}/suggestions/${suggestionId}/approve`);
}

export function rejectSuggestion(groupId: string, suggestionId: string, reason: string): Promise<ApiDestinationSuggestion> {
  return api.post<ApiDestinationSuggestion>(`/groups/${groupId}/suggestions/${suggestionId}/reject`, { reason });
}

