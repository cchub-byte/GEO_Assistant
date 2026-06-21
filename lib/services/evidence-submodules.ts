export type EvidenceModuleLike = {
  id: string;
  moduleType: string;
  title: string;
  body: string;
  locationPath: string;
  confidence?: number | null;
};

export type EvidenceSubmodule = {
  id: string;
  parentModuleId: string;
  moduleType: string;
  parentTitle: string;
  title: string;
  body: string;
  locationPath: string;
  sentenceIndex: number;
  confidence?: number | null;
};

export function buildEvidenceSubmodules(module: EvidenceModuleLike): EvidenceSubmodule[] {
  const sentences = splitEvidenceTextIntoSentences(module.body);
  const bodies = sentences.filter(isEvidenceSentence);

  return bodies.map((body, index) => ({
    id: `${module.id}:sentence:${index + 1}`,
    parentModuleId: module.id,
    moduleType: module.moduleType,
    parentTitle: module.title.trim(),
    title: `${module.title.trim()} / 证据 ${index + 1}`,
    body,
    locationPath: `${module.locationPath}/sentence:${index + 1}`,
    sentenceIndex: index + 1,
    confidence: module.confidence
  }));
}

export function isEvidenceSentence(sentence: string) {
  const text = cleanEvidenceLine(sentence);
  if (!text) return false;
  if (/[:：]\s*$/.test(text)) return false;
  if (isIntroductorySentence(text)) return false;
  return hasEvidenceSignal(text);
}

export function splitEvidenceTextIntoSentences(text: string): string[] {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u3000/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!normalized) return [];

  const sentences: string[] = [];
  for (const line of normalized.split(/\n+/)) {
    const cleanedLine = cleanEvidenceLine(line);
    if (!cleanedLine) continue;
    sentences.push(...splitEvidenceLine(cleanedLine));
  }

  return dedupeSentences(sentences);
}

function splitEvidenceLine(line: string) {
  const parts = line.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [line];
  return parts
    .map((part) => cleanEvidenceLine(part))
    .filter((part) => part.length > 0);
}

function cleanEvidenceLine(line: string) {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|[（(]?\d+[）)]\s+|[一二三四五六七八九十]+[、.．]\s*)/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isIntroductorySentence(text: string) {
  return [
    /^(?:以下|下面|本文|本页|本节|本段|该部分|这一部分)/,
    /(?:如下|如下所示|具体如下|包括以下|包含以下|主要包括|主要分为|分为以下|包含如下|包括如下)[。.!?]?$/,
    /(?:特征|特色|特点|能力|功能|模块|工具|方案|服务|项目|内容)[：:]?$/
  ].some((pattern) => pattern.test(text));
}

function hasEvidenceSignal(text: string) {
  if (/[0-9０-９]|SOC\s*\d?|ISO\s*\d?|TOP\s*\d?|Type\s*[IⅤVX]+/i.test(text)) return true;
  return /支持|提供|实现|具备|涵盖|覆盖|集成|采用|满足|适合|包含|包括|连接|致力于|帮助|助力|获得|荣获|被评为|参与|设立|构建|部署|对接|导出|审核|监管|核算|收款|定制|加密|审计|溯源|适配|应用于|服务于|面向|专为|确保|提升|降低|减少|允许|可/.test(text);
}

function dedupeSentences(sentences: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const sentence of sentences) {
    const normalized = sentence.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(sentence);
  }
  return result;
}
