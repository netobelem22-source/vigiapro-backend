const prisma = require('../utils/prisma')

// campos enxutos para o papel TERCEIRO: sem diária, sem funcionários, sem dados da empresa cliente
const CAMPOS_PARCEIRO = { id: true, nome: true, endereco: true, cidade: true, estado: true, latitude: true, longitude: true, raioGps: true }

// Unidades que aparecem em pedidos já atribuídos à empresa terceirizada do usuário —
// não é mais um vínculo fixo, é dinâmico conforme os pedidos recebidos.
const unidadesDaTerceirizada = async (terceirizadaId) => {
  if (!terceirizadaId) return []
  const pedidos = await prisma.pedido.findMany({ where: { terceirizadaId }, select: { unidadeId: true }, distinct: ['unidadeId'] })
  return pedidos.map(p => p.unidadeId)
}

const listar = async (req, res, next) => {
  try {
    const { busca, semGps, page, limit } = req.query
    const pg = Math.max(1, parseInt(page) || 1)
    // Teto alto o bastante pra "buscar todas" (dropdowns) não cortar silenciosamente
    // conforme o número de unidades cresce; a tela paginada sempre pede um limit pequeno (24).
    const lim = Math.min(1000, parseInt(limit) || 24)
    const skip = (pg - 1) * lim

    const buscaWhere = busca ? {
      OR: [
        { nome: { contains: busca, mode: 'insensitive' } },
        { cidade: { contains: busca, mode: 'insensitive' } }
      ]
    } : {}
    const semGpsWhere = semGps === 'true' ? { latitude: null } : {}

    if (req.usuario.role === 'TERCEIRO') {
      const where = { ativo: true, id: { in: await unidadesDaTerceirizada(req.usuario.terceirizadaId) }, ...buscaWhere, ...semGpsWhere }
      const [total, unidades] = await Promise.all([
        prisma.unidade.count({ where }),
        prisma.unidade.findMany({ where, select: CAMPOS_PARCEIRO, orderBy: [{ nome: 'asc' }], skip, take: lim })
      ])
      return res.json({ unidades, total, pagina: pg, paginas: Math.max(1, Math.ceil(total / lim)) })
    }

    const where = { ativo: true, ...buscaWhere, ...semGpsWhere }
    const [total, unidades, resumoAtivas] = await Promise.all([
      prisma.unidade.count({ where }),
      prisma.unidade.findMany({ where, include: { empresa: true }, orderBy: [{ nome: 'asc' }], skip, take: lim }),
      prisma.unidade.findMany({ where: { ativo: true }, select: { cidade: true, valorDiaria: true, latitude: true } })
    ])
    const totalCidades = new Set(resumoAtivas.map(u => u.cidade)).size
    const semValor = resumoAtivas.filter(u => !u.valorDiaria).length
    const semGpsCount = resumoAtivas.filter(u => !u.latitude).length

    res.json({
      unidades, total, pagina: pg, paginas: Math.max(1, Math.ceil(total / lim)),
      totalUnidades: resumoAtivas.length, totalCidades, semValor, semGps: semGpsCount
    })
  } catch (err) { next(err) }
}

const criar = async (req, res, next) => {
  try {
    const { id, empresa, usuarios, pedidos, pontos, historico, ...data } = req.body
    const unidade = await prisma.unidade.create({ data, include: { empresa: true } })
    res.status(201).json(unidade)
  } catch (err) { next(err) }
}

const buscar = async (req, res, next) => {
  try {
    if (req.usuario.role === 'TERCEIRO') {
      if (!(await unidadesDaTerceirizada(req.usuario.terceirizadaId)).includes(req.params.id))
        return res.status(403).json({ erro: 'Acesso não permitido' })
      const unidade = await prisma.unidade.findUnique({ where: { id: req.params.id }, select: CAMPOS_PARCEIRO })
      if (!unidade) return res.status(404).json({ erro: 'Não encontrada' })
      return res.json(unidade)
    }
    const unidade = await prisma.unidade.findUnique({
      where: { id: req.params.id },
      include: { usuarios: true, empresa: true }
    })
    if (!unidade) return res.status(404).json({ erro: 'Não encontrada' })
    res.json(unidade)
  } catch (err) { next(err) }
}

const atualizar = async (req, res, next) => {
  try {
    const { id, empresa, usuarios, pedidos, pontos, historico, ...data } = req.body
    const unidade = await prisma.unidade.update({
      where: { id: req.params.id },
      data,
      include: { empresa: true }
    })
    res.json(unidade)
  } catch (err) { next(err) }
}

module.exports = { listar, criar, buscar, atualizar }
