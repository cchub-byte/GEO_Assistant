"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function SamplingStatusRefresher({ enabled, intervalMs = 2000 }: { enabled: boolean; intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const intervalId = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(intervalId);
  }, [enabled, intervalMs, router]);

  return null;
}
