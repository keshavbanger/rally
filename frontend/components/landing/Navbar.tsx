'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { 
  ChevronDown, 
  MapPin, 
  Bell, 
  Route, 
  HeartPulse, 
  Activity, 
  Book, 
  HelpCircle, 
  Mail, 
  Github, 
  Menu, 
  X 
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { usePathname } from 'next/navigation';

const PRODUCT_ITEMS = [
  { title: 'Live Tracking', description: 'Real-time location sharing for every member.', icon: MapPin, href: '/product/live-tracking' },
  { title: 'Smart Alerts', description: 'Know when something needs attention.', icon: Bell, href: '/product/smart-alerts' },
  { title: 'Route Intelligence', description: 'Understand routes, movement and deviations.', icon: Route, href: '/product/route-intelligence' },
  { title: 'Group Health', description: 'See the overall safety condition of your group.', icon: HeartPulse, href: '/product/group-health' },
  { title: 'Trip Analytics', description: 'Review what happened during the journey.', icon: Activity, href: '/product/analytics' },
];

const RESOURCE_ITEMS = [
  { title: 'Documentation', description: 'Learn how RALLY works.', icon: Book, href: '/docs' },
  { title: 'FAQ', description: 'Common questions about RALLY.', icon: HelpCircle, href: '/faq' },
  { title: 'Contact', description: 'Get in touch with the team.', icon: Mail, href: '/contact' },
  { title: 'GitHub', description: 'View the project.', icon: Github, href: 'https://github.com/keshavbanger/rally' },
];

function DesktopDropdownItem({ item }: { item: any }) {
  return (
    <Link href={item.href} className="flex items-start gap-3 p-3 rounded-xl hover:bg-muted transition-colors group">
      <div className="mt-0.5 w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground group-hover:text-foreground transition-colors shrink-0">
        <item.icon className="w-4 h-4" />
      </div>
      <div>
        <div className="text-[14px] font-medium text-foreground">{item.title}</div>
        <div className="text-[13px] text-muted-foreground mt-0.5 leading-snug">{item.description}</div>
      </div>
    </Link>
  );
}

function MobileNavItem({ title, children, href, onClick }: { title: string, children?: React.ReactNode, href?: string, onClick?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  
  if (href) {
    return (
      <Link href={href} onClick={onClick} className="block py-4 text-lg font-medium text-foreground/80 hover:text-foreground border-b border-border">
        {title}
      </Link>
    );
  }
  
  return (
    <div className="border-b border-border">
      <button onClick={() => setExpanded(!expanded)} className="w-full py-4 flex items-center justify-between text-lg font-medium text-foreground/80 hover:text-foreground">
        {title}
        <ChevronDown className={`w-5 h-5 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="pb-4 flex flex-col gap-3 pl-2">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout>();
  const pathname = usePathname();

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  const handleMouseEnter = (dropdown: string) => {
    clearTimeout(timeoutRef.current);
    setActiveDropdown(dropdown);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setActiveDropdown(null);
    }, 150);
  };

  // Close dropdown on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveDropdown(null);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <header className="relative z-50 w-full h-[76px] flex items-center justify-center bg-background/80 dark:bg-black/10 backdrop-blur-md border-b border-border">
      <nav className="w-full max-w-[1280px] px-6 md:px-8 flex items-center justify-between h-full">
        {/* Logo */}
        <Link href="/" className="flex items-center" aria-label="RALLY Home">
          <img 
            src="/assets/new-rally-logo-transparent.png" 
            alt="RALLY" 
            className="h-8 w-auto object-contain opacity-90 hover:opacity-100 transition-opacity dark:filter-none [html:not(.dark)_&]:invert" 
          />
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-1 absolute left-1/2 -translate-x-1/2 h-full">
          {/* Home Link */}
          <Link href="/" className="flex items-center h-full px-4 text-[14.5px] font-medium text-muted-foreground hover:text-foreground transition-colors duration-200">
            Home
          </Link>

          {/* Product Dropdown */}
          <div 
            className="relative flex items-center h-full px-4"
            onMouseEnter={() => handleMouseEnter('product')}
            onMouseLeave={handleMouseLeave}
          >
            <button className={`flex items-center gap-1.5 text-[14.5px] font-medium transition-colors duration-200 ${activeDropdown === 'product' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              Product
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${activeDropdown === 'product' ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
              {activeDropdown === 'product' && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                  className="absolute top-full left-1/2 -translate-x-1/2 pt-2"
                >
                  <div className="w-[600px] lg:w-[700px] bg-card/95 backdrop-blur-xl border border-border rounded-[20px] shadow-2xl p-4 flex gap-4 text-left">
                    <div className="flex-1 grid grid-cols-2 gap-x-2 gap-y-1">
                      {PRODUCT_ITEMS.map((item) => (
                        <DesktopDropdownItem key={item.title} item={item} />
                      ))}
                    </div>
                    <div className="w-[240px] lg:w-[280px] rounded-xl bg-gradient-to-br from-muted/50 to-transparent border border-border p-4 relative overflow-hidden flex flex-col shrink-0">
                      <div className="text-[13px] font-medium text-foreground mb-3">Live Environment</div>
                      <div className="flex-1 rounded-lg bg-background/50 border border-border relative overflow-hidden shadow-inner">
                        {/* Abstract map representation */}
                        <div className="absolute top-1/2 left-[30%] w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,1)]" />
                        <div className="absolute top-[35%] left-[65%] w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,1)]" />
                        <svg className="absolute inset-0 w-full h-full opacity-[0.15]" preserveAspectRatio="none">
                          <path d="M 30% 50% Q 50% 20% 65% 35%" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 4" fill="none" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Safety Link */}
          <Link href="/safety" className="flex items-center h-full px-4 text-[14.5px] font-medium text-muted-foreground hover:text-foreground transition-colors duration-200">
            Safety
          </Link>

          {/* Resources Dropdown */}
          <div 
            className="relative flex items-center h-full px-4"
            onMouseEnter={() => handleMouseEnter('resources')}
            onMouseLeave={handleMouseLeave}
          >
            <button className={`flex items-center gap-1.5 text-[14.5px] font-medium transition-colors duration-200 ${activeDropdown === 'resources' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              Resources
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${activeDropdown === 'resources' ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
              {activeDropdown === 'resources' && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                  className="absolute top-full left-1/2 -translate-x-1/2 pt-2"
                >
                  <div className="w-[340px] bg-card/95 backdrop-blur-xl border border-border rounded-[16px] shadow-2xl p-2 text-left">
                    <div className="flex flex-col gap-1">
                      {RESOURCE_ITEMS.map((item) => (
                        <DesktopDropdownItem key={item.title} item={item} />
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Demo Link */}
          <Link href="/demo" className="flex items-center h-full px-4 text-[14.5px] font-medium text-muted-foreground hover:text-foreground transition-colors duration-200">
            Demo
          </Link>
        </div>

        {/* Desktop CTA Group */}
        <div className="hidden md:flex items-center gap-6">
          <Link href="/login" className="text-[14.5px] font-medium text-muted-foreground hover:text-foreground transition-colors duration-200">
            Sign In
          </Link>
          <Link href="/register" className="bg-foreground text-background px-5 py-2.5 rounded-[11px] text-[14.5px] font-medium hover:opacity-90 transition-all duration-200">
            Get Started
          </Link>
        </div>

        {/* Mobile Menu Toggle */}
        <button 
          className="md:hidden flex items-center text-foreground hover:text-foreground/80 transition-colors"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </nav>

      {/* Mobile Menu Panel */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="absolute top-full left-0 right-0 h-[calc(100vh-76px)] bg-card/98 backdrop-blur-2xl border-t border-border overflow-y-auto"
          >
            <div className="px-6 py-4 flex flex-col min-h-full">
              <div className="flex-1">
                <MobileNavItem title="Home" href="/" onClick={() => setMobileMenuOpen(false)} />
                <MobileNavItem title="Product">
                  {PRODUCT_ITEMS.map(item => (
                    <Link href={item.href} key={item.title} onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 py-2 text-muted-foreground hover:text-foreground">
                      <item.icon className="w-4 h-4" />
                      <span className="text-[15px]">{item.title}</span>
                    </Link>
                  ))}
                </MobileNavItem>
                <MobileNavItem title="Safety" href="/safety" onClick={() => setMobileMenuOpen(false)} />
                <MobileNavItem title="Resources">
                  {RESOURCE_ITEMS.map(item => (
                    <Link href={item.href} key={item.title} onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 py-2 text-muted-foreground hover:text-foreground">
                      <item.icon className="w-4 h-4" />
                      <span className="text-[15px]">{item.title}</span>
                    </Link>
                  ))}
                </MobileNavItem>
                <MobileNavItem title="Demo" href="/demo" onClick={() => setMobileMenuOpen(false)} />
              </div>
              
              <div className="mt-8 pt-8 border-t border-border flex flex-col gap-4 pb-8">
                <Link 
                  href="/login" 
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full py-3.5 text-center text-[15px] font-medium text-foreground bg-muted rounded-xl border border-border hover:bg-muted/80 transition-colors"
                >
                  Sign In
                </Link>
                <Link 
                  href="/register" 
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full py-3.5 text-center text-[15px] font-medium text-background bg-foreground rounded-xl hover:opacity-90 transition-colors"
                >
                  Get Started
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
