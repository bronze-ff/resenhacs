export function nomeMapa(map) {
  if (!map) return 'Mapa desconhecido'
  const limpo = map.replace(/^de_/, '')
  return limpo.charAt(0).toUpperCase() + limpo.slice(1)
}

export function dataRelativa(iso) {
  if (!iso) return 'data desconhecida'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'data desconhecida'
  const diff = Date.now() - d.getTime()
  const dias = Math.floor(diff / 86400000)
  if (dias <= 0) return 'hoje'
  if (dias === 1) return 'ontem'
  if (dias < 30) return `há ${dias} dias`
  return d.toLocaleDateString('pt-BR')
}

// Data/hora absoluta no fuso de Brasília (ex.: "08/07/2026 21:04") — pedido do grupo:
// "ontem" relativo engana perto da virada do dia; played_at no banco é UTC.
const FUSO_BRASILIA = 'America/Sao_Paulo'

function partesNoHorarioDeBrasilia(data) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: FUSO_BRASILIA,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(data)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value]),
  )
}

// O datetime-local representa sempre Brasília, nunca o fuso do navegador.
export function paraDatetimeLocalBrasilia(iso) {
  if (!iso) return ''
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return ''
  const p = partesNoHorarioDeBrasilia(data)
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

export function datetimeLocalBrasiliaParaIso(valor) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(valor ?? '')
  if (!match) return ''
  const [, ano, mes, dia, hora, minuto] = match
  const utcPretendido = Date.UTC(ano, Number(mes) - 1, dia, hora, minuto)
  let instante = utcPretendido
  // Recalcula o offset para o próprio instante, sem depender do fuso da máquina.
  for (let i = 0; i < 2; i += 1) {
    const p = partesNoHorarioDeBrasilia(new Date(instante))
    const comoUtc = Date.UTC(p.year, Number(p.month) - 1, p.day, p.hour, p.minute, p.second)
    instante = utcPretendido - (comoUtc - instante)
  }
  return new Date(instante).toISOString()
}

export function contadorRegressivo(alvo, agora = Date.now()) {
  const restante = new Date(alvo).getTime() - agora
  if (!Number.isFinite(restante) || restante <= 0) return '00:00:00'
  const segundos = Math.floor(restante / 1000)
  const dias = Math.floor(segundos / 86400)
  const horas = Math.floor((segundos % 86400) / 3600)
  const minutos = Math.floor((segundos % 3600) / 60)
  const secs = segundos % 60
  const dois = (n) => String(n).padStart(2, '0')
  return dias > 0 ? `${dias}d ${dois(horas)}:${dois(minutos)}:${dois(secs)}` : `${dois(horas)}:${dois(minutos)}:${dois(secs)}`
}

export function dataHora(iso) {
  if (!iso) return 'data desconhecida'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'data desconhecida'
  // Fuso fixo de Brasília (não o do aparelho): o grupo inteiro é brasileiro e as regras
  // de competição falam em horário de Brasília — a exibição não pode variar com o fuso
  // do dispositivo (viagem, VPN, relógio errado).
  const tz = { timeZone: FUSO_BRASILIA }
  return `${d.toLocaleDateString('pt-BR', tz)} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', ...tz })}`
}

// Tag de origem da Partida. `temDemo` distingue a Partida COMPLETA (veio de um .dem
// parseado) da stats-only, montada só com o que a API da plataforma devolve — que não
// tem KAST, rating, economia nem Replay 2D. Ver matches.tem_demo.
export function origemPartida(source, temDemo = true) {
  if (source === 'upload') return { label: 'Manual', title: 'Demo enviada manualmente' }
  if (!temDemo) {
    return {
      label: 'SEM DEMO',
      title: 'Só as estatísticas da plataforma — envie a demo pra completar (KAST, rating, replay)',
    }
  }
  return { label: 'Auto', title: 'Baixada automaticamente pelo Coletor' }
}

// Verde/vermelho/neutro para rating estilo HLTV.
export function corRating(rating) {
  if (rating == null) return 'text-texto-fraco'
  if (rating >= 1.15) return 'text-sucesso'
  if (rating <= 0.85) return 'text-perigo'
  return 'text-texto'
}

// Nome cru da arma (como vem do demo, ex. "m4a1_silencer") → nome de exibição.
const NOMES_ARMA = {
  ak47: 'AK-47', m4a1: 'M4A4', m4a1_silencer: 'M4A1-S', awp: 'AWP',
  deagle: 'Desert Eagle', usp_silencer: 'USP-S', glock: 'Glock-18',
  p250: 'P250', tec9: 'Tec-9', fiveseven: 'Five-SeveN', cz75a: 'CZ75-Auto',
  elite: 'Dual Berettas', revolver: 'R8 Revolver',
  ssg08: 'SSG 08', scar20: 'SCAR-20', g3sg1: 'G3SG1', aug: 'AUG', sg556: 'SG 553',
  galilar: 'Galil AR', famas: 'FAMAS', mac10: 'MAC-10', mp9: 'MP9', mp7: 'MP7',
  ump45: 'UMP-45', p90: 'P90', bizon: 'PP-Bizon', mp5sd: 'MP5-SD',
  nova: 'Nova', xm1014: 'XM1014', mag7: 'MAG-7', sawedoff: 'Sawed-Off',
  m249: 'M249', negev: 'Negev', hkp2000: 'P2000', knife: 'Faca',
  hegrenade: 'HE', molotov: 'Molotov', incgrenade: 'Incendiária', inferno: 'Molotov',
  flashbang: 'Flash', smokegrenade: 'Smoke', decoy: 'Decoy', taser: 'Zeus x27',
}
export function nomeArma(weapon) {
  return NOMES_ARMA[weapon] ?? weapon
}

// Categoria da arma → usado pro ícone no Replay 2D (formato/tamanho do desenho).
const CATEGORIA_ARMA = {
  ak47: 'rifle', m4a1: 'rifle', m4a1_silencer: 'rifle', aug: 'rifle', sg556: 'rifle',
  galilar: 'rifle', famas: 'rifle',
  awp: 'sniper', ssg08: 'sniper', scar20: 'sniper', g3sg1: 'sniper',
  deagle: 'pistol', usp_silencer: 'pistol', glock: 'pistol', p250: 'pistol',
  tec9: 'pistol', fiveseven: 'pistol', cz75a: 'pistol', elite: 'pistol',
  revolver: 'pistol', hkp2000: 'pistol',
  mac10: 'smg', mp9: 'smg', mp7: 'smg', ump45: 'smg', p90: 'smg', bizon: 'smg', mp5sd: 'smg',
  nova: 'shotgun', xm1014: 'shotgun', mag7: 'shotgun', sawedoff: 'shotgun',
  m249: 'heavy', negev: 'heavy',
  knife: 'knife', knife_t: 'knife', knife_ct: 'knife', knife_css: 'knife', knife_kukri: 'knife',
  hegrenade: 'nade', molotov: 'nade', incgrenade: 'nade', inferno: 'nade',
  flashbang: 'nade', smokegrenade: 'nade', decoy: 'nade',
}
export function categoriaArma(weapon) {
  return CATEGORIA_ARMA[weapon] ?? 'pistol'
}

// Rótulo do tipo de compra (eco/forçado/semi/full), cor incluída.
export const TIPO_COMPRA = {
  eco: { label: 'Eco', cor: 'text-texto-fraco' },
  forcado: { label: 'Forçado', cor: 'text-perigo' },
  semi: { label: 'Meia-compra', cor: 'text-texto' },
  full: { label: 'Compra cheia', cor: 'text-sucesso' },
}
