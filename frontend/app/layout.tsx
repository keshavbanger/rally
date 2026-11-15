import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Providers } from './providers';
import './globals.css';
import { cn } from "@/lib/utils";

const inter = localFont({
  src: [
    {
      path: '../public/fonts/Inter-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../public/fonts/Inter-Medium.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../public/fonts/Inter-SemiBold.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../public/fonts/Inter-Bold.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-inter',
  display: 'swap',
});

const instrumentSerif = localFont({
  src: [
    {
      path: '../public/fonts/InstrumentSerif-Regular.ttf',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../public/fonts/InstrumentSerif-Italic.ttf',
      weight: '400',
      style: 'italic',
    },
  ],
  variable: '--font-instrument-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'RALLY — Real-Time Group Intelligence',
  description:
    'RALLY helps groups track location, safety, and progress with precision — real-time movement intelligence for safer journeys.',
  keywords: ['group intelligence', 'real-time movement', 'group safety', 'movement intelligence', 'separation detection', 'predictive risk'],
  openGraph: {
    title: 'RALLY — Real-Time Group Intelligence',
    description: 'Your group. One clear overview.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("scroll-smooth", inter.variable, instrumentSerif.variable, "font-sans")}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var raw = localStorage.getItem('rally:settings');
                  var theme = 'dark';
                  if (raw) {
                    var parsed = JSON.parse(raw);
                    if (parsed && parsed.appearance && parsed.appearance.theme) {
                      theme = parsed.appearance.theme;
                    }
                  }
                  var resolved = theme;
                  if (theme === 'system') {
                    resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                  }
                  if (resolved === 'dark') {
                    document.documentElement.classList.add('dark');
                    document.documentElement.classList.remove('light');
                    document.documentElement.style.colorScheme = 'dark';
                  } else {
                    document.documentElement.classList.remove('dark');
                    document.documentElement.classList.add('light');
                    document.documentElement.style.colorScheme = 'light';
                  }
                } catch (e) {
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body className="bg-background text-foreground min-h-screen antialiased font-sans selection:bg-rally-blue/20 selection:text-rally-blue">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
