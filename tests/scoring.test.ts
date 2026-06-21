import { describe, expect, it } from "vitest";
import { aggregateRates, scoreRun } from "@/lib/metrics/scoring";

describe("GEO scoring", () => {
  it("scores valid answer influence when answer mentions brand and evidence modules", () => {
    const score = scoreRun(
      {
        id: "run1",
        projectId: "p1",
        queryId: "q1",
        engineConfigId: "e1",
        samplingJobId: null,
        samplingBatchId: null,
        runAt: new Date(),
        repeatIndex: 0,
        status: "succeeded",
        answerText: "ExampleSaaS 支持 SOC2 Type II、SSO、SCIM 和审计日志，适合远程团队。",
        rawResponseUri: null,
        screenshotUri: null,
        failureReason: null,
        engineMetadata: null,
        answerAnalysis: null,
        answerAnalysisAt: null,
        answerAnalysisError: null,
        referenceFeatureAnalysis: null,
        referenceFeatureAnalysisAt: null,
        referenceFeatureAnalysisError: null,
        competitorReferenceFeatureAnalysis: null,
        competitorReferenceFeatureAnalysisAt: null,
        competitorReferenceFeatureAnalysisError: null,
        answerReferenceAnalysis: null,
        answerReferenceAnalysisAt: null,
        answerReferenceAnalysisError: null,
        parseVersion: "v1",
        sources: [],
        citations: [],
        competitorOccurrences: []
      },
      {
        id: "bp1",
        projectId: "p1",
        brandNames: "ExampleSaaS",
        productNames: "ExampleSaaS Enterprise",
        aliases: "示例协作云",
        customerGroups: null,
        description: null,
        brandUrls: null,
        forbiddenClaims: null,
        approvedClaims: null
      },
      [
        {
          id: "m1",
          snapshotId: "s1",
          moduleType: "trust_signal",
          title: "安全与合规",
          body: "ExampleSaaS 支持 SOC2 Type II、SSO、SCIM 和管理员审计日志。",
          locationPath: "block:1",
          factLevel: "medium",
          reviewStatus: "machine",
          confidence: 0.8
        }
      ]
    );
    expect(score.brandMentioned).toBe(true);
    expect(score.validAnswerInfluence).toBe(true);
    expect(score.absorptionScore).toBeGreaterThan(0.2);
  });

  it("records evidence hits at sentence submodule level", () => {
    const score = scoreRun(
      {
        id: "run2",
        projectId: "p1",
        queryId: "q1",
        engineConfigId: "e1",
        samplingJobId: null,
        samplingBatchId: null,
        runAt: new Date(),
        repeatIndex: 0,
        status: "succeeded",
        answerText: "ExampleSaaS 支持管理员审计日志，方便安全团队追溯操作。",
        rawResponseUri: null,
        screenshotUri: null,
        failureReason: null,
        engineMetadata: null,
        answerAnalysis: null,
        answerAnalysisAt: null,
        answerAnalysisError: null,
        referenceFeatureAnalysis: null,
        referenceFeatureAnalysisAt: null,
        referenceFeatureAnalysisError: null,
        competitorReferenceFeatureAnalysis: null,
        competitorReferenceFeatureAnalysisAt: null,
        competitorReferenceFeatureAnalysisError: null,
        answerReferenceAnalysis: null,
        answerReferenceAnalysisAt: null,
        answerReferenceAnalysisError: null,
        parseVersion: "v1",
        sources: [],
        citations: [],
        competitorOccurrences: []
      },
      {
        id: "bp1",
        projectId: "p1",
        brandNames: "ExampleSaaS",
        productNames: "ExampleSaaS Enterprise",
        aliases: "示例协作云",
        customerGroups: null,
        description: null,
        brandUrls: null,
        forbiddenClaims: null,
        approvedClaims: null
      },
      [
        {
          id: "m1",
          snapshotId: "s1",
          moduleType: "trust_signal",
          title: "安全与合规",
          body: "企业版支持 SSO。ExampleSaaS 支持管理员审计日志。",
          locationPath: "block:1",
          factLevel: "medium",
          reviewStatus: "machine",
          confidence: 0.8
        }
      ]
    );

    const evidenceJson = JSON.parse(score.evidenceJson) as {
      moduleHits: Array<{ id: string; parentModuleId: string; evidence: string }>;
    };
    expect(evidenceJson.moduleHits).toEqual([
      expect.objectContaining({
        id: "m1:sentence:2",
        parentModuleId: "m1",
        evidence: "ExampleSaaS 支持管理员审计日志。"
      })
    ]);
  });

  it("aggregates rates", () => {
    const result = aggregateRates([
      {
        sourceSelection: true,
        citationCoverage: true,
        brandMentioned: true,
        validAnswerInfluence: true,
        absorptionScore: 0.8,
        citationFaithfulness: 1,
        errorDescriptionScore: 0,
        competitorSubstitution: false,
        stabilitySignal: 1,
        evidenceJson: "{}"
      },
      {
        sourceSelection: false,
        citationCoverage: false,
        brandMentioned: false,
        validAnswerInfluence: false,
        absorptionScore: 0,
        citationFaithfulness: 0.5,
        errorDescriptionScore: 0,
        competitorSubstitution: true,
        stabilitySignal: 0,
        evidenceJson: "{}"
      }
    ]);
    expect(result.vair).toBe(0.5);
    expect(result.competitorSubstitutionRate).toBe(0.5);
  });
});
