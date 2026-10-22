import { vi } from 'vitest'

export const faceitMatchId = '1-12345678-1234-1234-1234-123456789abc'
export const matchId = '12345678-1234-1234-1234-123456789abc'
export const hosts = ['demos.faceit.test']
export const download = {
  id: 7, url: 'https://demos.faceit.test/demo.dem.gz?assinatura=ficticia',
  referrer: `https://www.faceit.com/pt-br/cs2/room/${faceitMatchId}`, filename: 'C:\\Downloads\\demo.dem.gz',
}

export function criarChrome(inicial = { token: 'resenha-ficticio' }) {
  const listeners = {}
  const evento = (nome) => ({ addListener: vi.fn((fn) => { listeners[nome] = fn }) })
  const storage = (inicial) => {
    const dados = structuredClone(inicial)
    return {
      dados,
      get: vi.fn(async () => structuredClone(dados)),
      set: vi.fn(async (valor) => Object.assign(dados, structuredClone(valor))),
      remove: vi.fn(async (chaves) => { for (const chave of [].concat(chaves)) delete dados[chave] }),
      setAccessLevel: vi.fn(async () => {}),
    }
  }
  const chrome = {
    storage: { local: storage(inicial), session: storage({}) },
    runtime: {
      id: 'extensao-teste', getURL: (path) => `chrome-extension://extensao-teste/${path}`,
      onMessageExternal: evento('external'), onMessage: evento('message'),
    },
    downloads: { onCreated: evento('created'), onChanged: evento('changed'), search: vi.fn(async () => [download]) },
    action: { setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}) },
  }
  return { chrome, listeners }
}

export const resposta = (status, corpo) => ({ status, ok: status >= 200 && status < 300, json: async () => corpo })
