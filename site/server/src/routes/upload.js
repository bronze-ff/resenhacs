import { Router } from 'express'
import multer from 'multer'
import { execFile as execFileNode } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

// Demos reais de MM ficam por volta de 150-250MB; 320MB dá folga confortável.
const MAX_BYTES = 320 * 1024 * 1024

const SHARE_CODE_RE = /^CSGO(-\S{5}){5}$/
// aceita datetime-local do browser ("2026-07-09T20:15") ou ISO completo com timezone
const PLAYED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, os.tmpdir()),
  filename: (req, file, cb) => {
    const nome = `resenha-upload-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`
    cb(null, nome)
  },
})

const upload = multer({ storage, limits: { fileSize: MAX_BYTES } })

// Roda o Coletor (Python) local via child_process contra o .dem enviado. Só disponível
// quando coletorDir/pythonBin estão configurados (dev/self-hosted); na Vercel a rota
// não é montada (ver app.js) — lá o caminho manual precisa da fila via R2 (TODO futuro).
export function createUploadRouter({ requireAuth, coletorDir, pythonBin, execFileImpl = execFileNode }) {
  const router = Router()

  router.post('/', requireAuth, upload.single('demo'), async (req, res) => {
    const limpar = () => { if (req.file) fs.unlink(req.file.path, () => {}) }

    if (!req.file) {
      return res.status(400).json({ erro: 'Nenhum arquivo enviado (campo "demo")' })
    }
    if (!req.file.originalname.toLowerCase().endsWith('.dem')) {
      limpar()
      return res.status(400).json({ erro: 'Só arquivos .dem são aceitos (demos comprimidos .bz2/.gz ainda não)' })
    }
    const shareCode = String(req.body?.shareCode ?? '').trim()
    if (shareCode && !SHARE_CODE_RE.test(shareCode)) {
      limpar()
      return res.status(400).json({ erro: 'Share code inválido (formato CSGO-…-…-…-…-…)' })
    }
    const playedAt = String(req.body?.playedAt ?? '').trim()
    if (playedAt && !PLAYED_AT_RE.test(playedAt)) {
      limpar()
      return res.status(400).json({ erro: 'Data/hora inválida' })
    }

    const args = ['-m', 'coletor.main', 'ingest', req.file.path, '--source', 'upload']
    if (shareCode) args.push('--share-code', shareCode)
    if (playedAt) args.push('--played-at', playedAt)

    execFileImpl(
      pythonBin,
      args,
      {
        cwd: coletorDir,
        env: { ...process.env, PYTHONPATH: 'src' },
        maxBuffer: 10 * 1024 * 1024,
        timeout: 5 * 60 * 1000,
      },
      (err, stdout, stderr) => {
        limpar()
        if (err) {
          return res.status(500).json({
            erro: 'Falha ao processar o demo',
            detalhe: (stderr || err.message || '').slice(-2000),
          })
        }
        const m = /ingest: Partida gravada (\S+)/.exec(stdout)
        res.json({ ok: true, matchId: m ? m[1] : null, log: stdout.slice(-2000) })
      },
    )
  })

  return router
}
