const router = require('express').Router()
const { autenticar, autorizar } = require('../middleware/auth')
const { registrar, confirmar, listar } = require('../controllers/ponto.controller')

router.use(autenticar)
router.post('/', autorizar('VIGIA'), registrar)
router.patch('/:id/confirmar', autorizar('GERENTE', 'GESTOR'), confirmar)
router.get('/', autorizar('VIGIA', 'GERENTE', 'GESTOR', 'TERCEIRO'), listar)
router.post('/manual', autenticar, autorizar('GESTOR', 'GERENTE'), async (req, res, next) => {
  try {
    const prisma = require('../utils/prisma')
    const { pedidoId, unidadeId, vigiaId, nomeVigia, tipo, horario, observacao } = req.body
    const ponto = await prisma.ponto.create({
      data: {
        tipo, horario: new Date(horario),
        gpsValido: false, manual: true,
        nomeVigia, observacao,
        vigiaId: vigiaId || (await prisma.usuario.findFirst({ where: { role: 'VIGIA' } }))?.id,
        unidadeId, pedidoId,
        status: 'CONFIRMADO',
        confirmadoPorId: req.usuario.id,
        confirmedAt: new Date()
      },
      include: { vigia: true, unidade: true }
    })
    res.status(201).json(ponto)
  } catch (err) { next(err) }
})

module.exports = router
