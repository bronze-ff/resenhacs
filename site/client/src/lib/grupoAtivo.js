const CHAVE = 'resenha_grupo_ativo'
let cache = null
try {
  cache = localStorage.getItem(CHAVE)
} catch {
  cache = null
}

export function getGrupoAtivo() {
  return cache
}

export function setGrupoAtivo(groupId) {
  cache = groupId || null
  try {
    if (groupId) localStorage.setItem(CHAVE, groupId)
    else localStorage.removeItem(CHAVE)
  } catch {
    // ignora (ex.: storage indisponível)
  }
}
