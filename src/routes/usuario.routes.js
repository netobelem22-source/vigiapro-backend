const router = require('express').Router()
const { autenticar, autorizar } = require('../middleware/auth')
const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const prisma = new PrismaClient()

router.use(autenticar)

router.get('/', autorizar('GESTOR', 'GERENTE'), async (req, res, next) => {
  try {
    const { busca, role, ativo, page, limit } = req.query
    const pg = Math.max(1, parseInt(page) || 1)
    const lim = Math.min(200, parseInt(limit) || 24)

    const baseWhere = {}
    if (role) baseWhere.role = role
    if (busca) baseWhere.OR = [
      { nome: { contains: busca, mode: 'insensitive' } },
      { email: { contains: busca, mode: 'insensitive' } }
    ]
    const where = { ...baseWhere }
    if (ativo !== undefined) where.ativo = ativo === 'true'

    const [total, usuarios, totalInativos] = await Promise.all([
      prisma.usuario.count({ where }),
      prisma.usuario.findMany({
        where, include: { unidade: true, terceirizada: true }, orderBy: { nome: 'asc' },
        skip: (pg - 1) * lim, take: lim
      }),
      prisma.usuario.count({ where: { ...baseWhere, ativo: false } })
    ])
    const sem_senha = usuarios.map(({ senha, ...u }) => u)
    res.json({ usuarios: sem_senha, total, pagina: pg, paginas: Math.max(1, Math.ceil(total / lim)), totalInativos })
  } catch (err) { next(err) }
})

router.post('/', autorizar('GESTOR'), async (req, res, next) => {
  try {
    const { senha, ...resto } = req.body
    const hash = await bcrypt.hash(senha, 10)
    const usuario = await prisma.usuario.create({
      data: { ...resto, senha: hash },
      include: { unidade: true }
    })
    const { senha: _, ...dados } = usuario
    res.status(201).json(dados)
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ erro: 'Email já cadastrado' })
    next(err)
  }
})

router.put('/:id', autorizar('GESTOR'), async (req, res, next) => {
  try {
    const { senha, id, criadoEm, unidade, terceirizada, pedidos, pontos, confirmacoes, historicos, ...resto } = req.body
    const data = { ...resto }
    if (senha) data.senha = await bcrypt.hash(senha, 10)
    const usuario = await prisma.usuario.update({
      where: { id: req.params.id },
      data,
      include: { unidade: true, terceirizada: true }
    })
    const { senha: _, ...dados } = usuario
    res.json(dados)
  } catch (err) { next(err) }
})

router.delete('/:id', autorizar('GESTOR'), async (req, res, next) => {
  try {
    const id = req.params.id
    const [pedidos, pontos, confirmacoes, historicos, unidadesParceiras] = await Promise.all([
      prisma.pedido.count({ where: { solicitanteId: id } }),
      prisma.ponto.count({ where: { vigiaId: id } }),
      prisma.ponto.count({ where: { confirmadoPorId: id } }),
      prisma.historicoPedido.count({ where: { usuarioId: id } }),
      prisma.unidadeParceiro.count({ where: { usuarioId: id } })
    ])
    const temHistorico = pedidos > 0 || pontos > 0 || confirmacoes > 0 || historicos > 0 || unidadesParceiras > 0

    if (!temHistorico) {
      try {
        await prisma.usuario.delete({ where: { id } })
        return res.json({ ok: true, excluido: true })
      } catch (e) {
        if (e.code !== 'P2003') throw e
        // caiu num vínculo que não checamos acima — segue para desativação
      }
    }

    await prisma.usuario.update({ where: { id }, data: { ativo: false } })
    res.json({ ok: true, excluido: false, motivo: 'Usuário tem histórico no sistema (pedidos, pontos ou registros vinculados) — foi desativado em vez de excluído para preservar esses registros.' })
  } catch (err) { next(err) }
})

// Unidades que um usuário TERCEIRO está autorizado a atender
router.get('/:id/unidades', autorizar('GESTOR'), async (req, res, next) => {
  try {
    const vinculos = await prisma.unidadeParceiro.findMany({
      where: { usuarioId: req.params.id },
      include: { unidade: true },
      orderBy: { unidade: { nome: 'asc' } }
    })
    res.json(vinculos.map(v => v.unidade))
  } catch (err) { next(err) }
})

router.post('/:id/unidades', autorizar('GESTOR'), async (req, res, next) => {
  try {
    const { unidadeId } = req.body
    if (!unidadeId) return res.status(400).json({ erro: 'unidadeId é obrigatório' })
    const vinculo = await prisma.unidadeParceiro.create({
      data: { usuarioId: req.params.id, unidadeId },
      include: { unidade: true }
    })
    res.status(201).json(vinculo)
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ erro: 'Unidade já vinculada a este usuário' })
    next(err)
  }
})

router.delete('/:id/unidades/:unidadeId', autorizar('GESTOR'), async (req, res, next) => {
  try {
    await prisma.unidadeParceiro.delete({
      where: { usuarioId_unidadeId: { usuarioId: req.params.id, unidadeId: req.params.unidadeId } }
    })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

module.exports = router
