import { describe, it, expect } from 'vitest'
import { Readable, PassThrough } from 'node:stream'
import { gzipSync, gunzipSync } from 'node:zlib'
import { S3Client } from '@aws-sdk/client-s3'
import { streamObject, presignUpload, presignDownload } from '../src/r2.js'

it('assina o Content-Length do PUT quando o tamanho é informado', async () => {
  const client = new S3Client({
    region: 'auto', endpoint: 'https://r2.example',
    credentials: { accessKeyId: 'teste', secretAccessKey: 'teste' },
  })
  try {
    const url = new URL(await presignUpload(client, 'demos', 'teste.dem', 'application/octet-stream', 900, 123))
    expect(url.searchParams.get('X-Amz-SignedHeaders').split(';')).toContain('content-length')
  } finally {
    client.destroy()
  }
})

it('assina o GET com tipo e disposição quando a mídia é anexo', async () => {
  const client = new S3Client({
    region: 'auto', endpoint: 'https://r2.example',
    credentials: { accessKeyId: 'teste', secretAccessKey: 'teste' },
  })
  try {
    const url = new URL(await presignDownload(client, 'demos', 'demos/m1.dem.bz2', 600, {
      responseContentType: 'application/octet-stream',
      responseContentDisposition: 'attachment; filename="m1.dem.bz2"',
    }))
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600')
    expect(url.searchParams.get('response-content-type')).toBe('application/octet-stream')
    expect(url.searchParams.get('response-content-disposition')).toContain('attachment')
    expect(url.searchParams.get('response-content-disposition')).toContain('m1.dem.bz2')
  } finally {
    client.destroy()
  }
})

function respostaCaptura() {
  const out = new PassThrough()
  const chunks = []
  out.on('data', (c) => chunks.push(c))
  const headers = {}
  out.type = (t) => {
    headers['content-type'] = t
    return out
  }
  out.set = (k, v) => {
    headers[k.toLowerCase()] = v
    return out
  }
  return {
    res: out,
    headers,
    body: () => Buffer.concat(chunks),
  }
}

describe('streamObject', () => {
  it('repassa Content-Encoding gzip e o corpo cru, sem descomprimir nem recomprimir', async () => {
    const cru = Buffer.from('{"map":"de_mirage","rounds":[]}')
    const gz = gzipSync(cru)
    const cap = respostaCaptura()
    await streamObject({
      send: async () => ({ ContentType: 'application/json', ContentEncoding: 'gzip', Body: Readable.from([gz]) }),
    }, 'resenha-demos', 'replays/1.json', cap.res)

    expect(cap.headers['content-type']).toBe('application/json')
    expect(cap.headers['content-encoding']).toBe('gzip')
    expect(cap.body().equals(gz)).toBe(true)
    expect(JSON.parse(gunzipSync(cap.body()).toString())).toEqual({ map: 'de_mirage', rounds: [] })
  })

  it('replay antigo sem Content-Encoding segue JSON puro, sem header e sem gzip', async () => {
    const cru = Buffer.from('{"map":"de_dust2"}')
    const cap = respostaCaptura()
    await streamObject({
      send: async () => ({ ContentType: 'application/json', Body: Readable.from([cru]) }),
    }, 'resenha-demos', 'replays/1.json', cap.res)

    expect(cap.headers['content-encoding']).toBeUndefined()
    expect(cap.body().equals(cru)).toBe(true)
    expect(JSON.parse(cap.body().toString())).toEqual({ map: 'de_dust2' })
  })
})
