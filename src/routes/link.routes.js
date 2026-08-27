const router = require('express').Router()
const { autenticar, autorizar } = require('../middleware/auth')
const prisma = require('../utils/prisma')
const { uploadFoto } = require('../utils/cloudinary')

// Gera links de ponto para um pedido — 1 link por vaga
router.post('/gerar', autenticar, autorizar('GESTOR', 'GERENTE', 'TERCEIRO'), async (req, res, next) => {
  try {
    const { pedidoId, tipo } = req.body
    if (!pedidoId || !tipo) return res.status(400).json({ erro: 'pedidoId e tipo são obrigatórios' })

    const pedido = await prisma.pedido.findUnique({ where: { id: pedidoId }, include: { unidade: true } })
    if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado' })
    if (req.usuario.role === 'GERENTE' && pedido.unidadeId !== req.usuario.unidadeId)
      return res.status(403).json({ erro: 'Acesso não permitido' })
    if (req.usuario.role === 'TERCEIRO' && pedido.terceirizadaId !== req.usuario.terceirizadaId)
      return res.status(403).json({ erro: 'Acesso não permitido' })

    // Total de vigias = quantidade de vigias solicitados (dia ou noite, o maior)
    const totalVagas = Math.max(pedido.qtdVigiaDia || 1, pedido.qtdVigiNoite || 1)

    const expiresAt = new Date()
    expiresAt.setHours(expiresAt.getHours() + 24)

    // Cria 1 link por vaga
    const links = []
    for (let i = 1; i <= totalVagas; i++) {
      const link = await prisma.linkPonto.create({
        data: { pedidoId, tipo, expiresAt, numeroVaga: i, totalVagas }
      })
      const url = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/ponto/${link.token}`
      links.push({ ...link, url, numeroVaga: i })
    }

    res.json({ links, totalVagas })
  } catch (err) { next(err) }
})

// Página pública do link
router.get('/ponto/:token', async (req, res, next) => {
  try {
    const link = await prisma.linkPonto.findUnique({
      where: { token: req.params.token },
      include: { pedido: { include: { unidade: true } } }
    })

    if (!link) return res.status(404).json({ erro: 'Link inválido' })
    if (link.usado) return res.status(410).json({ erro: 'Este link já foi utilizado' })
    if (new Date() > link.expiresAt) return res.status(410).json({ erro: 'Este link expirou' })

    res.json({
      tipo: link.tipo,
      numeroVaga: link.numeroVaga || 1,
      totalVagas: link.totalVagas || 1,
      unidade: link.pedido.unidade?.nome,
      cidade: link.pedido.unidade?.cidade,
      endereco: link.pedido.unidade?.endereco,
      data: link.pedido.data,
      expiresAt: link.expiresAt
    })
  } catch (err) { next(err) }
})

// Registra ponto via link
router.post('/ponto/:token', async (req, res, next) => {
  try {
    const { latitude, longitude, fotoBase64, nomeVigia } = req.body
    const link = await prisma.linkPonto.findUnique({
      where: { token: req.params.token },
      include: { pedido: { include: { unidade: true } } }
    })

    if (!link) return res.status(404).json({ erro: 'Link inválido' })
    if (link.usado) return res.status(410).json({ erro: 'Este link já foi utilizado' })
    if (new Date() > link.expiresAt) return res.status(410).json({ erro: 'Link expirado' })

    const unidade = link.pedido.unidade
    const gpsValido = unidade?.latitude && latitude
      ? calcularDistancia({ latitude, longitude }, { latitude: unidade.latitude, longitude: unidade.longitude }) <= (unidade.raioGps || 200)
      : false

    const ponto = await prisma.ponto.create({
      data: {
        tipo: link.tipo,
        horario: new Date(),
        latitude: latitude || null,
        longitude: longitude || null,
        gpsValido,
        fotoUrl: fotoBase64 ? await uploadFoto(fotoBase64) : null,
        nomeVigia: nomeVigia || null,
        unidadeId: link.pedido.unidadeId,
        pedidoId: link.pedidoId,
        status: 'ABERTO',
        numeroVaga: link.numeroVaga || 1
      }
    })

    await prisma.linkPonto.update({ where: { id: link.id }, data: { usado: true } })

    res.json({ ok: true, ponto: { tipo: ponto.tipo, horario: ponto.horario, gpsValido } })
  } catch (err) { next(err) }
})

const calcularDistancia = (p1, p2) => {
  const R = 6371000
  const dLat = (p2.latitude - p1.latitude) * Math.PI / 180
  const dLon = (p2.longitude - p1.longitude) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(p1.latitude*Math.PI/180)*Math.cos(p2.latitude*Math.PI/180)*Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

module.exports = router
