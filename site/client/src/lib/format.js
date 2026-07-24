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

// Data/hora absoluta no fuso do navegador (ex.: "08/07/2026 21:04") — pedido do grupo:
// "ontem" relativo engana perto da virada do dia; played_at no banco é UTC.
export function dataHora(iso) {
  if (!iso) return 'data desconhecida'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'data desconhecida'
  // Fuso fixo de Brasília (não o do aparelho): o grupo inteiro é brasileiro e as regras
  // de competição falam em horário de Brasília — a exibição não pode variar com o fuso
  // do dispositivo (viagem, VPN, relógio errado).
  const tz = { timeZone: 'America/Sao_Paulo' }
  return `${d.toLocaleDateString('pt-BR', tz)} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', ...tz })}`
}

// Tag de origem da Partida: baixada pelo bot (valve_mm) ou enviada manualmente (upload).
export function origemPartida(source) {
  return source === 'upload'
    ? { label: 'MANUAL', title: 'Demo enviada manualmente' }
    : { label: 'AUTO', title: 'Baixada automaticamente pelo Coletor' }
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
