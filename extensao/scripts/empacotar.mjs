import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'

// shortcut: lista fixa da v1; ampliar ao adicionar módulos ou assets ao X-EXT.
const ARQUIVOS = [
  'manifest.json',
  'src/config.js',
  'src/filtro.js',
  'src/background.js',
  'popup/popup.html',
  'popup/popup.js',
  'popup/popup.css',
  'icons/icon-16.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
].sort()

export function empacotar(diretorio = fileURLToPath(new URL('../', import.meta.url))) {
  const raiz = realpathSync(diretorio)
  function ler(nome) {
    const arquivo = realpathSync(path.join(raiz, nome))
    if (!arquivo.startsWith(raiz + path.sep)) throw new Error(`Arquivo fora da extensão: ${nome}`)
    return readFileSync(arquivo)
  }
  const manifest = JSON.parse(ler('manifest.json').toString('utf8'))
  if (typeof manifest.version !== 'string' || !/^\d+(?:\.\d+){0,3}$/.test(manifest.version)) {
    throw new Error('Versão inválida no manifest')
  }
  delete manifest.key
  const epoch = process.env.SOURCE_DATE_EPOCH ?? '315532800'
  const data = new Date(Number(epoch) * 1000)
  if (!/^\d+$/.test(epoch) || !Number.isSafeInteger(Number(epoch)) ||
      !Number.isFinite(data.getTime()) || data.getUTCFullYear() < 1980 || data.getUTCFullYear() > 2107) {
    throw new Error('SOURCE_DATE_EPOCH deve estar entre 1980 e 2107')
  }
  const horaZip = (data.getUTCHours() << 11) | (data.getUTCMinutes() << 5) | (data.getUTCSeconds() >> 1)
  const dataZip = ((data.getUTCFullYear() - 1980) << 9) | ((data.getUTCMonth() + 1) << 5) | data.getUTCDate()
  const locais = []
  const centrais = []
  let offset = 0
  for (const arquivo of ARQUIVOS) {
    const nome = Buffer.from(arquivo)
    const dados = arquivo === 'manifest.json' ? Buffer.from(JSON.stringify(manifest, null, 2) + '\n') : ler(arquivo)
    const comprimido = deflateRawSync(dados)
    const checksum = crc32(dados)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(horaZip, 10)
    local.writeUInt16LE(dataZip, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(comprimido.length, 18)
    local.writeUInt32LE(dados.length, 22)
    local.writeUInt16LE(nome.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(horaZip, 12)
    central.writeUInt16LE(dataZip, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(comprimido.length, 20)
    central.writeUInt32LE(dados.length, 24)
    central.writeUInt16LE(nome.length, 28)
    central.writeUInt32LE(offset, 42)
    locais.push(local, nome, comprimido)
    centrais.push(central, nome)
    offset += local.length + nome.length + comprimido.length
  }
  const diretorioCentral = Buffer.concat(centrais)
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0)
  fim.writeUInt16LE(ARQUIVOS.length, 8)
  fim.writeUInt16LE(ARQUIVOS.length, 10)
  fim.writeUInt32LE(diretorioCentral.length, 12)
  fim.writeUInt32LE(offset, 16)
  const destino = path.join(raiz, 'dist', `resenhacs-extensao-${manifest.version}.zip`)
  mkdirSync(path.dirname(destino), { recursive: true })
  writeFileSync(destino, Buffer.concat([...locais, diretorioCentral, fim]))
  return destino
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(empacotar())
  } catch (erro) {
    console.error(erro.message)
    process.exitCode = 1
  }
}
