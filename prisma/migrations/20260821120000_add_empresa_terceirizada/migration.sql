-- CreateTable
CREATE TABLE "EmpresaTerceirizada" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "valorHora" DOUBLE PRECISION NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmpresaTerceirizada_pkey" PRIMARY KEY ("id")
);

-- AlterTable (coluna opcional — pedidos existentes ficam com NULL, sem quebrar nada)
ALTER TABLE "Pedido" ADD COLUMN "terceirizadaId" TEXT;

-- CreateIndex
CREATE INDEX "Pedido_terceirizadaId_idx" ON "Pedido"("terceirizadaId");

-- AddForeignKey (SET NULL: remover uma terceirizada não apaga os pedidos ligados a ela)
ALTER TABLE "Pedido" ADD CONSTRAINT "Pedido_terceirizadaId_fkey" FOREIGN KEY ("terceirizadaId") REFERENCES "EmpresaTerceirizada"("id") ON DELETE SET NULL ON UPDATE CASCADE;
