import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, inflateRawSync } from 'node:zlib'

const script = new URL('../scripts/empacotar.mjs', import.meta.url).href
const temporarios = []
const manifest = {
  manifest_version: 3,
  name: 'ResenhaCS',
  version: '0.1.0',
  key: 'chave-local',
  permissions: ['downloads', 'storage'],
  host_permissions: ['https://resenhacs.vercel.app/*'],
  externally_connectable: { matches: ['https://resenha-phi.vercel.app/*'] },
  background: { service_worker: 'src/background.js', type: 'module' },
  action: { default_popup: 'popup/popup.html' },
  icons: { 16: 'icons/icon-16.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
}
const arquivos = {
  'manifest.json': JSON.stringify(manifest),
  'src/config.js': 'export const FACEIT_DEMO_HOSTS = []\n',
  'src/filtro.js': 'export const filtrar = () => null\n',
  'src/background.js': "import './config.js'\n",
  'popup/popup.html': '<html lang="pt-BR"><script src="popup.js" type="module"></script></html>',
  'popup/popup.js': 'export const abrir = () => {}\n',
  'popup/popup.css': 'body { color: white }\n',
  'icons/icon-16.png': Buffer.from([137, 80, 78, 71, 16]),
  'icons/icon-48.png': Buffer.from([137, 80, 78, 71, 48]),
  'icons/icon-128.png': Buffer.from([137, 80, 78, 71, 128]),
}

function fixture() {
  const raiz = mkdtempSync(path.join(tmpdir(), 'resenhacs-extensao-pkg-'))
  temporarios.push(raiz)
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    mkdirSync(path.dirname(path.join(raiz, nome)), { recursive: true })
    writeFileSync(path.join(raiz, nome), conteudo)
  }
  return raiz
}

function executar(raiz, epoch) {
  const env = { ...process.env }
  delete env.SOURCE_DATE_EPOCH
  if (epoch !== undefined) env.SOURCE_DATE_EPOCH = epoch
  return spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { empacotar } from ${JSON.stringify(script)}; console.log(empacotar(process.argv[1]))`, raiz],
  { env, encoding: 'utf8' })
}

function lerZip(arquivo) {
  const zip = readFileSync(arquivo)
  const fim = zip.subarray(-22)
  expect(fim.readUInt32LE(0)).toBe(0x06054b50)
  const entradas = []
  let posicao = fim.readUInt32LE(16)
  for (let i = 0; i < fim.readUInt16LE(10); i++) {
    expect(zip.readUInt32LE(posicao)).toBe(0x02014b50)
    const tamanhoNome = zip.readUInt16LE(posicao + 28)
    const nome = zip.subarray(posicao + 46, posicao + 46 + tamanhoNome).toString('utf8')
    const local = zip.readUInt32LE(posicao + 42)
    expect(zip.readUInt32LE(local)).toBe(0x04034b50)
    expect(zip.readUInt16LE(local + 8)).toBe(8)
    const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const dados = inflateRawSync(zip.subarray(inicio, inicio + zip.readUInt32LE(local + 18)))
    expect(dados.length).toBe(zip.readUInt32LE(local + 22))
    expect(crc32(dados)).toBe(zip.readUInt32LE(posicao + 16))
    expect(crc32(dados)).toBe(zip.readUInt32LE(local + 14))
    expect(zip.readUInt16LE(local + 10)).toBe(zip.readUInt16LE(posicao + 12))
    expect(zip.readUInt16LE(local + 12)).toBe(zip.readUInt16LE(posicao + 14))
    entradas.push({ nome, dados, hora: zip.readUInt16LE(local + 10), data: zip.readUInt16LE(local + 12) })
    posicao += 46 + tamanhoNome + zip.readUInt16LE(posicao + 30) + zip.readUInt16LE(posicao + 32)
  }
  return entradas
}

function referenciasRuntime(raiz) {
  const resultado = spawnSync(process.execPath, ['--experimental-vm-modules', '--disable-warning=ExperimentalWarning',
    '--input-type=module', '-e', String.raw`
      import { readFileSync, readdirSync } from 'node:fs'
      import path from 'node:path'
      import { SourceTextModule } from 'node:vm'
      const raiz = process.argv[1]
      const ler = (nome) => readFileSync(path.join(raiz, nome), 'utf8')
      const manifest = JSON.parse(ler('manifest.json'))
      const icones = (valor) => typeof valor === 'string' ? [valor] : Object.values(valor ?? {})
      const referencias = new Set(['manifest.json', manifest.background?.service_worker,
        manifest.action?.default_popup, ...icones(manifest.icons), ...icones(manifest.action?.default_icon)].filter(Boolean))
      function adicionar(origem, referencia) {
        const url = new URL(referencia, 'https://extensao.invalid/' + origem)
        if (url.origin !== 'https://extensao.invalid') throw new Error('Recurso remoto: ' + referencia)
        referencias.add(decodeURIComponent(url.pathname.slice(1)))
      }
      for (const diretorio of ['src', 'popup']) {
        for (const relativo of readdirSync(path.join(raiz, diretorio), { recursive: true })) {
          if (!relativo.endsWith('.js')) continue
          const nome = diretorio + '/' + relativo.split(path.sep).join('/')
          const modulo = new SourceTextModule(ler(nome))
          for (const pedido of modulo.moduleRequests) adicionar(nome, pedido.specifier)
        }
      }
      if (manifest.action?.default_popup) {
        const pagina = manifest.action.default_popup
        for (const recurso of ler(pagina).matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*['"]([^'"]+)['"]/gi)) {
          adicionar(pagina, recurso[1])
        }
      }
      console.log(JSON.stringify([...referencias].sort()))
    `, raiz], { encoding: 'utf8' })
  expect(resultado.status, resultado.stderr).toBe(0)
  return JSON.parse(resultado.stdout)
}

afterEach(() => {
  for (const raiz of temporarios.splice(0)) rmSync(raiz, { recursive: true, force: true })
})

describe('empacotamento da extensão', () => {
  const raizXext = fileURLToPath(new URL('../', import.meta.url))
  it.skipIf(!existsSync(path.join(raizXext, 'manifest.json')))('cobre manifest e imports estáticos do X-EXT no ZIP', () => {
    const resultado = executar(fixture())
    expect(resultado.status, resultado.stderr).toBe(0)
    const empacotados = new Set(lerZip(resultado.stdout.trim()).map(({ nome }) => nome))
    expect(referenciasRuntime(raizXext).filter((nome) => !empacotados.has(nome))).toEqual([])
  })

  it.skipIf(!existsSync(path.join(raizXext, 'manifest.json')))('textos do ZIP do X-EXT não contêm CR', () => {
    const raiz = fixture()
    for (const nome of Object.keys(arquivos)) copyFileSync(path.join(raizXext, nome), path.join(raiz, nome))
    const resultado = executar(raiz)
    expect(resultado.status, resultado.stderr).toBe(0)
    for (const { nome, dados } of lerZip(resultado.stdout.trim())) {
      if (!nome.endsWith('.png')) expect(dados.includes(13), nome).toBe(false)
    }
  })

  it.each(['src/background.js', 'popup/popup.js'])('detecta dependência estática ausente do ZIP em %s', (origem) => {
    const raiz = fixture()
    const novo = path.posix.join(path.posix.dirname(origem), 'novo.js')
    writeFileSync(path.join(raiz, origem), "export { novo } from './novo.js'\n")
    writeFileSync(path.join(raiz, novo), 'export const novo = 1\n')
    const resultado = executar(raiz)
    expect(resultado.status, resultado.stderr).toBe(0)
    const empacotados = new Set(lerZip(resultado.stdout.trim()).map(({ nome }) => nome))
    expect(referenciasRuntime(raiz).filter((nome) => !empacotados.has(nome))).toEqual([novo])
  })

  it('gera ZIP ordenado só com os arquivos de runtime e remove key sem mudar o manifest original', () => {
    const raiz = fixture()
    for (const nome of ['README.md', 'segredo.pem', 'src/segredo.pem', 'test/teste.js', 'node_modules/pacote.js', 'loja/dados.md']) {
      mkdirSync(path.dirname(path.join(raiz, nome)), { recursive: true })
      writeFileSync(path.join(raiz, nome), 'fora do ZIP')
    }
    const resultado = executar(raiz)
    expect(resultado.status, resultado.stderr).toBe(0)
    expect(resultado.stdout.trim()).toBe(path.join(raiz, 'dist/resenhacs-extensao-0.1.0.zip'))
    const entradas = lerZip(resultado.stdout.trim())
    expect(entradas.map(({ nome }) => nome)).toEqual(Object.keys(arquivos).sort())
    for (const entrada of entradas.filter(({ nome }) => nome !== 'manifest.json')) {
      expect(entrada.dados).toEqual(Buffer.from(arquivos[entrada.nome]))
    }
    const publicado = JSON.parse(entradas.find(({ nome }) => nome === 'manifest.json').dados.toString('utf8'))
    expect(publicado).toEqual({ ...manifest, key: undefined })
    expect(Object.hasOwn(publicado, 'key')).toBe(false)
    expect(JSON.parse(readFileSync(path.join(raiz, 'manifest.json'), 'utf8'))).toEqual(manifest)
    expect(entradas.every(({ data, hora }) => data === 33 && hora === 0)).toBe(true)
  })

  it('duas execuções têm o mesmo SHA256 mesmo com mtimes diferentes', () => {
    const raiz = fixture()
    const primeira = executar(raiz)
    expect(primeira.status, primeira.stderr).toBe(0)
    const hash = createHash('sha256').update(readFileSync(primeira.stdout.trim())).digest('hex')
    for (const nome of Object.keys(arquivos)) utimesSync(path.join(raiz, nome), new Date(), new Date())
    const segunda = executar(raiz)
    expect(segunda.status, segunda.stderr).toBe(0)
    expect(createHash('sha256').update(readFileSync(segunda.stdout.trim())).digest('hex')).toBe(hash)
  })

  it('usa SOURCE_DATE_EPOCH em UTC, com a precisão de dois segundos do ZIP', () => {
    const resultado = executar(fixture(), '1704164647') // 2024-01-02T03:04:07Z, gravado como 03:04:06.
    expect(resultado.status, resultado.stderr).toBe(0)
    expect(lerZip(resultado.stdout.trim()).every(({ data, hora }) => data === 22562 && hora === 6275)).toBe(true)
  })

  it.each(['../fora', '1/2', ''])('recusa versão que não pode formar o nome do ZIP: %s', (version) => {
    const raiz = fixture()
    writeFileSync(path.join(raiz, 'manifest.json'), JSON.stringify({ ...manifest, version }))
    const resultado = executar(raiz)
    expect(resultado.status).not.toBe(0)
    expect(resultado.stderr).toMatch(/versão/i)
    expect(existsSync(path.join(raiz, 'dist'))).toBe(false)
  })

  it.each(['abc', '0', '999999999999'])('recusa SOURCE_DATE_EPOCH inválido: %s', (epoch) => {
    const raiz = fixture()
    const resultado = executar(raiz, epoch)
    expect(resultado.status).not.toBe(0)
    expect(resultado.stderr).toMatch(/SOURCE_DATE_EPOCH/)
    expect(existsSync(path.join(raiz, 'dist'))).toBe(false)
  })

  it('não gera um ZIP incompleto quando falta um arquivo de runtime', () => {
    const raiz = fixture()
    rmSync(path.join(raiz, 'src/filtro.js'))
    const resultado = executar(raiz)
    expect(resultado.status).not.toBe(0)
    expect(resultado.stderr).toMatch(/filtro\.js/)
    expect(existsSync(path.join(raiz, 'dist'))).toBe(false)
  })

  it('não lê arquivos que uma junction aponta para fora da extensão', () => {
    const raiz = fixture()
    const fora = fixture()
    rmSync(path.join(raiz, 'icons'), { recursive: true })
    symlinkSync(path.join(fora, 'icons'), path.join(raiz, 'icons'), 'junction')
    const resultado = executar(raiz)
    expect(resultado.status).not.toBe(0)
    expect(resultado.stderr).toMatch(/fora da extensão/)
    expect(existsSync(path.join(raiz, 'dist'))).toBe(false)
  })
})

it('verify extensao executa só o npm test da extensão', () => {
  const raiz = fixture()
  mkdirSync(path.join(raiz, 'scripts'))
  mkdirSync(path.join(raiz, 'extensao'))
  copyFileSync(fileURLToPath(new URL('../../scripts/verify.mjs', import.meta.url)), path.join(raiz, 'scripts/verify.mjs'))
  writeFileSync(path.join(raiz, 'extensao/package.json'), JSON.stringify({ scripts: {
    test: `node -e "require('node:fs').writeFileSync('rodou.txt','ok')"`,
  } }))
  const resultado = spawnSync(process.execPath, [path.join(raiz, 'scripts/verify.mjs'), 'extensao'], { encoding: 'utf8' })
  expect(resultado.status, resultado.stderr).toBe(0)
  expect(readFileSync(path.join(raiz, 'extensao/rodou.txt'), 'utf8')).toBe('ok')
})
