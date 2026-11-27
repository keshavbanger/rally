-- ==============================================================================
-- RALLY Supabase Row Level Security (RLS) Policies
-- Migration: 0001_rls_policies.sql
-- ==============================================================================

-- 1. Enable RLS on all primary tables
ALTER TABLE IF EXISTS public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.trip_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.sos_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.intelligence_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.notifications ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- Helper function to check active group membership efficiently
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_active_group_member(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = auth.uid()
      AND gm.status = 'ACTIVE'
  );
$$;

-- ------------------------------------------------------------------------------
-- Helper function to check active trip membership efficiently
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_active_trip_member(p_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trips t
    JOIN public.group_members gm ON gm.group_id = t.group_id
    WHERE t.id = p_trip_id
      AND gm.user_id = auth.uid()
      AND gm.status = 'ACTIVE'
  );
$$;

-- ==============================================================================
-- 2. PROFILES
-- ==============================================================================
DROP POLICY IF EXISTS "profiles_read_all" ON public.profiles;
CREATE POLICY "profiles_read_all" ON public.profiles
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

-- ==============================================================================
-- 3. USER_SETTINGS
-- ==============================================================================
DROP POLICY IF EXISTS "user_settings_own_all" ON public.user_settings;
CREATE POLICY "user_settings_own_all" ON public.user_settings
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ==============================================================================
-- 4. GROUPS
-- ==============================================================================
DROP POLICY IF EXISTS "groups_member_read" ON public.groups;
CREATE POLICY "groups_member_read" ON public.groups
  FOR SELECT USING (
    created_by = auth.uid() OR public.is_active_group_member(id)
  );

DROP POLICY IF EXISTS "groups_creator_insert" ON public.groups;
CREATE POLICY "groups_creator_insert" ON public.groups
  FOR INSERT WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "groups_leader_update" ON public.groups;
CREATE POLICY "groups_leader_update" ON public.groups
  FOR UPDATE USING (
    created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = id AND gm.user_id = auth.uid() AND gm.role = 'LEADER' AND gm.status = 'ACTIVE'
    )
  );

-- ==============================================================================
-- 5. GROUP_MEMBERS
-- ==============================================================================
DROP POLICY IF EXISTS "group_members_read" ON public.group_members;
CREATE POLICY "group_members_read" ON public.group_members
  FOR SELECT USING (
    user_id = auth.uid() OR public.is_active_group_member(group_id)
  );

DROP POLICY IF EXISTS "group_members_join" ON public.group_members;
CREATE POLICY "group_members_join" ON public.group_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "group_members_self_or_leader_update" ON public.group_members;
CREATE POLICY "group_members_self_or_leader_update" ON public.group_members
  FOR UPDATE USING (
    user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.group_members gm
      WHERE gm.group_id = group_id AND gm.user_id = auth.uid() AND gm.role = 'LEADER' AND gm.status = 'ACTIVE'
    )
  );

-- ==============================================================================
-- 6. TRIPS
-- ==============================================================================
DROP POLICY IF EXISTS "trips_member_read" ON public.trips;
CREATE POLICY "trips_member_read" ON public.trips
  FOR SELECT USING (public.is_active_group_member(group_id));

DROP POLICY IF EXISTS "trips_member_write" ON public.trips;
CREATE POLICY "trips_member_write" ON public.trips
  FOR ALL USING (public.is_active_group_member(group_id))
  WITH CHECK (public.is_active_group_member(group_id));

-- ==============================================================================
-- 7. ROUTES
-- ==============================================================================
DROP POLICY IF EXISTS "routes_member_read" ON public.routes;
CREATE POLICY "routes_member_read" ON public.routes
  FOR SELECT USING (public.is_active_trip_member(trip_id));

DROP POLICY IF EXISTS "routes_leader_write" ON public.routes;
CREATE POLICY "routes_leader_write" ON public.routes
  FOR ALL USING (public.is_active_trip_member(trip_id))
  WITH CHECK (public.is_active_trip_member(trip_id));

-- ==============================================================================
-- 8. TRIP_LOCATIONS
-- ==============================================================================
DROP POLICY IF EXISTS "trip_locations_member_read" ON public.trip_locations;
CREATE POLICY "trip_locations_member_read" ON public.trip_locations
  FOR SELECT USING (public.is_active_trip_member(trip_id));

DROP POLICY IF EXISTS "trip_locations_self_insert" ON public.trip_locations;
CREATE POLICY "trip_locations_self_insert" ON public.trip_locations
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND public.is_active_trip_member(trip_id)
  );

-- ==============================================================================
-- 9. SOS_EVENTS
-- ==============================================================================
DROP POLICY IF EXISTS "sos_events_member_read" ON public.sos_events;
CREATE POLICY "sos_events_member_read" ON public.sos_events
  FOR SELECT USING (public.is_active_trip_member(trip_id));

DROP POLICY IF EXISTS "sos_events_member_insert" ON public.sos_events;
CREATE POLICY "sos_events_member_insert" ON public.sos_events
  FOR INSERT WITH CHECK (
    user_id = auth.uid() AND public.is_active_trip_member(trip_id)
  );

DROP POLICY IF EXISTS "sos_events_member_update" ON public.sos_events;
CREATE POLICY "sos_events_member_update" ON public.sos_events
  FOR UPDATE USING (public.is_active_trip_member(trip_id));

-- ==============================================================================
-- 10. INTELLIGENCE_EVENTS & ALERTS
-- ==============================================================================
DROP POLICY IF EXISTS "intelligence_events_member_read" ON public.intelligence_events;
CREATE POLICY "intelligence_events_member_read" ON public.intelligence_events
  FOR SELECT USING (public.is_active_trip_member(trip_id));

DROP POLICY IF EXISTS "alerts_member_read" ON public.alerts;
CREATE POLICY "alerts_member_read" ON public.alerts
  FOR SELECT USING (public.is_active_group_member(group_id));

-- ==============================================================================
-- 11. NOTIFICATIONS
-- ==============================================================================
DROP POLICY IF EXISTS "notifications_own_read" ON public.notifications;
CREATE POLICY "notifications_own_read" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_own_update" ON public.notifications;
CREATE POLICY "notifications_own_update" ON public.notifications
  FOR UPDATE USING (user_id = auth.uid());
