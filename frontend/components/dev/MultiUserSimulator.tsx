'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { env, API_V1 } from '@/lib/env';
import { TripSocket } from '@/lib/ws/client';
import type { ConnectionStatus, ServerMessage } from '@/lib/ws/types';

interface SimUserConfig {
  key: 'A' | 'B' | 'C';
  label: string;
  roleLabel: string;
  locationName: string;
  defaultLat: number;
  defaultLng: number;
  defaultEmail: string;
}

const SIM_USERS: SimUserConfig[] = [
  {
    key: 'A',
    label: 'User A',
    roleLabel: 'Group Leader',
    locationName: 'Vijay Nagar, Indore',
    defaultLat: 22.7533,
    defaultLng: 75.8937,
    defaultEmail: 'testuser_a@rally.test',
  },
  {
    key: 'B',
    label: 'User B',
    roleLabel: 'Group Member',
    locationName: 'Palasia, Indore',
    defaultLat: 22.7244,
    defaultLng: 75.8839,
    defaultEmail: 'testuser_b@rally.test',
  },
  {
    key: 'C',
    label: 'User C',
    roleLabel: 'Group Member',
    locationName: 'Rajwada, Indore',
    defaultLat: 22.7186,
    defaultLng: 75.8586,
    defaultEmail: 'testuser_c@rally.test',
  },
];

async function apiRequest<T>(
  path: string,
  token: string,
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
  body?: unknown
): Promise<T> {
  const res = await fetch(`${env.apiUrl}${API_V1}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const detail = (json as { detail?: string } | null)?.detail || `HTTP ${res.status}`;
    throw new Error(detail);
  }
  return json as T;
}

function UserSimulatorPanel({
  config,
  sharedGroupId,
  sharedJoinCode,
  sharedTripId,
  onGroupCreated,
  onTripCreated,
}: {
  config: SimUserConfig;
  sharedGroupId: string;
  sharedJoinCode: string;
  sharedTripId: string;
  onGroupCreated: (groupId: string, joinCode: string) => void;
  onTripCreated: (tripId: string) => void;
}) {
  const [email, setEmail] = useState(config.defaultEmail);
  const [password, setPassword] = useState('RallyTest@2024!');
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<'SIGNED_OUT' | 'SIGNING_IN' | 'SIGNED_IN' | 'ERROR'>('SIGNED_OUT');

  const [wsStatus, setWsStatus] = useState<ConnectionStatus>('DISCONNECTED');
  const [lat, setLat] = useState<string>(String(config.defaultLat));
  const [lng, setLng] = useState<string>(String(config.defaultLng));
  const [speedMps, setSpeedMps] = useState<string>('12');
  const [intervalMs, setIntervalMs] = useState<string>('2000');
  const [isMoving, setIsMoving] = useState(false);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  const socketRef = useRef<TripSocket | null>(null);
  const moveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const coordsRef = useRef({ lat: config.defaultLat, lng: config.defaultLng });

  useEffect(() => {
    if (sharedJoinCode && !joinCodeInput) {
      setJoinCodeInput(sharedJoinCode);
    }
  }, [sharedJoinCode, joinCodeInput]);

  const appendLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs((prev) => [`[${ts}] ${msg}`, ...prev].slice(0, 40));
  }, []);

  useEffect(() => {
    return () => {
      if (moveTimerRef.current) clearInterval(moveTimerRef.current);
      socketRef.current?.disconnect();
    };
  }, []);

  const handleLogin = async () => {
    setAuthStatus('SIGNING_IN');
    try {
      const client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.session) {
        throw new Error(error?.message || 'Login failed');
      }
      setToken(data.session.access_token);
      setUserId(data.user.id);
      setAuthStatus('SIGNED_IN');
      appendLog(`Signed in as ${email} (${data.user.id.slice(0, 8)}...)`);
    } catch (err) {
      setAuthStatus('ERROR');
      appendLog(`Auth error: ${(err as Error).message}`);
    }
  };

  const handleCreateGroupAndTrip = async () => {
    if (!token) return;
    try {
      const grp = await apiRequest<{ id: string; join_code: string }>('/groups', token, 'POST', {
        name: 'Indore Multi-User Audit',
        destination_name: 'Rajwada Palace, Indore',
      });
      onGroupCreated(grp.id, grp.join_code);
      appendLog(`Group created: ${grp.id.slice(0, 8)}... | Code: ${grp.join_code}`);

      const trip = await apiRequest<{ id: string }>(`/groups/${grp.id}/trips`, token, 'POST', {
        destination_name: 'Rajwada Palace, Indore',
      });
      onTripCreated(trip.id);
      appendLog(`Trip created (CREATED): ${trip.id.slice(0, 8)}...`);
    } catch (err) {
      appendLog(`Create group/trip error: ${(err as Error).message}`);
    }
  };

  const handleJoinGroup = async () => {
    if (!token || !joinCodeInput.trim()) return;
    try {
      const grp = await apiRequest<{ id: string; join_code: string }>('/groups/join', token, 'POST', {
        join_code: joinCodeInput.trim().toUpperCase(),
      });
      appendLog(`Joined group ${grp.id.slice(0, 8)}... via code ${grp.join_code}`);
    } catch (err) {
      appendLog(`Join error: ${(err as Error).message}`);
    }
  };

  const handleStartTrip = async () => {
    if (!token || !sharedTripId) return;
    try {
      await apiRequest(`/trips/${sharedTripId}/start`, token, 'POST');
      appendLog(`Trip ${sharedTripId.slice(0, 8)}... started (ACTIVE)`);
    } catch (err) {
      appendLog(`Start trip error: ${(err as Error).message}`);
    }
  };

  const handleConnectWs = () => {
    if (!token || !sharedTripId) {
      appendLog('Need auth token and Trip ID before connecting WS.');
      return;
    }
    socketRef.current?.disconnect();
    const sock = new TripSocket(sharedTripId, async () => token);
    sock.onStatusChange((status) => {
      setWsStatus(status);
      appendLog(`WS status -> ${status}`);
    });
    sock.onMessage((msg: ServerMessage) => {
      const summary =
        msg.type === 'location_update'
          ? `loc ${(msg as { data: { user_id: string; latitude: number; longitude: number } }).data.user_id.slice(0, 6)} @ ${(msg as { data: { latitude: number } }).data.latitude.toFixed(4)},${(msg as { data: { longitude: number } }).data.longitude.toFixed(4)}`
          : msg.type;
      appendLog(`WS <- ${summary}`);
    });
    socketRef.current = sock;
    void sock.connect();
  };

  const handleDisconnectWs = () => {
    if (moveTimerRef.current) {
      clearInterval(moveTimerRef.current);
      moveTimerRef.current = null;
      setIsMoving(false);
    }
    socketRef.current?.disconnect();
    appendLog('WS disconnected manually');
  };

  const sendCoords = (nextLat: number, nextLng: number, speed: number) => {
    coordsRef.current = { lat: nextLat, lng: nextLng };
    setLat(nextLat.toFixed(6));
    setLng(nextLng.toFixed(6));
    if (socketRef.current && wsStatus === 'CONNECTED') {
      socketRef.current.sendLocationUpdate({
        latitude: nextLat,
        longitude: nextLng,
        accuracy: 8,
        speed,
        heading: 90,
      });
      appendLog(`WS -> location_update (${nextLat.toFixed(5)}, ${nextLng.toFixed(5)})`);
    } else if (token && sharedTripId) {
      void apiRequest(`/trips/${sharedTripId}/locations`, token, 'POST', {
        latitude: nextLat,
        longitude: nextLng,
        accuracy: 8,
        speed,
        heading: 90,
      })
        .then(() => appendLog(`REST -> location (${nextLat.toFixed(5)}, ${nextLng.toFixed(5)})`))
        .catch((err) => appendLog(`REST loc error: ${(err as Error).message}`));
    }
  };

  const handleStartMovement = () => {
    if (moveTimerRef.current) clearInterval(moveTimerRef.current);
    const ms = Math.max(1100, Number(intervalMs) || 2000);
    const spd = Math.max(1, Number(speedMps) || 12);
    setIsMoving(true);
    appendLog(`Movement started (${spd} m/s every ${ms}ms)`);
    moveTimerRef.current = setInterval(() => {
      // ~0.0001 deg lat ~= 11.1m
      const stepDeg = (spd * (ms / 1000)) / 111000;
      const nextLat = coordsRef.current.lat + stepDeg * 0.5;
      const nextLng = coordsRef.current.lng - stepDeg * 0.5;
      sendCoords(nextLat, nextLng, spd);
    }, ms);
  };

  const handleStopMovement = () => {
    if (moveTimerRef.current) {
      clearInterval(moveTimerRef.current);
      moveTimerRef.current = null;
    }
    setIsMoving(false);
    appendLog('Movement stopped');
  };

  const handleSimulateDeviation = () => {
    // Shift ~600m north-west off planned route
    const devLat = coordsRef.current.lat + 0.0055;
    const devLng = coordsRef.current.lng - 0.0055;
    sendCoords(devLat, devLng, Number(speedMps) || 12);
    appendLog('Simulated route deviation (+600m offset)');
  };

  const handleSimulateSOS = async () => {
    if (!token || !sharedTripId) return;
    try {
      const sos = await apiRequest<{ id: string }>(`/trips/${sharedTripId}/sos`, token, 'POST', {
        latitude: Number(lat),
        longitude: Number(lng),
        message: `[SIMULATION TEST] SOS from ${config.label}`,
      });
      appendLog(`SOS triggered (simulation): ${sos.id.slice(0, 8)}...`);
    } catch (err) {
      appendLog(`SOS error: ${(err as Error).message}`);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3 text-xs">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div>
          <h2 className="font-semibold text-sm text-foreground">{config.label} — {config.roleLabel}</h2>
          <p className="text-muted-foreground">{config.locationName}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`px-2 py-0.5 rounded font-mono ${authStatus === 'SIGNED_IN' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
            {authStatus}
          </span>
          <span className={`px-2 py-0.5 rounded font-mono ${wsStatus === 'CONNECTED' ? 'bg-cyan-500/20 text-cyan-400' : 'bg-muted text-muted-foreground'}`}>
            WS: {wsStatus}
          </span>
        </div>
      </div>

      {userId && (
        <div className="font-mono text-[11px] text-muted-foreground truncate">
          UID: {userId}
        </div>
      )}

      {/* Auth */}
      <div className="grid grid-cols-2 gap-2">
        <input
          className="px-2 py-1.5 rounded border border-border bg-background text-foreground"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
        />
        <input
          type="password"
          className="px-2 py-1.5 rounded border border-border bg-background text-foreground"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />
      </div>
      <button
        onClick={handleLogin}
        className="px-3 py-1.5 rounded bg-primary text-primary-foreground font-medium hover:opacity-90"
      >
        Sign In (Independent Session)
      </button>

      {/* Group / Trip */}
      <div className="flex flex-wrap gap-2 pt-1 border-t border-border">
        {config.key === 'A' ? (
          <>
            <button onClick={handleCreateGroupAndTrip} disabled={!token} className="px-2.5 py-1.5 rounded bg-secondary text-secondary-foreground disabled:opacity-40">
              Create Group & Trip
            </button>
            <button onClick={handleStartTrip} disabled={!token || !sharedTripId} className="px-2.5 py-1.5 rounded bg-emerald-600 text-white disabled:opacity-40">
              Start Trip
            </button>
          </>
        ) : (
          <div className="flex gap-1 w-full">
            <input
              className="flex-1 px-2 py-1 rounded border border-border bg-background text-foreground font-mono"
              value={joinCodeInput}
              onChange={(e) => setJoinCodeInput(e.target.value)}
              placeholder="RALLY-XXXXX"
            />
            <button onClick={handleJoinGroup} disabled={!token || !joinCodeInput} className="px-2.5 py-1 rounded bg-secondary text-secondary-foreground disabled:opacity-40">
              Join Group
            </button>
          </div>
        )}
      </div>

      {/* WebSocket */}
      <div className="flex gap-2">
        <button onClick={handleConnectWs} disabled={!token || !sharedTripId} className="flex-1 px-2.5 py-1.5 rounded bg-cyan-600 text-white disabled:opacity-40">
          Connect WS
        </button>
        <button onClick={handleDisconnectWs} className="flex-1 px-2.5 py-1.5 rounded bg-zinc-700 text-white">
          Disconnect WS
        </button>
      </div>

      {/* Coordinates & Movement */}
      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Latitude</span>
          <input className="px-2 py-1 rounded border border-border bg-background font-mono" value={lat} onChange={(e) => setLat(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Longitude</span>
          <input className="px-2 py-1 rounded border border-border bg-background font-mono" value={lng} onChange={(e) => setLng(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Speed (m/s)</span>
          <input className="px-2 py-1 rounded border border-border bg-background font-mono" value={speedMps} onChange={(e) => setSpeedMps(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Interval (ms)</span>
          <input className="px-2 py-1 rounded border border-border bg-background font-mono" value={intervalMs} onChange={(e) => setIntervalMs(e.target.value)} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => sendCoords(Number(lat), Number(lng), Number(speedMps) || 0)}
          disabled={!token || !sharedTripId}
          className="px-2.5 py-1.5 rounded bg-secondary text-secondary-foreground disabled:opacity-40"
        >
          Send Manual GPS
        </button>
        {!isMoving ? (
          <button onClick={handleStartMovement} disabled={!token || !sharedTripId} className="px-2.5 py-1.5 rounded bg-emerald-600 text-white disabled:opacity-40">
            Start Movement
          </button>
        ) : (
          <button onClick={handleStopMovement} className="px-2.5 py-1.5 rounded bg-amber-600 text-white">
            Stop Movement
          </button>
        )}
        <button onClick={handleSimulateDeviation} disabled={!token || !sharedTripId} className="px-2.5 py-1.5 rounded bg-orange-600 text-white disabled:opacity-40">
          Simulate Deviation
        </button>
        <button onClick={handleSimulateSOS} disabled={!token || !sharedTripId} className="px-2.5 py-1.5 rounded bg-red-600 text-white disabled:opacity-40">
          Simulate SOS (Test)
        </button>
      </div>

      {/* Event Logs */}
      <div className="mt-1 bg-background border border-border rounded p-2 h-40 overflow-y-auto font-mono text-[10px] space-y-1">
        {logs.length === 0 ? (
          <span className="text-muted-foreground">No events yet...</span>
        ) : (
          logs.map((line, i) => <div key={i} className="break-all">{line}</div>)
        )}
      </div>
    </div>
  );
}

export default function MultiUserSimulator() {
  const [sharedGroupId, setSharedGroupId] = useState('');
  const [sharedJoinCode, setSharedJoinCode] = useState('');
  const [sharedTripId, setSharedTripId] = useState('');

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">
              Development-Only Harness
            </span>
            <h1 className="text-xl font-bold mt-1">RALLY Multi-User GPS &amp; Real-Time Simulator</h1>
            <p className="text-sm text-muted-foreground">
              Independent Supabase auth sessions + real FastAPI REST &amp; WebSocket pipelines (Indore coordinates).
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-xs font-mono bg-card border border-border rounded-lg px-3 py-2">
            <div>Group: {sharedGroupId ? sharedGroupId.slice(0, 8) + '...' : '—'}</div>
            <div>Join Code: <span className="text-cyan-400 font-bold">{sharedJoinCode || '—'}</span></div>
            <div>Trip: {sharedTripId ? sharedTripId.slice(0, 8) + '...' : '—'}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {SIM_USERS.map((cfg) => (
            <UserSimulatorPanel
              key={cfg.key}
              config={cfg}
              sharedGroupId={sharedGroupId}
              sharedJoinCode={sharedJoinCode}
              sharedTripId={sharedTripId}
              onGroupCreated={(gid, code) => {
                setSharedGroupId(gid);
                setSharedJoinCode(code);
              }}
              onTripCreated={(tid) => setSharedTripId(tid)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

