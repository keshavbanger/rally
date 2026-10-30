/**
 * alertSound – Web Audio API synthesized audio alerts for RALLY.
 *
 * Implements:
 * - Subtle dual-chime for warning/info alerts
 * - Distinct high-urgency chime for critical/SOS alerts
 * - Deduplication via playedEventIds Set to prevent repeated sounds on re-renders or socket reconnects
 * - Safe handling of browser autoplay restrictions (graceful catch & resume)
 * - User setting preference check (soundAlerts)
 */

import { settingsService } from '@/lib/mock/settingsService';

let audioCtx: AudioContext | null = null;
const playedEventIds = new Set<string>();
const MAX_PLAYED_IDS = 1000;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Play a synthesized dual-tone pleasant chime for standard alerts.
 */
export function playChime(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880, now);
    osc2.frequency.exponentialRampToValueAtTime(1174.66, now + 0.15); // D6

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now + 0.05);
    osc1.stop(now + 0.4);
    osc2.stop(now + 0.4);
  } catch (err) {
    console.warn('Audio playback not allowed or failed:', err);
  }
}

/**
 * Play a distinctive, urgent alert sound for critical / SOS events.
 */
export function playCriticalSiren(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(659.25, now + 0.12);
    osc.frequency.setValueAtTime(880, now + 0.24);
    osc.frequency.setValueAtTime(659.25, now + 0.36);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.5);
  } catch (err) {
    console.warn('Audio playback not allowed or failed:', err);
  }
}

/**
 * Trigger sound for an incoming real-time alert event.
 * Checks sound preferences and deduplicates by eventId.
 */
export function triggerAlertSound(eventId: string, severity: 'INFO' | 'WARNING' | 'CRITICAL' | 'EMERGENCY'): void {
  // Check user preference
  const settings = settingsService.get();
  if (!settings.notifications.soundAlerts) return;

  // Deduplicate
  if (playedEventIds.has(eventId)) return;
  playedEventIds.add(eventId);

  // Evict oldest if set grows too large
  if (playedEventIds.size > MAX_PLAYED_IDS) {
    const first = playedEventIds.values().next().value;
    if (first) playedEventIds.delete(first);
  }

  if (severity === 'CRITICAL' || severity === 'EMERGENCY') {
    playCriticalSiren();
  } else {
    playChime();
  }
}
