export type CompetitorInput = {
  name: string;
  customerGroups?: string;
  description?: string;
  website?: string;
};

export function parseCompetitorInput(value: string): CompetitorInput[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCompetitorLine)
    .filter((item): item is CompetitorInput => Boolean(item));
}

export function formatCompetitorInput(
  competitors: Array<{ name: string; customerGroups?: string | null; description?: string | null; website?: string | null }>
) {
  return competitors
    .map((competitor) =>
      [
        competitor.name,
        competitor.customerGroups || "",
        competitor.description || "",
        competitor.website || ""
      ].map(formatCompetitorField).join(", ")
    )
    .join("\n");
}

function parseCompetitorLine(line: string): CompetitorInput | null {
  const [name = "", customerGroups = "", description = "", ...websiteParts] = line
    .split(/[,，]/)
    .map((item) => item.trim());
  const normalizedName = name.trim();
  if (!normalizedName) return null;

  return {
    name: normalizedName,
    customerGroups: customerGroups.trim() || undefined,
    description: description.trim() || undefined,
    website: websiteParts.join(",").trim() || undefined
  };
}

function formatCompetitorField(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}
