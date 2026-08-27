const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const prisma = require('../utils/prisma')

const login = async (req, res, next) => {
  try {
    const { email, senha } = req.body
    const usuario = await prisma.usuario.findUnique({
      where: { email }, include: { unidade: true }
    })
    if (!usuario || !await bcrypt.compare(senha, usuario.senha))
      return res.status(401).json({ erro: 'Email ou senha incorretos' })
    if (!usuario.ativo)
      return res.status(403).json({ erro: 'Usuário inativo' })

    const token = jwt.sign(
      { id: usuario.id, role: usuario.role, unidadeId: usuario.unidadeId, terceirizadaId: usuario.terceirizadaId },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    )
    const { senha: _, ...dados } = usuario
    res.json({ token, usuario: dados })
  } catch (err) { next(err) }
}

const me = async (req, res, next) => {
  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.usuario.id }, include: { unidade: true }
    })
    const { senha: _, ...dados } = usuario
    res.json(dados)
  } catch (err) { next(err) }
}

const atualizarFcmToken = async (req, res, next) => {
  try {
    await prisma.usuario.update({ where: { id: req.usuario.id }, data: { fcmToken: req.body.fcmToken } })
    res.json({ ok: true })
  } catch (err) { next(err) }
}

module.exports = { login, me, atualizarFcmToken }
