import { useEffect, useState } from "react";

const STORAGE_KEY = "concors.files.sidebar-width";
export const DEFAULT_FILE_SIDEBAR_WIDTH = 320;
export function useFileSidebar() {
  const [open, setOpen] = useState(false);
  const [preferredWidth, setPreferredWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      return Number.isFinite(saved) && saved >= 240 && saved <= 560
        ? saved
        : DEFAULT_FILE_SIDEBAR_WIDTH;
    } catch {
      return DEFAULT_FILE_SIDEBAR_WIDTH;
    }
  });
  const [viewport, setViewport] = useState(window.innerWidth);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, String(preferredWidth));
      } catch {
        /* Keep the current width when storage is unavailable. */
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [preferredWidth]);
  const docked = viewport >= 1024;
  const maxWidth = docked ? Math.min(560, Math.floor(viewport * 0.45)) : Math.max(0, viewport - 48);
  const minWidth = Math.min(240, maxWidth);
  return {
    open,
    setOpen,
    docked,
    minWidth,
    maxWidth,
    width: Math.min(preferredWidth, maxWidth),
    resize: (width: number) =>
      setPreferredWidth(Math.round(Math.max(minWidth, Math.min(maxWidth, width)))),
    close: () => {
      setOpen(false);
      document.getElementById("toggle-project-files")?.focus({ preventScroll: true });
    },
  };
}
export type FileSidebarState = ReturnType<typeof useFileSidebar>;
