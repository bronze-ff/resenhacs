import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pedidos = new Set(process.argv.slice(2))
const todos = pedidos.size === 0
const partes = new Set(['client', 'server', 'coletor', 'bot', 'extensao'])
for (const pedido of pedidos) {
  if (!partes.has(pedido)) {
    console.error(`Parte desconhecida: ${pedido}. Use client, server, coletor, bot ou extensao.`)
    process.exit(1)
  }
}

function quer(nome) {
  return todos || pedidos.has(nome)
}

function run(cmd, args, cwd) {
  const resultado = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (resultado.error) {
    console.error(resultado.error.message)
    process.exit(1)
  }
  if (resultado.status !== 0) process.exit(resultado.status ?? 1)
}

function pythonBin() {
  const py3 = spawnSync('python3', ['--version'], { stdio: 'ignore' })
  if (py3.status === 0) return 'python3'
  return 'python'
}

if (quer('client')) {
  run('npm', ['test'], path.join(root, 'site/client'))
  run('npm', ['run', 'build'], path.join(root, 'site/client'))
}
if (quer('server')) {
  run('npm', ['test'], path.join(root, 'site/server'))
}
if (quer('coletor')) {
  run(pythonBin(), ['-m', 'pytest', '-q'], path.join(root, 'coletor'))
}
if (quer('bot')) {
  run('node', ['--check', 'src/resolve.js'], path.join(root, 'bot'))
}
if (quer('extensao')) {
  run('npm', ['test'], path.join(root, 'extensao'))
}
