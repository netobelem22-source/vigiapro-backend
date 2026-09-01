const router = require('express').Router()
const { autenticar, autorizar } = require('../middleware/auth')
const prisma = require('../utils/prisma')

router.use(autenticar, autorizar('GESTOR', 'GERENTE'))

const SEGMENTOS = ['LOJA', 'OBRA', 'EXPANSAO']

// Agrega uma lista de pares entrada/saída (já filtrada) em linhas por unidade + totais
const agregar = (paresFiltrados, valorHoraGlobal) => {
  const porUnidade = {}
  for (const par of paresFiltrados) {
    const { entrada, saida, nomeVigia, segmentoPar } = par
    const uid = entrada.unidadeId
    // Preço da empresa terceirizada escolhida no pedido tem prioridade sobre o valor da unidade
    const valorHora = entrada.pedido?.terceirizada?.valorHora || entrada.unidade?.valorDiaria || valorHoraGlobal
    const diffMs = new Date(saida.horario) - new Date(entrada.horario)
    const diffMin = Math.floor(diffMs / 60000)
    const horas = Math.min(diffMin / 60, 12)

    if (!porUnidade[uid]) {
      porUnidade[uid] = {
        unidadeId: uid,
        unidade: entrada.unidade?.nome,
        cidade: entrada.unidade?.cidade,
        cnpj: entrada.unidade?.cnpj,
        empresa: entrada.unidade?.empresa?.nome,
        valorHora,
        registros: 0,
        totalHoras: 0,
        valorTotal: 0,
        detalhes: []
      }
    }

    porUnidade[uid].registros++
    porUnidade[uid].totalHoras += horas
    porUnidade[uid].valorTotal += horas * valorHora
    porUnidade[uid].detalhes.push({
      vigia: nomeVigia,
      segmento: segmentoPar,
      terceirizada: entrada.pedido?.terceirizada?.nome || null,
      observacao: entrada.pedido?.observacao || null,
      data: new Date(entrada.horario).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-'),
      entrada: new Date(entrada.horario).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
      saida: new Date(saida.horario).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
      horas,
      valor: horas * valorHora
    })
  }

  const linhas = Object.values(porUnidade)
    .map(l => ({ ...l, totalHoras: Math.round(l.totalHoras * 100) / 100, valorTotal: Math.round(l.valorTotal * 100) / 100 }))
    .sort((a, b) => (a.cidade || '').localeCompare(b.cidade || ''))

  const totais = linhas.reduce((acc, l) => ({
    registros: acc.registros + l.registros,
    totalHoras: acc.totalHoras + l.totalHoras,
    valorTotal: acc.valorTotal + l.valorTotal
  }), { registros: 0, totalHoras: 0, valorTotal: 0 })
  totais.totalHoras = Math.round(totais.totalHoras * 100) / 100
  totais.valorTotal = Math.round(totais.valorTotal * 100) / 100

  return { linhas, totais }
}

router.get('/', async (req, res, next) => {
  try {
    const mes = parseInt(req.query.mes) || new Date().getMonth() + 1
    const ano = parseInt(req.query.ano) || new Date().getFullYear()

    const inicio = new Date(ano, mes - 1, 1)
    const fim = new Date(ano, mes, 1)

    let config = await prisma.configuracao.findFirst()
    const valorHoraGlobal = config?.valorDiaria || 33.80

    const whereBase = req.usuario.role === 'GERENTE'
      ? { unidadeId: req.usuario.unidadeId }
      : {}

    // Busca única do mês — usada para montar "todos" e cada segmento, sem repetir a consulta.
    // Filtra pelo mês do PEDIDO (data do turno), não pela hora do ponto: um turno que atravessa
    // a virada de mês (entrada dia 31 à noite, saída dia 1 de manhã) tem a saída fora do intervalo
    // de horario do mês anterior — usar a data do pedido mantém entrada e saída no mesmo recorte.
    const pontos = await prisma.ponto.findMany({
      where: {
        ...whereBase,
        status: 'CONFIRMADO',
        OR: [
          { pedido: { data: { gte: inicio, lt: fim } } },
          { pedidoId: null, horario: { gte: inicio, lt: fim } }
        ]
      },
      include: {
        unidade: { include: { empresa: true } },
        vigia: true,
        pedido: { include: { terceirizada: true } }
      },
      orderBy: { horario: 'asc' }
    })

    // Monta pares entrada/saída por: unidade | pedido | dia
    const paresPorChave = {}
    for (const ponto of pontos) {
      const nomeVigia = ponto.nomeVigia || ponto.vigia?.nome || 'Desconhecido'
      // Usa a data do PEDIDO (data do turno) como referência do dia, não a hora do ponto —
      // turnos noturnos têm entrada e saída em dias de calendário diferentes (atravessam a meia-noite),
      // e usar a hora de cada ponto separadamente quebrava o pareamento entrada/saída desses turnos.
      const dia = ponto.pedido?.data
        ? new Date(ponto.pedido.data).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
        : new Date(ponto.horario).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
      // Prioriza identificadores confiáveis sobre o nome digitado (texto livre, sujeito a erro
      // de quem bate o ponto): vigiaId (login no app) > numeroVaga (link atribuído pelo sistema)
      // > nome digitado, só como último recurso.
      const vigiaKey = ponto.vigiaId || (ponto.numeroVaga != null ? `vaga${ponto.numeroVaga}` : nomeVigia)
      const chave = `${ponto.pedidoId || ponto.unidadeId}|${vigiaKey}|${dia}`

      if (!paresPorChave[chave]) paresPorChave[chave] = { entrada: null, saida: null, nomeVigia }
      if (ponto.tipo === 'ENTRADA') {
        paresPorChave[chave].entrada = ponto
        paresPorChave[chave].nomeVigia = nomeVigia // usa nome da entrada
      }
      else if (ponto.tipo === 'SAIDA') paresPorChave[chave].saida = ponto
    }

    // Filtra pares completos (com entrada e saída) e anota o segmento uma única vez
    const paresCompletos = Object.values(paresPorChave)
      .filter(p => p.entrada && p.saida)
      .map(p => ({ ...p, segmentoPar: p.entrada.pedido?.segmento || null }))

    const todos = agregar(paresCompletos, valorHoraGlobal)
    const porSegmento = {}
    for (const seg of SEGMENTOS) {
      porSegmento[seg] = agregar(paresCompletos.filter(p => p.segmentoPar === seg), valorHoraGlobal)
    }

    res.json({ mes, ano, valorHoraGlobal, todos, porSegmento })
  } catch (err) { next(err) }
})

module.exports = router
