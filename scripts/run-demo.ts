import { PrismaClient } from "@prisma/client";
import { runFullDemoPipeline } from "../lib/services/pipeline";

const prisma = new PrismaClient();

async function main() {
  const project = await prisma.project.findFirst({ orderBy: { createdAt: "asc" } });
  if (!project) {
    throw new Error("No project found. Run `npm run seed` first.");
  }
  await runFullDemoPipeline(project.id);
  console.log(`Demo pipeline completed for project: ${project.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

