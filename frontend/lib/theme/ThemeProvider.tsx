"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { settingsService } from "@/lib/mock/settingsService";

type ThemeValue = "dark" | "light" | "system";

interface ThemeContextValue {
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

function getSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: ThemeValue): "dark" | "light" {
  if (theme === "system") return getSystemTheme();
  return theme;
}

export function applyTheme(resolved: "dark" | "light") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
    root.classList.remove("light");
  } else {
    root.classList.add("light");
    root.classList.remove("dark");
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeValue>("dark");

  useEffect(() => {
    const stored = settingsService.get().appearance.theme;
    setThemeState(stored);
    applyTheme(resolveTheme(stored));

    return settingsService.subscribe((s) => {
      const next = s.appearance.theme;
      setThemeState(next);
      applyTheme(resolveTheme(next));
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (settingsService.get().appearance.theme === "system") {
        applyTheme(getSystemTheme());
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const setTheme = useCallback((next: ThemeValue) => {
    settingsService.update({
      appearance: { ...settingsService.get().appearance, theme: next },
    });
  }, []);

  const resolvedTheme = resolveTheme(theme);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
