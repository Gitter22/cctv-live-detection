-- CreateTable
CREATE TABLE "people" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "face_samples" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "embedding" vector(128) NOT NULL,
    "sourceEventId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "face_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "people_organizationId_idx" ON "people"("organizationId");

-- CreateIndex
CREATE INDEX "face_samples_organizationId_idx" ON "face_samples"("organizationId");

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "face_samples" ADD CONSTRAINT "face_samples_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nearest-neighbour search on face embeddings (cosine). HNSW: fast, no training step.
CREATE INDEX "face_samples_embedding_idx" ON "face_samples" USING hnsw ("embedding" vector_cosine_ops);
