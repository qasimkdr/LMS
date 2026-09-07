CREATE TABLE IF NOT EXISTS "StorageObject" (
  "id" TEXT NOT NULL,
  "schoolId" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "category" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StorageObject_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StorageObject_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "StorageObject_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "StorageObject_bucket_path_key" ON "StorageObject"("bucket","path");
CREATE INDEX IF NOT EXISTS "StorageObject_schoolId_category_createdAt_idx" ON "StorageObject"("schoolId","category","createdAt");