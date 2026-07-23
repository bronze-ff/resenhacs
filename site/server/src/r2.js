import {
  S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand, ListPartsCommand,
} from '@aws-sdk/client-s3'
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

// --- Upload em partes (multipart) ---
// Um PUT único do arquivo inteiro estoura a memória da aba do navegador em arquivos de vários
// GB (um vídeo de 2 GB matava o processo do Chrome com STATUS_BREAKPOINT). O navegador manda
// pedaços de ~100 MiB, cada um numa requisição própria, e o R2 remonta o objeto no fim.

export async function iniciarMultipart(client, bucket, key, contentType) {
  const out = await client.send(new CreateMultipartUploadCommand({
    Bucket: bucket, Key: key, ContentType: contentType,
  }))
  return out.UploadId
}

export async function presignUploadPart(client, bucket, key, uploadId, partNumber, expiresInSeconds = 7200) {
  const cmd = new UploadPartCommand({
    Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber,
  })
  return getSignedUrl(client, cmd, { expiresIn: expiresInSeconds })
}

// Pergunta ao R2 quais partes chegaram, em vez de exigir que o navegador leia o header ETag de
// cada PUT — ler ETag no JS exigiria ExposeHeaders no CORS do bucket (passo manual no painel da
// Cloudflare). ListParts pagina em 1000 por página; quem chama limita as partes a 1000, então
// uma página basta.
export async function concluirMultipart(client, bucket, key, uploadId) {
  const listadas = await client.send(new ListPartsCommand({
    Bucket: bucket, Key: key, UploadId: uploadId, MaxParts: 1000,
  }))
  const partes = (listadas.Parts ?? [])
    .map((p) => ({ ETag: p.ETag, PartNumber: p.PartNumber }))
    .sort((a, b) => a.PartNumber - b.PartNumber)
  if (partes.length === 0) throw new Error('Nenhuma parte foi enviada')
  await client.send(new CompleteMultipartUploadCommand({
    Bucket: bucket, Key: key, UploadId: uploadId,
    MultipartUpload: { Parts: partes },
  }))
}

export async function abortarMultipart(client, bucket, key, uploadId) {
  await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
}

// Existe no bucket? Qualquer erro (404 do R2, credencial ruim, rede) vira false: isto alimenta
// só um rótulo de UI ("ainda não disponível"), e falhar fechado é o comportamento certo aqui.
export async function objetoExiste(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch {
    return false
  }
}
