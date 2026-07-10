import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

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

export async function streamObject(client, bucket, key, res) {
  const obj = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  if (obj.ContentType) res.type(obj.ContentType)
  obj.Body.pipe(res)
}
