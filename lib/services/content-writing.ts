import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";

export type ContentWritingView = {
  id: string;
  projectId: string;
  title: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
};

type ContentWritingRow = {
  id: string;
  projectId: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export async function listContentWritings(projectId: string): Promise<ContentWritingView[]> {
  await ensureContentWritingTable();
  const rows = await prisma.$queryRaw<ContentWritingRow[]>`
    SELECT "id", "projectId", "title", "body", "createdAt", "updatedAt"
    FROM "ContentWriting"
    WHERE "projectId" = ${projectId}
    ORDER BY datetime("updatedAt") DESC, datetime("createdAt") DESC
  `;
  return rows.map(normalizeContentWritingRow);
}

export async function createContentWriting(input: {
  projectId: string;
  title: string;
  body: string;
}) {
  await ensureContentWritingTable();
  const now = new Date().toISOString();
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO "ContentWriting" ("id", "projectId", "title", "body", "createdAt", "updatedAt")
    VALUES (${id}, ${input.projectId}, ${input.title}, ${input.body}, ${now}, ${now})
  `;
  return id;
}

export async function updateContentWriting(input: {
  id: string;
  title: string;
  body: string;
}) {
  await ensureContentWritingTable();
  const now = new Date().toISOString();
  await prisma.$executeRaw`
    UPDATE "ContentWriting"
    SET "title" = ${input.title}, "body" = ${input.body}, "updatedAt" = ${now}
    WHERE "id" = ${input.id}
  `;
}

export async function deleteContentWriting(id: string) {
  await ensureContentWritingTable();
  await prisma.$executeRaw`
    DELETE FROM "ContentWriting"
    WHERE "id" = ${id}
  `;
}

async function ensureContentWritingTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS "ContentWriting" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "projectId" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "body" TEXT NOT NULL DEFAULT '',
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL
    )
  `;
  await prisma.$executeRaw`
    CREATE INDEX IF NOT EXISTS "ContentWriting_project_updated_idx"
    ON "ContentWriting" ("projectId", "updatedAt")
  `;
}

function normalizeContentWritingRow(row: ContentWritingRow): ContentWritingView {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    body: row.body,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt)
  };
}
