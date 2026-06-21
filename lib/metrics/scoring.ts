import type { AnswerRun, BrandProfile, Citation, CompetitorOccurrence, EvidenceModule, Source } from "@prisma/client";
import { buildEvidenceSubmodules } from "@/lib/services/evidence-submodules";
import { clamp, containsAny, splitCsv } from "@/lib/utils";

export type RunWithParsed = AnswerRun & {
  sources: Source[];
  citations: Citation[];
  competitorOccurrences: CompetitorOccurrence[];
};

export type RunScore = {
  sourceSelection: boolean;
  citationCoverage: boolean;
  brandMentioned: boolean;
  validAnswerInfluence: boolean;
  absorptionScore: number;
  citationFaithfulness: number;
  errorDescriptionScore: number;
  competitorSubstitution: boolean;
  stabilitySignal: number;
  evidenceJson: string;
};

export function scoreRun(run: RunWithParsed, brandProfile: BrandProfile | null, modules: EvidenceModule[]): RunScore {
  const brandTerms = [...splitCsv(brandProfile?.brandNames), ...splitCsv(brandProfile?.productNames), ...splitCsv(brandProfile?.aliases)];
  const answer = run.answerText || "";
  const sourceSelection = run.sources.some((source) => containsAny(`${source.url} ${source.title}`, brandTerms));
  const citationCoverage = run.citations.some((citation) => containsAny(citation.claimText, brandTerms)) || sourceSelection;
  const brandMentioned = containsAny(answer, brandTerms);
  const evidenceUnits = modules.flatMap((module) => buildEvidenceSubmodules(module));
  const moduleHits = evidenceUnits
    .map((module) => {
      const titleHit = answer.toLowerCase().includes(module.parentTitle.toLowerCase().slice(0, 16));
      const bodyTerms = module.body
        .split(/[，。,.；;、\s]/)
        .filter((word) => word.length >= 3)
        .slice(0, 8);
      const hits = bodyTerms.filter((term) => answer.toLowerCase().includes(term.toLowerCase())).length;
      const weighted = (titleHit ? 0.35 : 0) + Math.min(hits / Math.max(bodyTerms.length, 1), 1) * 0.65;
      return {
        id: module.id,
        parentModuleId: module.parentModuleId,
        type: module.moduleType,
        title: module.parentTitle,
        evidence: module.body,
        score: clamp(weighted)
      };
    })
    .filter((hit) => hit.score >= 0.25);
  const typeWeights: Record<string, number> = {
    pricing: 1.2,
    specification: 1.15,
    comparison: 1.15,
    constraint: 1.15,
    trust_signal: 1.05,
    metric: 1.05
  };
  const weightedScore = moduleHits.reduce((sum, hit) => sum + hit.score * (typeWeights[hit.type] || 1), 0);
  const absorptionScore = clamp(weightedScore / Math.max(Math.min(evidenceUnits.length, 8), 1));
  const verifiable = run.citations.filter((citation) => citation.supportStatus !== "not_applicable");
  const supported = verifiable.filter((citation) => citation.supportStatus === "supported" || citation.supportStatus === "partially_supported");
  const citationFaithfulness = verifiable.length ? supported.length / verifiable.length : citationCoverage ? 0.5 : 1;
  const riskWords = ["错误", "无法", "不支持", "未知", "过期", "不确定", "可能不准确"];
  const errorDescriptionScore = riskWords.some((word) => answer.includes(word)) ? 0.2 : 0;
  const competitorSubstitution = run.competitorOccurrences.length > 0 && !brandMentioned;
  const validAnswerInfluence =
    (sourceSelection || citationCoverage || brandMentioned || absorptionScore >= 0.25) &&
    citationFaithfulness >= 0.5 &&
    errorDescriptionScore < 0.5;

  return {
    sourceSelection,
    citationCoverage,
    brandMentioned,
    validAnswerInfluence,
    absorptionScore,
    citationFaithfulness,
    errorDescriptionScore,
    competitorSubstitution,
    stabilitySignal: validAnswerInfluence ? 1 : 0,
    evidenceJson: JSON.stringify({ moduleHits })
  };
}

export function aggregateRates(scores: RunScore[]) {
  const n = Math.max(scores.length, 1);
  return {
    vair: scores.filter((score) => score.validAnswerInfluence).length / n,
    sourceSelectionRate: scores.filter((score) => score.sourceSelection).length / n,
    citationCoverageRate: scores.filter((score) => score.citationCoverage).length / n,
    absorptionScore: scores.reduce((sum, score) => sum + score.absorptionScore, 0) / n,
    errorDescriptionRate: scores.filter((score) => score.errorDescriptionScore >= 0.5).length / n,
    competitorSubstitutionRate: scores.filter((score) => score.competitorSubstitution).length / n,
    stabilityScore: scores.reduce((sum, score) => sum + score.stabilitySignal, 0) / n
  };
}
