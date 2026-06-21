import { PrismaClient } from "@prisma/client";
import { computeProjectMetrics, createTasksFromFindings, generateAlerts, generateFindings, generateReport, refreshAuthority } from "../lib/services/analysis";

const prisma = new PrismaClient();

async function main() {
  const projects = await prisma.project.findMany();
  for (const project of projects) {
    await computeProjectMetrics(project.id);
    await generateFindings(project.id);
    await createTasksFromFindings(project.id);
    await refreshAuthority(project.id);
    await generateAlerts(project.id);
    await generateReport(project.id, "weekly");
    console.log(`Worker refreshed ${project.name}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

