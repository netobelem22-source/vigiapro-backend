const router = require('express').Router()
const { autenticar, autorizar } = require('../middleware/auth')
const prisma = require('../utils/prisma')

router.use(autenticar)

router.get('/', autorizar('GESTOR', 'GERENTE'), async (req, res, next) => {
  try {
    const terceirizadas = await prisma.empresaTerceirizada.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' }
    })
    res.json(terceirizadas)
  } catch (err) { next(err) }
})

router.post('/', autorizar('GESTOR'), async (req, res, next) => {
  try {
    const { nome, valorHora } = req.body
    if (!nome?.trim()) return res.status(400).json({ erro: 'Informe o nome da empresa' })
    if (!valorHora || parseFloat(valorHora) <= 0) return res.status(400).json({ erro: 'Informe um valor por hora válido' })
    const terceirizada = await prisma.empresaTerceirizada.create({
      data: { nome: nome.trim(), valorHora: parseFloat(valorHora) }
    })
    res.status(201).json(terceirizada)
  } catch (err) { next(err) }
})

router.put('/:id', autorizar('GESTOR'), async (req, res, next) => {
  try {
    const { nome, valorHora, ativo } = req.body
    const data = {}
    if (nome !== undefined) data.nome = nome.trim()
    if (valorHora !== undefined) data.valorHora = parseFloat(valorHora)
    if (ativo !== undefined) data.ativo = ativo
    const terceirizada = await prisma.empresaTerceirizada.update({ where: { id: req.params.id }, data })
    res.json(terceirizada)
  } catch (err) { next(err) }
})

router.delete('/:id', autorizar('GESTOR'), async (req, res, next) => {
  try {
    // Desativa em vez de apagar — pedidos antigos continuam referenciando o nome/valor histórico
    await prisma.empresaTerceirizada.update({ where: { id: req.params.id }, data: { ativo: false } })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

module.exports = router
