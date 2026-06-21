"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ProfileAnalysisRequestPayload = {
  scope: "dashboard" | "references";
  target: "brand" | "competitor";
  filters: Record<string, string | string[]>;
};

export function BrandProfileAnalysisAction({
  requestPayload,
  completed,
  label,
  loadingStatus
}: {
  requestPayload: ProfileAnalysisRequestPayload;
  completed: boolean;
  label: string;
  loadingStatus: string;
}) {
  const router = useRouter();
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");

  async function handleStartAnalysis() {
    if (analyzing) return;
    setError("");
    try {
      setAnalyzing(true);
      const response = await fetch("/api/profile-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || `分析请求失败：HTTP ${response.status}`);
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "分析请求失败");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="actions reference-analysis-action">
      {completed ? (
        <span className="reference-analysis-status reference-analysis-status-complete" role="status">
          分析完成，已保存存档
        </span>
      ) : null}
      <button
        type="button"
        className={completed ? "button secondary" : "button"}
        onClick={handleStartAnalysis}
        disabled={analyzing}
      >
        {analyzing ? "分析中..." : completed ? "重新分析" : label}
      </button>
      {analyzing ? (
        <span className="reference-analysis-status" role="status" aria-live="polite">
          {loadingStatus}
        </span>
      ) : null}
      {error ? (
        <span className="reference-analysis-status answer-analysis-error" role="status">
          {error}
        </span>
      ) : null}
    </div>
  );
}
