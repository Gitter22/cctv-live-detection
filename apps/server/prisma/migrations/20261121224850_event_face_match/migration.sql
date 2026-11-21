-- DropIndex
DROP INDEX "face_samples_embedding_idx";

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "facePersonId" UUID,
ADD COLUMN     "faceSimilarity" DOUBLE PRECISION;
