const router = require('express').Router()
const { autenticar, autorizar } = require('../middleware/auth')
const { resumoHoje } = require('../controllers/dashboard.controller')

router.get('/hoje', autenticar, autorizar('GESTOR', 'GERENTE', 'TERCEIRO'), resumoHoje)
module.exports = router
