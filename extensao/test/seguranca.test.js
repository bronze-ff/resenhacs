import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_BASE, FACEIT_DEMO_HOSTS, SITE_ORIGIN } from '../src/config.js'

const raiz = fileURLToPath(new URL('../', import.meta.url))
const ler = (nome) => readFileSync(path.join(raiz, nome), 'utf8')

describe('fronteiras MV3', () => {
  it('manifest tem exatamente as permissões e origens da revisão 2', () => {
    const manifest = JSON.parse(ler('manifest.json'))
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.permissions).toEqual(['downloads', 'storage'])
    expect(manifest.host_permissions).toEqual([`${new URL(API_BASE).origin}/*`])
    expect(manifest.externally_connectable).toEqual({ matches: [`${SITE_ORIGIN}/*`] })
    expect(manifest.background).toEqual({ service_worker: 'src/background.js', type: 'module' })
    expect(manifest.action.default_popup).toBe('popup/popup.html')
    expect(manifest.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'")
    for (const proibido of ['content_scripts', 'optional_permissions', 'web_accessible_resources']) expect(manifest).not.toHaveProperty(proibido)
  })

  it('src e popup não executam código remoto nem interpretam HTML de dados', () => {
    const arquivos = ['src', 'popup'].flatMap((dir) => readdirSync(path.join(raiz, dir)).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`))
    for (const arquivo of arquivos) {
      expect(ler(arquivo)).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function|setTimeout\s*\(\s*['"`]|window\.postMessage|sentry|posthog/i)
      expect(ler(arquivo)).not.toMatch(/chrome\.(tabs|cookies|scripting|webRequest)|downloads\.(download|cancel|open|erase)\s*\(/)
    }
    expect(ler('popup/popup.html')).toMatch(/lang="pt-BR"/)
    expect(ler('popup/popup.html')).toMatch(/role="alert"/)
    expect(ler('popup/popup.html')).not.toMatch(/\son\w+=|<script[^>]+src="https?:/i)
  })
})

const compartilhado = path.join(raiz, '../shared/extensao/faceit-demo-hosts.json')
const pacoteIntegrado = existsSync(path.join(raiz, 'package.json'))
it.skipIf(!pacoteIntegrado && !existsSync(compartilhado))('T17: FACEIT_DEMO_HOSTS é igual ao JSON do X-PKG (pendente sem X-PKG)', () => {
  expect(FACEIT_DEMO_HOSTS).toEqual(JSON.parse(readFileSync(compartilhado, 'utf8')))
})
