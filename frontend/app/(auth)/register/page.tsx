'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Chrome, Github, ArrowRight } from 'lucide-react';
import AuthHero from '@/components/auth/AuthHero';
import SocialButton from '@/components/auth/SocialButton';
import AuthInput from '@/components/auth/AuthInput';
import { useAuth } from '@/lib/auth/AuthProvider';
import { getSupabaseClient } from '@/lib/supabase/client';

const STEPS = [
  { number: 1, text: 'Create your account' },
  { number: 2, text: 'Create or join a Rally' },
  { number: 3, text: 'Track your journey live' },
];

/**
 * Maps raw Supabase / network error messages to short, user-friendly strings.
 * Never reveals whether an email address is already registered to an
 * unauthenticated caller — duplicate-email detection is handled via the
 * SignUpOutcome discriminated type in AuthProvider, not here.
 */
function mapSignUpError(raw: string): string {
  const msg = raw.toLowerCase();
  if (msg.includes('password') && (msg.includes('short') || msg.includes('weak') || msg.includes('characters'))) {
    return 'Password must be at least 8 characters.';
  }
  if (msg.includes('email') && msg.includes('invalid')) {
    return 'Please enter a valid email address.';
  }
  if (msg.includes('rate limit') || msg.includes('too many')) {
    return 'Too many attempts — please wait a moment and try again.';
  }
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  // Don't expose Supabase internal messages verbatim.
  return 'Something went wrong. Please try again.';
}

export default function RegisterPage() {
  const router = useRouter();
  const { signUpWithPassword } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Separate error (red) and info (neutral/green) banners so a successful
  // signup asking for email confirmation is never shown in a red error box.
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const handleOAuth = async (provider: 'google' | 'github') => {
    await getSupabaseClient().auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/create-group`
      }
    });
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    setInfo('');

    const fullName = `${firstName} ${lastName}`.trim();
    const outcome = await signUpWithPassword(email, password, fullName || undefined);

    switch (outcome.status) {
      case 'session_ready':
        // Email confirmation is disabled — user is immediately signed in.
        // Navigate to onboarding.
        router.push('/create-group');
        return; // keep loading spinner while navigating

      case 'confirm_email':
        // New user (or existing user with email-confirm ON — same message,
        // intentionally: don't leak whether the address is registered).
        setInfo('Account created! Check your inbox for a confirmation email, then log in.');
        setLoading(false);
        break;

      case 'duplicate':
        // Email-confirm is OFF and Supabase explicitly rejected the signup.
        // This is the one case we can safely be specific about.
        setError('An account with that email already exists. Try logging in instead.');
        setLoading(false);
        break;

      case 'error':
        setError(mapSignUpError(outcome.error));
        setLoading(false);
        break;
    }
  };

  return (
    <main className="flex min-h-screen w-full bg-background selection:bg-white/30 p-2 lg:h-screen lg:overflow-hidden lg:p-4 transition-all duration-500">
      <AuthHero
        heading="Join RALLY"
        subtitle="Follow these steps to get your group moving."
        steps={STEPS}
        activeStep={1}
      />

      <div className="flex-1 flex flex-col items-center justify-center py-12 lg:py-6 px-4 sm:px-12 lg:px-16 xl:px-24 overflow-y-auto lg:overflow-hidden">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="w-full max-w-xl space-y-8 lg:space-y-6 sm:space-y-10"
        >
          <Link href="/" className="lg:hidden inline-flex items-center">
            <img
              src="/assets/new-rally-logo-transparent.png"
              alt="RALLY"
              className="h-7.5 w-auto object-contain opacity-90 hover:opacity-100 transition-opacity"
            />
          </Link>

          <div>
            <h2 className="text-3xl font-medium tracking-tight text-foreground">Create your account</h2>
            <p className="text-muted-foreground text-sm mt-1.5">Set up your profile to start or join a Rally.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <SocialButton icon={Chrome} label="Google" onClick={() => handleOAuth('google')} />
            <SocialButton icon={Github} label="Github" onClick={() => handleOAuth('github')} />
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-background px-4 text-xs font-medium text-muted-foreground uppercase tracking-widest">
                Or
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Error banner — only for genuine failures */}
            {error && (
              <p role="alert" className="text-red-500 text-sm">
                {error}
              </p>
            )}
            {/* Info banner — for successful actions that need a follow-up step */}
            {info && (
              <p role="status" className="text-green-500 text-sm">
                {info}
              </p>
            )}
            <div className="grid grid-cols-2 gap-4">
              <AuthInput label="First Name" value={firstName} onChange={setFirstName} placeholder="Alex" required />
              <AuthInput label="Last Name" value={lastName} onChange={setLastName} placeholder="Rivera" required />
            </div>
            <AuthInput label="Email" type="email" value={email} onChange={setEmail} placeholder="alex@rally.app" required />
            <AuthInput
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              required
              helperText="Requires at least 8 characters."
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full h-14 bg-foreground text-background font-semibold rounded-full hover:bg-white/90 active:scale-[0.98] transition-all mt-4 flex items-center justify-center gap-2 disabled:opacity-70"
            >
              {loading ? 'Creating Account…' : 'Create Account'}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="font-semibold text-foreground hover:underline">
              Log in
            </Link>
          </p>
        </motion.div>
      </div>
    </main>
  );
}
