-- AlterTable
ALTER TABLE "Deployment" ADD COLUMN "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_projectId_externalId_key" ON "Deployment"("projectId", "externalId");
