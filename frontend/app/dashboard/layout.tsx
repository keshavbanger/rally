'use client';

import Sidebar from '@/components/dashboard/Sidebar';
import BottomNav from '@/components/dashboard/BottomNav';
import SosButton from '@/components/dashboard/SosButton';
import RequireAuth from '@/components/dashboard/RequireAuth';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <div className="min-h-screen bg-background flex">
        <Sidebar />
        <div className="flex-1 min-w-0 pb-16 md:pb-0">{children}</div>
        <SosButton />
        <BottomNav />
      </div>
    </RequireAuth>
  );
}

