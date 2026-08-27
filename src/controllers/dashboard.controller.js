const prisma = require('../utils/prisma')
const { rangeDiaBrasil } = require('../utils/data')

const resumoHoje = async (req, res, next) => {
  try {
    const { gte: hoje, lt: amanha } = rangeDiaBrasil()
    const em24h = new Date(Date.now() + 24 * 60 * 60 * 1000)
    // Pedido tem unidadeId/terceirizadaId direto; Ponto só tem unidadeId direto, então o
    // escopo por terceirizada precisa passar pela relação com o pedido.
    let wherePedido = {}
    let wherePonto = {}
    if (req.usuario.role === 'GERENTE') {
      wherePedido = { unidadeId: req.usuario.unidadeId }
      wherePonto = { unidadeId: req.usuario.unidadeId }
    } else if (req.usuario.role === 'TERCEIRO') {
      wherePedido = { terceirizadaId: req.usuario.terceirizadaId }
      wherePonto = { pedido: { terceirizadaId: req.usuario.terceirizadaId } }
    }

    // Busca configuração de valor
    let config = await prisma.configuracao.findFirst()
    if (!config) config = await prisma.configuracao.create({ data: { valorDiaria: 180 } })
    const valorDiaria = config.valorDiaria

    const [pedidosHoje, totalPontos, pontosAbertos, totalUnidades, pedidosPendentesTotal, pontosAbertosTotal] = await Promise.all([
      prisma.pedido.findMany({ where: { ...wherePedido, data: { gte: hoje, lt: amanha } }, select: { status: true, qtdVigiaDia: true, qtdVigiNoite: true } }),
      prisma.ponto.count({ where: { ...wherePonto, horario: { gte: hoje, lt: amanha } } }),
      prisma.ponto.count({ where: { ...wherePonto, horario: { gte: hoje, lt: amanha }, status: 'ABERTO' } }),
      prisma.unidade.count({ where: { ativo: true } }),
      // Pendências usadas pro lembrete sonoro de confirmação: pedidos com turno dentro de 24h
      // (inclui os já vencidos) — pedido pra daqui alguns dias ainda não precisa alertar.
      prisma.pedido.count({ where: { ...wherePedido, status: 'PENDENTE', data: { lte: em24h } } }),
      prisma.ponto.count({ where: { ...wherePonto, status: 'ABERTO' } })
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
