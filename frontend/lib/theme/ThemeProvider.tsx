"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { settingsService } from "@/lib/mock/settingsService";

export type ThemeValue = "dark" | "light" | "system";

export interface ThemeContextValue {
  theme: ThemeValue;
  resolvedTheme: "dark" | "light";
  setTheme: (theme: ThemeValue) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  resolvedTheme: "dark",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function getSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(theme: ThemeValue): "dark" | "light" {
  if (theme === "system") return getSystemTheme();
  return theme;
}

export function applyTheme(resolved: "dark" | "light") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
    root.classList.remove("light");
    root.style.colorScheme = "dark";
  } else {
    root.classList.add("light");
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeValue>("dark");
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">("dark");

  const updateResolved = useCallback((val: ThemeValue) => {
    const res = resolveTheme(val);
    setResolvedTheme(res);
    applyTheme(res);
  }, []);

  // Sync initial stored theme and subscribe to settingsService updates
  useEffect(() => {
    const stored = (settingsService.get().appearance.theme as ThemeValue) || "dark";
    setThemeState(stored);
    updateResolved(stored);

    return settingsService.subscribe((s) => {
      const next = (s.appearance.theme as ThemeValue) || "dark";
      setThemeState(next);
      updateResolved(next);
    });
  }, [updateResolved]);

  // Listen to OS-level prefers-color-scheme change events
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (e: MediaQueryListEvent) => {
      const current = settingsService.get().appearance.theme as ThemeValue;
      if (current === "system") {
        const sys = e.matches ? "dark" : "light";
        setResolvedTheme(sys);
        applyTheme(sys);
      }
    };

    if (mq.addEventListener) {
      mq.addEventListener("change", handleChange);
      return () => mq.removeEventListener("change", handleChange);
    } else {
      // Legacy fallback
      mq.addListener(handleChange);
      return () => mq.removeListener(handleChange);
    }
  }, []);

  const setTheme = useCallback(
    (next: ThemeValue) => {
      setThemeState(next);
      updateResolved(next);
      settingsService.update({
        appearance: { ...settingsService.get().appearance, theme: next },
      });
    },
    [updateResolved]
  );

  const contextValue = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}
