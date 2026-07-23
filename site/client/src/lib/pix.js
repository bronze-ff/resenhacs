// Monta o payload PIX no padrão BR Code/EMV do Banco Central (o texto do "PIX copia e cola",
// que também vira o conteúdo do QR code). GUI, nome e cidade seguem maiúsculas por convenção
// do padrão — os valores originais continuam com capitalização normal em qualquer outro lugar
// da tela; a conversão é só dentro deste payload.
const GUI_PIX = 'BR.GOV.BCB.PIX'

function campo(id, valor) {
  const tamanho = String(valor.length).padStart(2, '0')
  return `${id}${tamanho}${valor}`
}

// CRC16-CCITT-FALSE: polinômio 0x1021, valor inicial 0xFFFF, sem reflexão, sem XOR final —
// exatamente o algoritmo exigido pelo campo 63 do padrão BR Code.
function crc16CcittFalse(texto) {
  let crc = 0xffff
  const poly = 0x1021
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ poly) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export function montarPayloadPix({ chave, nome, cidade }) {
  const nomeTruncado = nome.toUpperCase().slice(0, 25)
  const cidadeTruncada = cidade.toUpperCase().slice(0, 15)

  const contaPix = campo('00', GUI_PIX) + campo('01', chave)

  const semCrc =
    campo('00', '01') + // Payload Format Indicator
    campo('01', '11') + // Point of Initiation Method (estático/reutilizável)
    campo('26', contaPix) + // Merchant Account Information (PIX)
    campo('52', '0000') + // Merchant Category Code
    campo('53', '986') + // Transaction Currency (BRL)
    campo('58', 'BR') + // Country Code
    campo('59', nomeTruncado) + // Merchant Name
    campo('60', cidadeTruncada) + // Merchant City
    campo('62', campo('05', '***')) + // Additional Data Field Template (sem txid específico)
    '6304' // header do campo 63 (CRC16) — o valor vem logo em seguida

  return semCrc + crc16CcittFalse(semCrc)
}
