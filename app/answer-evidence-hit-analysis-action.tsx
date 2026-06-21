"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AnswerEvidenceHitAnalysisAction({
  projectId,
  selectedClusterIds,
  selectedBatchIds,
  selectedQueryIntentTypes
}: {
  projectId: string;
  selectedClusterIds: string[];
  selectedBatchIds: string[];
  selectedQueryIntentTypes: string[];
}) {
  const router = useRouter();
  const [analyzing, setAnalyzing] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function handleAnalyze() {
    if (analyzing) return;
    setStatus("");
    setError("");
    setAnalyzing(true);
    try {
      const response = await fetch("/api/answer-analysis/evidence-hit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          clusterIds: selectedClusterIds,
          batchIds: selectedBatchIds,
          queryIntentTypes: selectedQueryIntentTypes
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        analyzedCount?: number;
        matchedCount?: number;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || `分析失败：HTTP ${response.status}`);
      setStatus(`已分析 ${payload.analyzedCount || 0} 条品牌优点，命中 ${payload.matchedCount || 0} 条证据`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "答案证据命中分析失败");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="actions answer-evidence-analysis-action">
      <button type="button" onClick={handleAnalyze} disabled={analyzing}>
        {analyzing ? "分析中..." : "分析"}
      </button>
      {analyzing ? (
        <span className="reference-analysis-status" role="status" aria-live="polite">
          正在分析品牌优点是否命中内容资产证据。
        </span>
      ) : null}
      {status ? (
        <span className="reference-analysis-status reference-analysis-status-complete" role="status">
          {status}
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
