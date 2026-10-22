import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FACEIT_DEMO_HOSTS } from '../src/routes/extensao.js'

describe('expansão 0064', () => {
  it('adiciona só origem_url/origem com default compatível para o site antigo', () => {
    const sql = readFileSync(new URL('../../../supabase/migrations/0064_uploads_extensao.sql', import.meta.url), 'utf8')
      .replace(/--[^\n]*/g, '')
    expect(sql).toMatch(/add column origem_url text/)
    expect(sql).toMatch(/add column origem text not null default 'site'/)
    expect(sql).toContain("check (origem in ('site', 'extensao'))")
    expect(sql.match(/add column/g)).toHaveLength(2)
    expect(sql).not.toMatch(/\b(drop|delete|update)\b/i)
  })
})

const shared = new URL('../../../shared/extensao/faceit-demo-hosts.json', import.meta.url)
const pacote = new URL('../../../extensao/package.json', import.meta.url)
it('hosts fechados antes do X-PKG e iguais ao JSON após integração (obrigatório antes do PR)', () => {
  if (!existsSync(shared) && !existsSync(pacote)) {
    expect(FACEIT_DEMO_HOSTS).toEqual([])
    return
  }
  expect(FACEIT_DEMO_HOSTS).toEqual(JSON.parse(readFileSync(shared, 'utf8')))
})
