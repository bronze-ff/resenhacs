// Validação do JSON do Quadro tático (passos + objetos desenhados sobre o radar).
// Devolve uma cópia LIMPA (só os campos conhecidos, coords arredondadas) ou um erro em
// texto. Nada do que o client mandar fora da allowlist chega ao banco.

export const TIPOS_OBJETO = ['ct', 't', 'smoke', 'flash', 'molotov', 'he', 'seta', 'traco']
export const LIMITES = {
  passos: 20,
  objetosPorPasso: 200,
  pontosPorTraco: 100,
  nome: 120,
  descricao: 2000,
  nomePasso: 60,
  rotulo: 24,
  quadrosPorJogador: 200,
}

const MAPA_RE = /^de_[a-z0-9_]{1,30}$/
const ID_OBJETO_RE = /^[A-Za-z0-9_-]{1,40}$/

function coord(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) return null
  return Math.round(v * 10000) / 10000
}

function texto(v, max) {
  if (v == null) return ''
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > max ? null : t
}

function validarObjeto(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { erro: 'objeto inválido' }
  if (!TIPOS_OBJETO.includes(o.tipo)) return { erro: 'tipo de objeto inválido' }
  const limpo = { tipo: o.tipo }
  // id opcional (o editor usa pra casar o mesmo objeto entre passos na animação).
  if (o.id != null) {
    if (typeof o.id !== 'string' || !ID_OBJETO_RE.test(o.id)) return { erro: 'id de objeto inválido' }
    limpo.id = o.id
  }
  if (o.tipo === 'traco') {
    if (!Array.isArray(o.pontos) || o.pontos.length < 2 || o.pontos.length > LIMITES.pontosPorTraco) {
      return { erro: `traço precisa de 2 a ${LIMITES.pontosPorTraco} pontos` }
    }
    const pontos = []
    for (const p of o.pontos) {
      if (!Array.isArray(p) || p.length !== 2) return { erro: 'ponto de traço inválido' }
      const px = coord(p[0])
      const py = coord(p[1])
      if (px == null || py == null) return { erro: 'coordenada fora do radar' }
      pontos.push([px, py])
    }
    limpo.x = pontos[0][0]
    limpo.y = pontos[0][1]
    limpo.pontos = pontos
  } else {
    const x = coord(o.x)
    const y = coord(o.y)
    if (x == null || y == null) return { erro: 'coordenada fora do radar' }
    limpo.x = x
    limpo.y = y
    if (o.tipo === 'seta') {
      const x2 = coord(o.x2)
      const y2 = coord(o.y2)
      if (x2 == null || y2 == null) return { erro: 'seta precisa de x2/y2 dentro do radar' }
      limpo.x2 = x2
      limpo.y2 = y2
    }
  }
  if (o.rotulo != null && o.rotulo !== '') {
    const r = texto(o.rotulo, LIMITES.rotulo)
    if (r == null) return { erro: 'rótulo inválido' }
    if (r) limpo.rotulo = r
  }
  return { objeto: limpo }
}

export function validarPassos(passos) {
  if (!Array.isArray(passos) || passos.length < 1 || passos.length > LIMITES.passos) {
    return { erro: `o quadro precisa de 1 a ${LIMITES.passos} passos` }
  }
  const limpos = []
  for (const p of passos) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { erro: 'passo inválido' }
    const nome = texto(p.nome, LIMITES.nomePasso)
    if (nome == null) return { erro: 'nome de passo inválido' }
    const objetos = p.objetos ?? []
    if (!Array.isArray(objetos) || objetos.length > LIMITES.objetosPorPasso) {
      return { erro: `cada passo aceita até ${LIMITES.objetosPorPasso} objetos` }
    }
    const objetosLimpos = []
    for (const o of objetos) {
      const r = validarObjeto(o)
      if (r.erro) return r
      objetosLimpos.push(r.objeto)
    }
    limpos.push({ nome, objetos: objetosLimpos })
  }
  return { passos: limpos }
}

// Corpo inteiro de criar/atualizar.
export function validarQuadro(body) {
  const b = body && typeof body === 'object' ? body : {}
  const nome = texto(b.nome, LIMITES.nome)
  if (!nome) return { erro: `nome obrigatório (até ${LIMITES.nome} caracteres)` }
  const map = typeof b.map === 'string' ? b.map.trim() : ''
  if (!MAPA_RE.test(map)) return { erro: 'mapa inválido' }
  let lado = null
  if (b.lado != null && b.lado !== '') {
    if (b.lado !== 'T' && b.lado !== 'CT') return { erro: 'lado deve ser T ou CT' }
    lado = b.lado
  }
  const descricao = texto(b.descricao, LIMITES.descricao)
  if (descricao == null) return { erro: `descrição até ${LIMITES.descricao} caracteres` }
  const publicoNoGrupo = b.publicoNoGrupo === undefined ? true : b.publicoNoGrupo
  if (typeof publicoNoGrupo !== 'boolean') return { erro: 'publicoNoGrupo deve ser booleano' }
  const r = validarPassos(b.passos)
  if (r.erro) return r
  return { quadro: { nome, map, lado, descricao, publicoNoGrupo, passos: r.passos } }
}
