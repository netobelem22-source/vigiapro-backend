const router = require('express').Router()
const { autenticar, autorizar } = require('../middleware/auth')
const { listar, criar, buscar, atualizar, atualizarStatus, confirmarTodos, recusarTodos, relatorioMensal } = require('../controllers/pedido.controller')

router.use(autenticar)
router.get('/', listar)
router.post('/', autorizar('GERENTE', 'GESTOR'), criar)
router.get('/relatorio', autorizar('GESTOR', 'GERENTE'), relatorioMensal)
router.get('/:id', buscar)
router.patch('/:id', autorizar('GESTOR', 'GERENTE'), atualizar)
router.patch('/:id/status', autorizar('GESTOR', 'GERENTE', 'TERCEIRO'), atualizarStatus)
router.post('/confirmar-todos', autorizar('GESTOR', 'GERENTE'), confirmarTodos)
router.post('/recusar-todos', autorizar('GESTOR', 'GERENTE'), recusarTodos)

module.exports = router
