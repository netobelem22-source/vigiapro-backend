const prisma = require('../utils/prisma')
const { unidadesDoParceiro } = require('../utils/parceiro')
const { rangeDiaBrasil } = require('../utils/data')

const rangeData = (dataStr) => rangeDiaBrasil(dataStr)

const dataLocal = (dataStr) => {
  const [ano, mes, dia] = dataStr.split('-').map(Number)
  return new Date(ano, mes - 1, dia, 12, 0, 0)
}

const registrarHistorico = async (pedidoId, usuarioId, acao, detalhe) => {
  try {
    await prisma.historicoPedido.create({ data: { pedidoId, usuarioId, acao, detalhe } })
  } catch (e) { console.error('Erro histórico:', e.message) }
}

const listar = async (req, res, next) => {
  try {
    const { data, unidadeId, status, cidade, page, limit } = req.query
    const pg = Math.max(1, parseInt(page) || 1)
    const lim = Math.min(200, parseInt(limit) || 20)
    const where = {}
    if (req.usuario.role === 'GERENTE') where.unidadeId = req.usuario.unidadeId
    else if (req.usuario.role === 'TERCEIRO') where.unidadeId = { in: await unidadesDoParceiro(req.usuario.id) }
    else if (unidadeId) where.unidadeId = unidadeId
    if (data) where.data = rangeData(data)
    if (status) where.status = status
    if (cidade) where.unidade = { cidade: { contains: cidade, mode: 'insensitive' } }
    const [total, pedidos] = await Promise.all([
      prisma.pedido.count({ where }),
      prisma.pedido.findMany({
        where, include: { unidade: true, solicitante: true, terceirizada: true, pontos: { where: { status: { not: 'ABERTO' } } } },
        orderBy: { criadoEm: 'desc' },
        skip: (pg - 1) * lim,
        take: lim
      })
    ])
    res.json({ pedidos, total, pagina: pg, paginas: Math.max(1, Math.ceil(total / lim)) })
  } catch (err) { next(err) }
}

const criar = async (req, res, next) => {
  try {
    const { dataInicio, dataFim, turno, segmento, qtdVigiaDia, qtdVigiNoite, inicioTurnoDia, inicioTurnoNoite, fimTurnoDia, fimTurnoNoite, observacao, unidadeId, terceirizadaId } = req.body

    if (!terceirizadaId) return res.status(400).json({ erro: 'Selecione a empresa terceirizada' })

    const uid = unidadeId || req.usuario.unidadeId
    const inicio = dataLocal(dataInicio)
    const fim = dataLocal(dataFim || dataInicio)

    // Gera um pedido para cada dia do período
    const pedidos = []
    const atual = new Date(inicio)
    while (atual <= fim) {
      const dataStr = `${atual.getFullYear()}-${String(atual.getMonth()+1).padStart(2,'0')}-${String(atual.getDate()).padStart(2,'0')}`
      pedidos.push({
        data: dataLocal(dataStr),
        turno,
        segmento: segmento || 'LOJA',
        qtdVigiaDia: parseInt(qtdVigiaDia) || 0,
        qtdVigiNoite: parseInt(qtdVigiNoite) || 0,
        inicioTurnoDia, inicioTurnoNoite, fimTurnoDia, fimTurnoNoite, observacao,
        unidadeId: uid,
        terceirizadaId,
        solicitanteId: req.usuario.id,
        status: 'PENDENTE'
      })
      atual.setDate(atual.getDate() + 1)
    }

    // Cria todos os pedidos de uma vez
    const criados = await prisma.$transaction(
      pedidos.map(p => prisma.pedido.create({ data: p, include: { unidade: true, terceirizada: true } }))
    )

    // Registra histórico do primeiro para referência
    if (criados.length > 0) {
      const detalhe = criados.length === 1
        ? `Pedido criado para ${criados[0].unidade?.nome}`
        : `${criados.length} pedidos criados (${dataInicio} até ${dataFim || dataInicio}) para ${criados[0].unidade?.nome}`
      await registrarHistorico(criados[0].id, req.usuario.id, 'CRIADO', detalhe)
    }

    res.status(201).json({ criados: criados.length, pedidos: criados })
  } catch (err) { next(err) }
}

const buscar = async (req, res, next) => {
  try {
    const pedido = await prisma.pedido.findUnique({
      where: { id: req.params.id },
      include: {
        unidade: true, solicitante: true, terceirizada: true,
        pontos: { include: { vigia: true } },
        historico: { include: { usuario: true }, orderBy: { criadoEm: 'desc' } }
      }
    })
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' })
    if (req.usuario.role === 'GERENTE' && pedido.unidadeId !== req.usuario.unidadeId)
      return res.status(403).json({ erro: 'Acesso não permitido' })
    if (req.usuario.role === 'TERCEIRO' && !(await unidadesDoParceiro(req.usuario.id)).includes(pedido.unidadeId))
      return res.status(403).json({ erro: 'Acesso não permitido' })
    res.json(pedido)
  } catch (err) { next(err) }
}

const relatorioMensal = async (req, res, next) => {
  try {
    const mes = parseInt(req.query.mes) || new Date().getMonth() + 1
    const ano = parseInt(req.query.ano) || new Date().getFullYear()
    const inicio = new Date(ano, mes - 1, 1)
    const fim = new Date(ano, mes, 1)

    const where = { data: { gte: inicio, lt: fim } }
    if (req.usuario.role === 'GERENTE') where.unidadeId = req.usuario.unidadeId

    const pedidos = await prisma.pedido.findMany({
      where,
      select: {
        status: true, qtdVigiaDia: true, qtdVigiNoite: true,
        unidade: { select: { nome: true, cidade: true } }
      }
    })

    let confirmados = 0, pendentes = 0, totalVigiasDia = 0, totalVigiasNoite = 0
    const porUnidade = {}
    for (const p of pedidos) {
      if (p.status === 'CONFIRMADO') confirmados++
      if (p.status === 'PENDENTE') pendentes++
      totalVigiasDia += p.qtdVigiaDia || 0
      totalVigiasNoite += p.qtdVigiNoite || 0

      const nome = p.unidade?.nome || 'Sem unidade'
      if (!porUnidade[nome]) porUnidade[nome] = { nome, cidade: p.unidade?.cidade, pedidos: 0, vigiasDia: 0, vigiasNoite: 0 }
      porUnidade[nome].pedidos++
      porUnidade[nome].vigiasDia += p.qtdVigiaDia || 0
      porUnidade[nome].vigiasNoite += p.qtdVigiNoite || 0
    }

    res.json({
      mes, ano, total: pedidos.length, confirmados, pendentes, totalVigiasDia, totalVigiasNoite,
      porUnidade: Object.values(porUnidade).sort((a, b) => b.pedidos - a.pedidos)
    })
  } catch (err) { next(err) }
}

const atualizar = async (req, res, next) => {
  try {
    const { segmento, inicioTurnoDia, inicioTurnoNoite, fimTurnoDia, fimTurnoNoite, terceirizadaId } = req.body
    const atual = await prisma.pedido.findUnique({ where: { id: req.params.id } })
    if (!atual) return res.status(404).json({ erro: 'Pedido não encontrado' })
    if (req.usuario.role === 'GERENTE' && atual.unidadeId !== req.usuario.unidadeId)
      return res.status(403).json({ erro: 'Acesso não permitido' })
    if (atual.status === 'CANCELADO')
      return res.status(400).json({ erro: 'Pedido recusado não pode ser editado' })

    const data = {}
    if (segmento !== undefined) data.segmento = segmento
    if (inicioTurnoDia !== undefined) data.inicioTurnoDia = inicioTurnoDia
    if (inicioTurnoNoite !== undefined) data.inicioTurnoNoite = inicioTurnoNoite
    if (fimTurnoDia !== undefined) data.fimTurnoDia = fimTurnoDia
    if (fimTurnoNoite !== undefined) data.fimTurnoNoite = fimTurnoNoite
    if (terceirizadaId !== undefined) data.terceirizadaId = terceirizadaId

    const pedido = await prisma.pedido.update({ where: { id: req.params.id }, data, include: { unidade: true, terceirizada: true } })
    await registrarHistorico(pedido.id, req.usuario.id, 'EDITADO', 'Segmento/horário do pedido atualizados')
    res.json(pedido)
  } catch (err) { next(err) }
}

const atualizarStatus = async (req, res, next) => {
  try {
    const { status, motivo } = req.body
    if (status === 'CANCELADO' && !motivo?.trim())
      return res.status(400).json({ erro: 'Informe o motivo da recusa' })

    const atual = await prisma.pedido.findUnique({ where: { id: req.params.id } })
    if (!atual) return res.status(404).json({ erro: 'Pedido não encontrado' })
    if (req.usuario.role === 'GERENTE' && atual.unidadeId !== req.usuario.unidadeId)
      return res.status(403).json({ erro: 'Acesso não permitido' })
    if (req.usuario.role === 'TERCEIRO') {
      if (!(await unidadesDoParceiro(req.usuario.id)).includes(atual.unidadeId))
        return res.status(403).json({ erro: 'Acesso não permitido' })
      if (status !== 'CONFIRMADO')
        return res.status(403).json({ erro: 'Terceiros só podem confirmar pedidos' })
    }

    const pedido = await prisma.pedido.update({
      where: { id: req.params.id }, data: { status }, include: { unidade: true }
    })
    const detalhe = status === 'CANCELADO' ? `Recusado: ${motivo.trim()}` : `Status alterado para ${status}`
    await registrarHistorico(pedido.id, req.usuario.id, status, detalhe)
    res.json(pedido)
  } catch (err) { next(err) }
}

const confirmarTodos = async (req, res, next) => {
  try {
    const { data } = req.body
    const where = { status: 'PENDENTE' }
    if (data) where.data = rangeData(data)
    if (req.usuario.role === 'GERENTE') where.unidadeId = req.usuario.unidadeId

    const LIMITE_LOTE = 500
    const pendentes = await prisma.pedido.findMany({ where, include: { unidade: true }, take: LIMITE_LOTE })
    if (pendentes.length === 0) return res.json({ confirmados: 0 })

    await prisma.pedido.updateMany({ where: { id: { in: pendentes.map(p => p.id) } }, data: { status: 'CONFIRMADO' } })
    await Promise.all(pendentes.map(p => registrarHistorico(p.id, req.usuario.id, 'CONFIRMADO', 'Confirmado em lote')))

    res.json({ confirmados: pendentes.length, limitado: pendentes.length === LIMITE_LOTE })
  } catch (err) { next(err) }
}

const recusarTodos = async (req, res, next) => {
  try {
    const { unidadeId, dataInicio, dataFim, motivo } = req.body
    if (!unidadeId) return res.status(400).json({ erro: 'Selecione uma unidade' })
    if (!dataInicio || !dataFim) return res.status(400).json({ erro: 'Informe o período' })
    if (!motivo?.trim()) return res.status(400).json({ erro: 'Informe o motivo da recusa' })
    if (req.usuario.role === 'GERENTE' && unidadeId !== req.usuario.unidadeId)
      return res.status(403).json({ erro: 'Acesso não permitido' })

    const inicio = dataLocal(dataInicio)
    const fim = dataLocal(dataFim)
    if (fim < inicio) return res.status(400).json({ erro: 'Data final deve ser maior ou igual à inicial' })

    // Escopo obrigatório por unidade + período — evita recusar em massa sem querer
    const LIMITE_LOTE = 500
    const where = { unidadeId, data: { gte: inicio, lte: fim }, status: { not: 'CANCELADO' } }
    const pedidos = await prisma.pedido.findMany({ where, take: LIMITE_LOTE })
    if (pedidos.length === 0) return res.json({ recusados: 0 })

    await prisma.pedido.updateMany({ where: { id: { in: pedidos.map(p => p.id) } }, data: { status: 'CANCELADO' } })
    await Promise.all(pedidos.map(p => registrarHistorico(p.id, req.usuario.id, 'CANCELADO', `Recusado em lote: ${motivo.trim()}`)))

    res.json({ recusados: pedidos.length, limitado: pedidos.length === LIMITE_LOTE })
  } catch (err) { next(err) }
}

module.exports = { listar, criar, buscar, atualizar, atualizarStatus, confirmarTodos, recusarTodos, relatorioMensal }
