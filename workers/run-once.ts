import { PrismaClient } from "@prisma/client";
import { computeProjectMetrics } from "../lib/services/analysis";

const prisma = new PrismaClient();

async function main() {
  const projects = await prisma.project.findMany();
  for (const project of projects) {
    await computeProjectMetrics(project.id);
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
