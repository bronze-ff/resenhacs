import { describe, expect, it } from 'vitest'
import { FACEIT_DEMO_HOSTS } from '../src/config.js'
import { filtrarDownload, linkDaPartida } from '../src/filtro.js'
import { download, faceitMatchId, hosts, matchId } from './fakes.js'

describe('filtro de downloads', () => {
  it('fica fechado enquanto o X0 não confirmar os hosts', () => {
    expect(FACEIT_DEMO_HOSTS).toEqual([])
    expect(filtrarDownload(download)).toBeNull()
  })

  it('aceita Demo do host exato e extrai só o id da sala', () => {
    expect(filtrarDownload(download, hosts)).toEqual({ faceitMatchId, downloadUrl: download.url })
  })

  it('prioriza finalUrl e aceita a extensão no caminho ou no filename', () => {
    const finalUrl = 'https://demos.faceit.test/arquivo?assinatura=ficticia'
    expect(filtrarDownload({ ...download, url: 'https://outro.test/demo.dem', finalUrl }, hosts)).toEqual({ faceitMatchId, downloadUrl: finalUrl })
    expect(filtrarDownload({ ...download, filename: '', url: 'https://demos.faceit.test/demo.dem' }, hosts)).not.toBeNull()
  })

  it.each([
    'http://demos.faceit.test/demo.dem', 'https://demos.faceit.test.evil.test/demo.dem',
    'https://sub.demos.faceit.test/demo.dem', 'https://user:senha@demos.faceit.test/demo.dem',
    'https://demos.faceit.test:444/demo.dem', 'file:///demo.dem', 'javascript:alert(1)',
    `https://demos.faceit.test/demo.dem?${'a'.repeat(2048)}`,
  ])('recusa URL fora da fronteira: %s', (url) => {
    expect(filtrarDownload({ ...download, url }, hosts)).toBeNull()
  })

  it('não recua para url se finalUrl for recusada', () => {
    expect(filtrarDownload({ ...download, finalUrl: 'https://outro.test/demo.dem' }, hosts)).toBeNull()
  })

  it('ignora arquivos que não sejam .dem ou .dem.gz', () => {
    expect(filtrarDownload({ ...download, url: 'https://demos.faceit.test/a.zip', filename: 'a.dem.gz.exe' }, hosts)).toBeNull()
  })

  it.each([
    `https://www.faceit.com/room/${faceitMatchId}`,
    `https://www.faceit.com/en/cs2/room/${faceitMatchId.toUpperCase()}`,
  ])('reconhece sala permitida: %s', (referrer) => {
    expect(filtrarDownload({ ...download, referrer }, hosts).faceitMatchId).toBe(faceitMatchId)
  })

  it.each([
    '', `https://evil.test/room/${faceitMatchId}`, `https://www.faceit.com.evil.test/room/${faceitMatchId}`,
    `http://www.faceit.com/room/${faceitMatchId}`, `https://www.faceit.com/room/${faceitMatchId}/extra`,
    'https://www.faceit.com/room/invalido',
  ])('Demo sem sala reconhecida não inventa id do nome: %s', (referrer) => {
    expect(filtrarDownload({ ...download, referrer, filename: `${faceitMatchId}.dem.gz` }, hosts)).toEqual({ faceitMatchId: null, downloadUrl: download.url })
  })
})

describe('links do histórico', () => {
  it('fixa origem e aceita apenas UUID de Partida', () => {
    expect(linkDaPartida(matchId)).toBe(`https://resenha-phi.vercel.app/partida/${matchId}`)
    for (const id of [null, '', faceitMatchId, 'javascript:alert(1)', '../../conta', '<img src=x>']) {
      expect(linkDaPartida(id)).toBeNull()
    }
  })
})
