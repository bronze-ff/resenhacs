import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { pipeline } from 'node:stream/promises'

// O bucket é privado (dados reais dos participantes, sem consentimento pra ficar
// público). Este cliente é usado só no servidor, pra fazer proxy autenticado —
// as credenciais nunca chegam ao browser.
export function createR2Client(config) {
  if (!config.r2AccountId || !config.r2AccessKeyId || !config.r2SecretAccessKey) return null
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: config.r2SecretAccessKey,
    },
  })
}

// Extrai a key do objeto a partir da URL completa gravada no banco
// (https://ACCOUNT.r2.cloudflarestorage.com/BUCKET/key/do/objeto → "key/do/objeto").
export function keyFromR2Url(url, bucket) {
  if (!url || !bucket) return null
  const marcador = `/${bucket}/`
  const idx = url.indexOf(marcador)
  if (idx === -1) return null
  return url.slice(idx + marcador.length)
}

// URL assinada de PUT direto pro R2: o cliente sobe o arquivo sem os bytes passarem
// pela função serverless do Express (limite de corpo ~4.5MB / 15s da Vercel não
// aguentaria um .rar/.dem de 50-300MB).
export async function presignUpload(client, bucket, key, contentType, expiresInSeconds = 900) {
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType })
  return getSignedUrl(client, cmd, { expiresIn: expiresInSeconds })
}

// URL assinada de GET direto do R2 pro navegador: usada pro player de vídeo do Curso de Mira
// assistir sem os bytes passarem pela função serverless (arquivos de ~2GB esbarrariam no
// limite de tempo/tamanho da Vercel) — o R2 já entende os pedidos parciais (Range) que o
// <video> usa sozinho pra avançar/retroceder.
export async function presignDownload(client, bucket, key, expiresInSeconds = 7200) {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key })
  return getSignedUrl(client, cmd, { expiresIn: expiresInSeconds })
}

export async function streamObject(client, bucket, key, res) {
  const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  if (obj.ContentType) res.type(obj.ContentType)
  // pipeline (não .pipe): um 'error' do stream do R2 no meio da transferência de um
  // demo de ~200MB sem listener derrubaria o processo inteiro; aqui vira rejeição
  // que o caller (matches.js) já trata com 502.
  await pipeline(obj.Body, res)
}
