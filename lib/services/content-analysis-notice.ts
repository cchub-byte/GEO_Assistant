export const contentAnalysisNoticeCookieName = "geo_content_analysis_notice";

export const contentAnalysisNoticeValues = ["created", "updated"] as const;

export type ContentAnalysisNotice = (typeof contentAnalysisNoticeValues)[number];

export function isContentAnalysisNotice(value: string | undefined): value is ContentAnalysisNotice {
  return contentAnalysisNoticeValues.includes(value as ContentAnalysisNotice);
}
