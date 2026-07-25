// Pré-check barato do mapa antes de subir 100-300MB: o nome do mapa aparece como
// string nos primeiros KBs do .dem. É HEURÍSTICA, não garantia — no CS2 o cabeçalho
// é protobuf (PBDEMS2), sem offset fixo, então quando não achar nada a gente deixa
// passar e o Coletor decide (ele valida mapa E os 10 steam ids depois do parse).
const MAPA_RE = /de_[a-z0-9_]{2,20}/

const TRECHO_BYTES = 8192

export async function mapaDoCabecalho(arquivo) {
  try {
    const buf = await arquivo.slice(0, TRECHO_BYTES).arrayBuffer()
    const texto = new TextDecoder('latin1').decode(new Uint8Array(buf))
    return texto.match(MAPA_RE)?.[0] ?? null
  } catch {
    return null
  }
}
