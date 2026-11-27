import { notFound } from 'next/navigation';
import MultiUserSimulator from '@/components/dev/MultiUserSimulator';

export const dynamic = 'force-dynamic';

export default function DevSimulatorPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <MultiUserSimulator />;
}

