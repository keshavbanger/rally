# Supabase Database Migrations & Security Policies

This folder contains database configuration and Row Level Security (RLS) migrations for the Supabase PostgreSQL backend.

## Structure

```
supabase/
├── migrations/
│   └── 0001_rls_policies.sql   # Comprehensive Row Level Security (RLS) policies
└── README.md
```

## Applying Policies to Supabase

### Option A: Supabase Dashboard SQL Editor (Recommended)
1. Open the [Supabase Dashboard](https://supabase.com/dashboard).
2. Select your project (`rally`).
3. Navigate to **SQL Editor**.
4. Paste the contents of `migrations/0001_rls_policies.sql`.
5. Click **Run**.

### Option B: Supabase CLI
```bash
supabase db push
# or
supabase migration up
```

## Policy Coverage

The RLS migration secures all user-data tables:
- **`profiles`**: Authenticated read; self-update only (`id = auth.uid()`).
- **`groups`**: Accessible only by creators and active group members (`is_active_group_member`).
- **`group_members`**: Visible only to members of the same group.
- **`trips`**: Restricted to active members of the trip's group.
- **`routes`**: Visible only to members of the corresponding trip.
- **`trip_locations`**: Visible only to trip members; users can only submit their own GPS coordinates (`user_id = auth.uid()`).
- **`sos_events`**: Scoped strictly to trip members.
- **`intelligence_events` & `alerts`**: Scoped strictly to trip/group members.
- **`user_settings`**: Private to each user (`user_id = auth.uid()`).
- **`notifications`**: Private to each recipient (`user_id = auth.uid()`).
