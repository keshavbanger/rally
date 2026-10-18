"use client";

import { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/lib/theme/ThemeProvider";

interface ThemeToggleProps {
  className?: string;
  variant?: "icon" | "pill" | "dropdown";
}

export default function ThemeToggle({ className = "", variant = "icon" }: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === "dark";

  const toggleTheme = () => {
    // If currently dark, switch to light; if light, switch to dark.
    setTheme(isDark ? "light" : "dark");
  };

  if (!mounted) {
    // Skeleton placeholder to prevent SSR layout mismatch
    return (
      <div
        className={}
        aria-hidden="true"
      >
        <span className="w-4 h-4 rounded-full bg-muted animate-pulse" />
      </div>
    );
  }

  if (variant === "pill") {
    return (
      <div
        className={}
        role="group"
        aria-label="Theme toggle"
      >
        <button
          type="button"
          onClick={() => setTheme("light")}
          aria-pressed={!isDark}
          aria-label="Switch to Light theme"
          className={}
        >
          <Sun className="w-3.5 h-3.5 text-amber-500" />
          <span>Light</span>
        </button>
        <button
          type="button"
          onClick={() => setTheme("dark")}
          aria-pressed={isDark}
          aria-label="Switch to Dark theme"
          className={}
        >
          <Moon className="w-3.5 h-3.5 text-rally-blue" />
          <span>Dark</span>
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
      title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
      className={}
    >
      {isDark ? (
        <Sun className="w-4 h-4 text-amber-400 hover:rotate-45 transition-transform duration-300" />
      ) : (
        <Moon className="w-4 h-4 text-rally-blue-secondary hover:-rotate-12 transition-transform duration-300" />
      )}
      <span className="sr-only">
        {isDark ? "Currently Dark mode. Switch to Light mode." : "Currently Light mode. Switch to Dark mode."}
      </span>
    </button>
  );
}
