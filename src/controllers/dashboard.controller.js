const prisma = require('../utils/prisma')
const { rangeDiaBrasil } = require('../utils/data')
const { unidadesDoParceiro } = require('../utils/parceiro')

const resumoHoje = async (req, res, next) => {
  try {
    const { gte: hoje, lt: amanha } = rangeDiaBrasil()
    let where = {}
    if (req.usuario.role === 'GERENTE') where = { unidadeId: req.usuario.unidadeId }
    else if (req.usuario.role === 'TERCEIRO') where = { unidadeId: { in: await unidadesDoParceiro(req.usuario.id) } }

    // Busca configuração de valor
    let config = await prisma.configuracao.findFirst()
    if (!config) config = await prisma.configuracao.create({ data: { valorDiaria: 180 } })
    const valorDiaria = config.valorDiaria

    const [pedidosHoje, totalPontos, pontosAbertos, totalUnidades, pedidosPendentesTotal, pontosAbertosTotal] = await Promise.all([
      prisma.pedido.findMany({ where: { ...where, data: { gte: hoje, lt: amanha } }, select: { status: true, qtdVigiaDia: true, qtdVigiNoite: true } }),
      prisma.ponto.count({ where: { ...where, horario: { gte: hoje, lt: amanha } } }),
      prisma.ponto.count({ where: { ...where, horario: { gte: hoje, lt: amanha }, status: 'ABERTO' } }),
      prisma.unidade.count({ where: { ativo: true } }),
      // Pendências totais, sem filtro de data — usadas pro lembrete sonoro de confirmação
      prisma.pedido.count({ where: { ...where, status: 'PENDENTE' } }),
      prisma.ponto.count({ where: { ...where, status: 'ABERTO' } })
    ])

    const totalPedidos = pedidosHoje.length
    const pedidosPendentes = pedidosHoje.filter(p => p.status === 'PENDENTE').length
    const totalVigiasDia = pedidosHoje.reduce((s, p) => s + (p.qtdVigiaDia || 0), 0)
    const totalVigiasNoite = pedidosHoje.reduce((s, p) => s + (p.qtdVigiNoite || 0), 0)
    const totalVigias = totalVigiasDia + totalVigiasNoite
    const custoEstimado = totalVigias * 12 * valorDiaria

    res.json({
      totalPedidos, pedidosPendentes, totalPontos, pontosAbertos,
      totalUnidades, totalVigias, totalVigiasDia, totalVigiasNoite,
      custoEstimado, valorDiaria, pedidosPendentesTotal, pontosAbertosTotal
    })
  } catch (err) { next(err) }
}

module.exports = { resumoHoje }
