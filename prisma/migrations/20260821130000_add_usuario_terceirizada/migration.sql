-- AlterTable (coluna opcional — usuários existentes ficam com NULL, sem quebrar nada)
ALTER TABLE "Usuario" ADD COLUMN "terceirizadaId" TEXT;

-- CreateIndex
CREATE INDEX "Usuario_terceirizadaId_idx" ON "Usuario"("terceirizadaId");

-- AddForeignKey (SET NULL: remover uma terceirizada não apaga o usuário ligado a ela)
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_terceirizadaId_fkey" FOREIGN KEY ("terceirizadaId") REFERENCES "EmpresaTerceirizada"("id") ON DELETE SET NULL ON UPDATE CASCADE;
