import { db } from './db';

/**
 * Face matching with pgvector (cosine). SFace's published same-person threshold is ~0.363
 * cosine similarity; we use a stricter default so "known" really means confirmed. Anything
 * below is "unknown" = could not confirm (handover rule).
 */
export const FACE_MATCH_THRESHOLD = Number(process.env.FACE_MATCH_THRESHOLD ?? 0.42);

export const toVector = (embedding: number[]) => `[${embedding.map((v) => (Number.isFinite(v) ? v : 0)).join(',')}]`;

export interface FaceMatch {
  personId: string;
  similarity: number;
}

/** Best enrolled match in the organization, or null if none reaches the threshold. */
export async function matchFace(organizationId: string, embedding: number[], threshold = FACE_MATCH_THRESHOLD): Promise<FaceMatch | null> {
  const rows = await db.$queryRaw<{ personId: string; similarity: number }[]>`
    SELECT "personId", 1 - (embedding <=> ${toVector(embedding)}::vector) AS similarity
    FROM face_samples
    WHERE "organizationId" = ${organizationId}::uuid
    ORDER BY embedding <=> ${toVector(embedding)}::vector
    LIMIT 1`;
  const best = rows[0];
  return best && best.similarity >= threshold ? { personId: best.personId, similarity: Number(best.similarity) } : null;
}

export async function addFaceSample(organizationId: string, personId: string, embedding: number[], sourceEventId: string | null) {
  await db.$executeRaw`
    INSERT INTO face_samples (id, "organizationId", "personId", embedding, "sourceEventId")
    VALUES (gen_random_uuid(), ${organizationId}::uuid, ${personId}::uuid, ${toVector(embedding)}::vector, ${sourceEventId}::uuid)`;
}
