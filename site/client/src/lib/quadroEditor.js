// Estado puro do editor do Quadro tático (reducer + helpers). O desenho em SVG fica em
// components/quadro/EditorQuadro.jsx; aqui só dados, pra testar sem DOM.
//
// Coordenadas sempre normalizadas 0..1 no radar (mesma convenção do Replay 2D).

export const LIMITES = { passos: 20, objetosPorPasso: 200, pontosPorTraco: 100, historico: 50 }

export const TIPOS_PECA = ['ct', 't', 'smoke', 'flash', 'molotov', 'he']
export const TIPOS_OBJETO = [...TIPOS_PECA, 'seta', 'traco']

let contador = 0
export function novoId() {
  contador += 1
  return `o${Date.now().toString(36)}${contador.toString(36)}`
}

const limitar = (v) => Math.min(1, Math.max(0, v))

export function passoVazio(nome = 'Passo 1') {
  return { id: novoId(), nome, objetos: [] }
}

export function estadoInicial(meta = {}) {
  return {
    meta: { id: null, nome: '', map: 'de_mirage', lado: '', descricao: '', publicoNoGrupo: true, meu: true, ...meta },
    passos: [passoVazio('Setup')],
    passoAtivo: 0,
    selecionado: null,
    historico: [],
    sujo: false,
  }
}

// Quadro vindo da API (ou da importação) → estado do editor. Objetos sem id ganham um.
export function deQuadro(q) {
  const passos = (q.passos?.length ? q.passos : [{ nome: 'Setup', objetos: [] }]).map((p) => ({
    id: novoId(),
    nome: p.nome ?? '',
    objetos: (p.objetos ?? []).map((o) => ({ ...o, id: o.id ?? novoId() })),
  }))
  return {
    ...estadoInicial(),
    meta: {
      id: q.id ?? null,
      nome: q.nome ?? '',
      map: q.map ?? 'de_mirage',
      lado: q.lado ?? '',
      descricao: q.descricao ?? '',
      publicoNoGrupo: q.publicoNoGrupo ?? true,
      meu: q.meu ?? true,
      criadoPorNick: q.criadoPorNick ?? null,
    },
    passos,
  }
}

// Estado → corpo do POST/PUT (o servidor valida e limpa de novo).
export function paraApi(estado) {
  const { meta, passos } = estado
  return {
    nome: meta.nome.trim(),
    map: meta.map,
    lado: meta.lado || null,
    descricao: meta.descricao,
    publicoNoGrupo: meta.publicoNoGrupo,
    passos: passos.map((p) => ({ nome: p.nome, objetos: p.objetos })),
  }
}

// Move o objeto pra que a âncora (x,y) caia em (x,y) novos; seta e traço se deslocam
// inteiros, sem sair do radar.
export function transladar(obj, x, y) {
  let dx = x - obj.x
  let dy = y - obj.y
  const xs = [obj.x]
  const ys = [obj.y]
  if (obj.tipo === 'seta') { xs.push(obj.x2); ys.push(obj.y2) }
  if (obj.tipo === 'traco') for (const [px, py] of obj.pontos) { xs.push(px); ys.push(py) }
  dx = Math.min(Math.max(dx, -Math.min(...xs)), 1 - Math.max(...xs))
  dy = Math.min(Math.max(dy, -Math.min(...ys)), 1 - Math.max(...ys))
  const novo = { ...obj, x: obj.x + dx, y: obj.y + dy }
  if (obj.tipo === 'seta') { novo.x2 = obj.x2 + dx; novo.y2 = obj.y2 + dy }
  if (obj.tipo === 'traco') novo.pontos = obj.pontos.map(([px, py]) => [px + dx, py + dy])
  return novo
}

// Reduz um traço a no máximo `max` pontos (mantém o primeiro e o último).
export function simplificarTraco(pontos, max = LIMITES.pontosPorTraco) {
  if (pontos.length <= max) return pontos
  const passo = (pontos.length - 1) / (max - 1)
  return Array.from({ length: max }, (_, i) => pontos[Math.round(i * passo)])
}

function snapshot(s) {
  return { passos: s.passos, passoAtivo: s.passoAtivo }
}

function comHistorico(s, mudanca) {
  const historico = [...s.historico, snapshot(s)].slice(-LIMITES.historico)
  return { ...s, ...mudanca, historico, sujo: true }
}

function trocarObjetosDoPasso(s, fn) {
  return s.passos.map((p, i) => (i === s.passoAtivo ? { ...p, objetos: fn(p.objetos) } : p))
}

export function reducerQuadro(s, acao) {
  switch (acao.tipo) {
    case 'carregar':
      return acao.estado

    case 'meta':
      return { ...s, meta: { ...s.meta, ...acao.campos }, sujo: true }

    case 'adicionarObjeto': {
      const atual = s.passos[s.passoAtivo]
      if (atual.objetos.length >= LIMITES.objetosPorPasso) return s
      const o = acao.objeto
      if (!TIPOS_OBJETO.includes(o.tipo)) return s
      const objeto = { ...o, id: o.id ?? novoId(), x: limitar(o.x), y: limitar(o.y) }
      if (objeto.tipo === 'traco') objeto.pontos = simplificarTraco(o.pontos.map(([px, py]) => [limitar(px), limitar(py)]))
      if (objeto.tipo === 'seta') { objeto.x2 = limitar(o.x2); objeto.y2 = limitar(o.y2) }
      return comHistorico(s, {
        passos: trocarObjetosDoPasso(s, (objs) => [...objs, objeto]),
        selecionado: objeto.id,
      })
    }

    // Arraste: registra UMA entrada de histórico no começo; os `moverObjeto` seguintes
    // (com registrar=false) não empilham, então ctrl+z desfaz o arraste inteiro.
    case 'iniciarArraste':
      return comHistorico(s, { selecionado: acao.id })

    case 'moverObjeto': {
      const mover = (objs) => objs.map((o) => (o.id === acao.id ? transladar(o, limitar(acao.x), limitar(acao.y)) : o))
      if (acao.registrar) return comHistorico(s, { passos: trocarObjetosDoPasso(s, mover) })
      return { ...s, passos: trocarObjetosDoPasso(s, mover), sujo: true }
    }

    case 'rotularObjeto':
      return comHistorico(s, {
        passos: trocarObjetosDoPasso(s, (objs) =>
          objs.map((o) => (o.id === acao.id ? { ...o, rotulo: String(acao.rotulo ?? '').slice(0, 24) } : o))),
      })

    case 'apagarObjeto': {
      const atual = s.passos[s.passoAtivo]
      if (!atual.objetos.some((o) => o.id === acao.id)) return s
      return comHistorico(s, {
        passos: trocarObjetosDoPasso(s, (objs) => objs.filter((o) => o.id !== acao.id)),
        selecionado: s.selecionado === acao.id ? null : s.selecionado,
      })
    }

    case 'selecionar':
      return { ...s, selecionado: acao.id ?? null }

    // Passo novo entra logo depois do ativo, COPIANDO os objetos dele (mesmos ids) —
    // é assim que a animação sabe que o "jogador 1" do passo 2 é o mesmo do passo 1.
    case 'adicionarPasso': {
      if (s.passos.length >= LIMITES.passos) return s
      const base = s.passos[s.passoAtivo]
      const novo = { id: novoId(), nome: acao.nome ?? `Passo ${s.passos.length + 1}`, objetos: base.objetos.map((o) => ({ ...o })) }
      const passos = [...s.passos.slice(0, s.passoAtivo + 1), novo, ...s.passos.slice(s.passoAtivo + 1)]
      return comHistorico(s, { passos, passoAtivo: s.passoAtivo + 1, selecionado: null })
    }

    case 'renomearPasso':
      return comHistorico(s, {
        passos: s.passos.map((p, i) => (i === acao.indice ? { ...p, nome: String(acao.nome ?? '').slice(0, 60) } : p)),
      })

    case 'removerPasso': {
      if (s.passos.length <= 1 || acao.indice < 0 || acao.indice >= s.passos.length) return s
      const passos = s.passos.filter((_, i) => i !== acao.indice)
      const passoAtivo = Math.min(passos.length - 1, s.passoAtivo > acao.indice ? s.passoAtivo - 1 : s.passoAtivo)
      return comHistorico(s, { passos, passoAtivo, selecionado: null })
    }

    case 'selecionarPasso':
      if (acao.indice < 0 || acao.indice >= s.passos.length) return s
      return { ...s, passoAtivo: acao.indice, selecionado: null }

    case 'desfazer': {
      if (s.historico.length === 0) return s
      const anterior = s.historico[s.historico.length - 1]
      return { ...s, ...anterior, historico: s.historico.slice(0, -1), selecionado: null, sujo: true }
    }

    case 'salvo':
      return { ...s, meta: { ...s.meta, id: acao.id, meu: true }, sujo: false }

    default:
      return s
  }
}

// Interpola dois passos pra animação (t de 0 a 1). Objetos com o mesmo id nos dois
// passos deslizam; os que só existem num dos passos aparecem/somem por opacidade.
export function interpolarPassos(de, para, t) {
  const k = Math.min(1, Math.max(0, t))
  const lerp = (a, b) => a + (b - a) * k
  const destino = new Map(para.objetos.map((o) => [o.id, o]))
  const saida = []
  for (const a of de.objetos) {
    const b = destino.get(a.id)
    if (!b || b.tipo !== a.tipo) {
      saida.push({ ...a, opacidade: 1 - k })
      continue
    }
    const o = { ...b, x: lerp(a.x, b.x), y: lerp(a.y, b.y), opacidade: 1 }
    if (a.tipo === 'seta') { o.x2 = lerp(a.x2, b.x2); o.y2 = lerp(a.y2, b.y2) }
    if (a.tipo === 'traco' && a.pontos.length === b.pontos.length) {
      o.pontos = a.pontos.map(([px, py], i) => [lerp(px, b.pontos[i][0]), lerp(py, b.pontos[i][1])])
    }
    saida.push(o)
  }
  const origem = new Set(de.objetos.map((o) => o.id))
  for (const b of para.objetos) {
    if (!origem.has(b.id)) saida.push({ ...b, opacidade: k })
  }
  return saida
}
