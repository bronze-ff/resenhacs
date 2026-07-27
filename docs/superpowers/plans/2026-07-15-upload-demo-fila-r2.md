# Envio manual de demo via fila R2 — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o upload manual de demo (que hoje trava com `413` na
Vercel, e só funciona em dev/self-hosted) por upload direto pro R2 via URL
pré-assinada + fila processada pelo Coletor a cada 30 min — mesmo padrão já
usado pela fila de Partidas Pro, mas aberto a qualquer membro do grupo.

**Architecture:** Nova tabela `uploads_pendentes` (escopada por `group_id`).
Servidor ganha `POST /api/upload/upload-url` (presign + insere na fila) e
perde a rota antiga (`child_process` síncrono). Cliente sobe o arquivo em 2
passos (pega a URL assinada, PUT direto pro R2) e mostra mensagem de "na
fila" em vez de resultado instantâneo. Coletor ganha
`processar-uploads-pendentes`, rodado pelo GitHub Actions a cada 30 min
(mesmo job que já roda `processar-fila-pro`).

**Tech Stack:** Express + `pg` (server), React (client), Python + psycopg
(coletor), GitHub Actions (agendamento).

## Global Constraints

- A rota antiga (`site/server/src/routes/upload.js`, baseada em `multer` +
  `child_process`) é REMOVIDA por completo, não mantida em paralelo —
  `config.coletorDir`/`config.pythonBin` saem de `config.js`, `index.js` e
  `app.js` também (nada mais os usa depois dessa mudança).
- Sem página/endpoint de status dos próprios envios — o cliente mostra só
  uma mensagem de confirmação após o PUT no R2 (decisão já tomada com o
  usuário).
- Sem botão de retry pra upload que falhou nessa fila (YAGNI — a fila pro
  tem porque foi pedido depois; aqui não foi pedido ainda).
- `ingest_demo`/`_finalizar_ingest` ganham um `group_id` opcional que,
  quando informado, tem PRIORIDADE sobre `dbmod.grupo_para_ingest` (que
  continua sendo o fallback pros outros chamadores que não sabem o grupo
  explicitamente — discover, reprocess, fila pro).
- Migração de banco (`0026_uploads_pendentes.sql`) exige confirmação
  explícita do usuário antes de aplicar em produção — só adiciona uma
  tabela nova, nada é alterado/apagado.
- Segue os padrões já estabelecidos no projeto: mesmo estilo de
  comentários em português explicando o "porquê", mesmo padrão de
  fila/status da `partidas_pro_fila`, mesmo padrão de testes com mocks
  (`appWith` no servidor, `monkeypatch` no coletor).

---

### Task 1: Migration `uploads_pendentes`

**Files:**
- Create: `supabase/migrations/0026_uploads_pendentes.sql`

**Interfaces:**
- Produces: tabela `uploads_pendentes (id, group_id, adicionado_por,
  arquivo_r2_key, share_code, played_at, status, match_id, erro,
  adicionado_em)`, consumida pelas Tasks 2 e 3.

- [ ] **Step 1: Escrever a migration**

```sql
create table uploads_pendentes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id),
  adicionado_por text not null,
  arquivo_r2_key text not null,
  share_code text,
  played_at timestamptz,
  status text not null default 'pendente',
  match_id uuid references matches(id),
  erro text,
  adicionado_em timestamptz not null default now()
);

create index uploads_pendentes_status_idx on uploads_pendentes (status);
```

- [ ] **Step 2: Reportar ao controlador pra aplicar em produção**

Essa migration precisa ser aplicada via Supabase MCP com confirmação
explícita do usuário (nomeando o arquivo) antes de qualquer código das
Tasks 2/3 rodar contra produção — isso é responsabilidade do controlador
da sessão (não do subagent implementador), então esse step só existe pra
deixar explícito que o arquivo `.sql` sozinho não basta.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0026_uploads_pendentes.sql
git commit -m "feat: migration da fila de uploads manuais de demo (uploads_pendentes)"
```

---

### Task 2: Coletor — fila de uploads pendentes

**Files:**
- Modify: `coletor/src/coletor/db.py`
- Modify: `coletor/src/coletor/main.py`
- Modify: `coletor/tests/test_storage_db.py`
- Modify: `coletor/tests/test_main.py`

**Interfaces:**
- Consumes: `storage_r2.make_client/download_bytes/delete_object` (já
  existem, usados por `cmd_processar_fila_pro` — mesmo padrão), a tabela
  `uploads_pendentes` da Task 1.
- Produces: `dbmod.listar_uploads_pendentes(conn)`,
  `dbmod.atualizar_upload_pendente(conn, upload_id, status, match_id=None, erro=None)`,
  `main.cmd_processar_uploads_pendentes(config, conn)`, subcomando CLI
  `processar-uploads-pendentes`. `ingest_demo(..., group_id=None)` e
  `_finalizar_ingest(..., group_id=None)` ganham o parâmetro novo (usado
  pela Task 2, consumido também pela Task 5 indiretamente via CLI).

- [ ] **Step 1: `listar_uploads_pendentes`/`atualizar_upload_pendente` em `db.py`**

Adicione logo depois de `atualizar_fila_pro` (por volta da linha 485 do
arquivo atual):

```python
def listar_uploads_pendentes(conn):
    with conn.cursor() as cur:
        cur.execute(
            "select id, group_id, adicionado_por, arquivo_r2_key, share_code, played_at "
            "from uploads_pendentes where status = 'pendente' order by adicionado_em"
        )
        return cur.fetchall()


def atualizar_upload_pendente(conn, upload_id, status, match_id=None, erro=None):
    with conn.cursor() as cur:
        cur.execute(
            "update uploads_pendentes set status = %s, match_id = %s, erro = %s where id = %s",
            (status, match_id, erro, upload_id),
        )
    conn.commit()
```

- [ ] **Step 2: Teste de `listar_uploads_pendentes`/`atualizar_upload_pendente` em `test_storage_db.py`**

Abra `coletor/tests/test_storage_db.py` e ache os testes de
`listar_fila_pro_pendente`/`atualizar_fila_pro` (servem de modelo — mesmo
padrão de cursor fake usado no resto do arquivo). Adicione, no mesmo
estilo:

```python
def test_listar_uploads_pendentes_devolve_so_status_pendente():
    conn = ConnFake([
        {"id": "u1", "group_id": "g1", "adicionado_por": "765",
         "arquivo_r2_key": "uploads-pendentes/abc.dem", "share_code": None, "played_at": None},
    ])
    rows = dbmod.listar_uploads_pendentes(conn)
    assert rows[0]["arquivo_r2_key"] == "uploads-pendentes/abc.dem"


def test_atualizar_upload_pendente_grava_status_match_id_e_erro():
    conn = ConnFake([])
    dbmod.atualizar_upload_pendente(conn, "u1", "concluido", match_id="m1")
    sql, params = conn.calls[-1]
    assert sql.startswith("update uploads_pendentes")
    assert params == ("concluido", "m1", None, "u1")
```

Adapte `ConnFake`/nomes exatos ao helper de mock JÁ USADO nesse arquivo pros
testes de `partidas_pro_fila` — não invente um helper novo, use o mesmo
padrão (o nome da classe fake pode ser diferente do que está acima; olhe o
arquivo antes de escrever).

- [ ] **Step 3: Rodar os testes desse arquivo**

Run: `cd coletor && .venv/Scripts/python -m pytest tests/test_storage_db.py -q`
(ou `.venv/bin/python` fora do Windows)
Expected: todos passam, incluindo os 2 novos.

- [ ] **Step 4: `group_id` explícito em `ingest_demo`/`_finalizar_ingest`**

Em `coletor/src/coletor/main.py`, altere a assinatura e o corpo de
`_finalizar_ingest` (por volta da linha 451):

```python
def _finalizar_ingest(config, conn, parsed, replay_json, dem_path_upload, share_code, source, upload, played_at, group_id=None):
    """... (docstring existente, sem mudança no texto já lá) ..."""
    demo_url = replay_url = None
    if upload and config.r2_endpoint:
        # ... corpo existente sem mudança até a linha do steam_ids/group_id ...

    steam_ids = [p["steam_id64"] for p in parsed.get("players", []) if p.get("steam_id64")]
    if group_id is None:
        group_id = dbmod.grupo_para_ingest(conn, steam_ids)
    return dbmod.store_parsed(
        conn, parsed, share_code=share_code, source=source,
        demo_url=demo_url, replay_url=replay_url,
        prefer_new_played_at=bool(played_at),
        group_id=group_id,
    )
```

(Só a linha `group_id = dbmod.grupo_para_ingest(...)` vira condicional — o
resto do corpo de `_finalizar_ingest` permanece idêntico ao que já está no
arquivo.)

E `ingest_demo` (por volta da linha 501) ganha o mesmo parâmetro, repassado
pra `_finalizar_ingest`:

```python
def ingest_demo(config, conn, path, share_code=None, source="upload", upload=True, played_at=None, group_id=None):
    """... (docstring existente) ..."""
    parsed = parsemod.parse_demo(path)
    # ... corpo existente sem mudança ...
    match_id = _finalizar_ingest(config, conn, parsed, replay_json, path, share_code, source, upload, played_at, group_id=group_id)
    _atualizar_avatares(config, conn, [p["steam_id64"] for p in parsed.get("players", [])])
    return match_id
```

- [ ] **Step 5: Teste de `group_id` explícito bypassando `grupo_para_ingest`**

Em `coletor/tests/test_main.py`, procure os testes existentes de
`ingest_demo`/`_finalizar_ingest` (se houver — se não houver nenhum teste
direto dessas funções hoje, adicione um novo, seguindo o padrão de
monkeypatch já usado no arquivo pra `main.storage_r2`/`main.ingest_demo`):

```python
def test_ingest_demo_com_group_id_explicito_nao_chama_grupo_para_ingest(monkeypatch, tmp_path):
    chamou_grupo_para_ingest = []
    monkeypatch.setattr(
        main.dbmod, "grupo_para_ingest",
        lambda conn, steam_ids: chamou_grupo_para_ingest.append(1) or "grupo-errado",
    )
    store_calls = []
    monkeypatch.setattr(
        main.dbmod, "store_parsed",
        lambda conn, parsed, **kw: store_calls.append(kw) or "m1",
    )
    monkeypatch.setattr(main.parsemod, "parse_demo", lambda path: {"players": [], "map": "de_mirage"})
    monkeypatch.setattr(main.transform, "fill_kd_from_kills", lambda players, kills: players)
    monkeypatch.setattr(main.transform, "enrich", lambda parsed: {**parsed, "kills": [], "highlights": []})

    config = _config_com_r2()
    dem = tmp_path / "demo.dem"
    dem.write_bytes(b"x")
    main.ingest_demo(config, ConnFake([]), dem, group_id="g-explicito", upload=False)

    assert chamou_grupo_para_ingest == []
    assert store_calls[-1]["group_id"] == "g-explicito"
```

Ajuste os `monkeypatch.setattr` pros nomes reais dos módulos/atributos como
o arquivo já importa (`main.dbmod`, `main.parsemod`, `main.transform` — olhe
como o resto do arquivo referencia esses módulos antes de copiar
literalmente; pode ser `main.parse_demo` direto em vez de `main.parsemod.parse_demo`
dependendo de como `main.py` importa). Se `extract_replay`/`build_replay`
também precisarem de mock pra esse teste não quebrar (a função real chama
isso dentro de um `try/except` best-effort — pode deixar falhar
silenciosamente e só checar um aviso no stdout, já que o teste não liga pro
replay 2D aqui).

- [ ] **Step 6: `cmd_processar_uploads_pendentes`**

Em `coletor/src/coletor/main.py`, adicione logo depois de
`cmd_processar_fila_pro` (por volta da linha 330):

```python
def cmd_processar_uploads_pendentes(config, conn):
    """Processa a fila de uploads manuais de demo (qualquer membro do grupo, via
    'Enviar Demo' no site): baixa o .dem do R2 (staging de upload direto via URL
    pré-assinada — a Vercel não aguenta receber o arquivo síncrono, ver
    site/server/src/routes/upload.js) e ingere com o group_id de quem enviou
    (não usa grupo_para_ingest aqui: já sabemos com certeza de qual grupo veio)."""
    import tempfile
    from pathlib import Path

    pendentes = dbmod.listar_uploads_pendentes(conn)
    if not pendentes:
        print("processar-uploads-pendentes: nenhum upload pendente")
        return 0

    client = storage_r2.make_client(config)
    total = 0
    for upload_id, group_id, adicionado_por, arquivo_r2_key, share_code, played_at in pendentes:
        dbmod.atualizar_upload_pendente(conn, upload_id, "processando")
        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp = Path(tmp)
                print(f"  {upload_id}: baixando do R2 ({arquivo_r2_key})")
                dados = storage_r2.download_bytes(client, config.r2_bucket, arquivo_r2_key)
                dem_path = tmp / "demo.dem"
                dem_path.write_bytes(dados)

                match_id = ingest_demo(
                    config, conn, dem_path,
                    share_code=share_code, source="upload", upload=True,
                    played_at=played_at, group_id=group_id,
                )
                dbmod.atualizar_upload_pendente(conn, upload_id, "concluido", match_id=match_id)
                print(f"  {upload_id}: concluido ({match_id})")
                total += 1
                storage_r2.delete_object(client, config.r2_bucket, arquivo_r2_key)
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            dbmod.atualizar_upload_pendente(conn, upload_id, "falhou", erro=str(e)[:500])
            print(f"  {upload_id}: FALHOU ({e})")

    print(f"processar-uploads-pendentes: {total} partida(s) processada(s)")
    return total
```

Status usados: `pendente` → `processando` → `concluido` ou `falhou` (bate
com o que a Task 3 grava no insert inicial e com o que a Task 1 documenta).

- [ ] **Step 7: Testes de `cmd_processar_uploads_pendentes`**

Em `coletor/tests/test_main.py`, siga EXATAMENTE o padrão de
`test_processar_fila_pro_com_arquivo_r2_key_baixa_do_r2_e_nao_chama_urlopen`
e `test_processar_fila_pro_mantem_staging_no_r2_quando_falha` (já no
arquivo, olhe a classe fake de cursor/conn usada lá — `_FilaCursor`/
`_FilaConn` ou equivalente) adaptando pra tabela/colunas de
`uploads_pendentes`:

```python
def test_processar_uploads_pendentes_baixa_do_r2_ingere_com_group_id_e_apaga_em_sucesso(monkeypatch):
    conn = _UploadsConn([("u1", "g1", "765", "uploads-pendentes/abc.dem", None, None)])
    config = _config_com_r2()

    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    downloads = []
    monkeypatch.setattr(
        main.storage_r2, "download_bytes",
        lambda client, bucket, key: (downloads.append((client, bucket, key)), b"dem-bytes")[1],
    )
    deletes = []
    monkeypatch.setattr(
        main.storage_r2, "delete_object",
        lambda client, bucket, key: deletes.append((bucket, key)),
    )
    ingests = []

    def _ingest_fake(cfg, cn, dem_path, share_code=None, source=None, upload=None, played_at=None, group_id=None):
        ingests.append((dem_path.name, source, upload, group_id))
        return "m1"

    monkeypatch.setattr(main, "ingest_demo", _ingest_fake)

    total = main.cmd_processar_uploads_pendentes(config, conn)

    assert total == 1
    assert downloads == [("fake-client", "resenha-demos", "uploads-pendentes/abc.dem")]
    assert ingests == [("demo.dem", "upload", True, "g1")]
    assert deletes == [("resenha-demos", "uploads-pendentes/abc.dem")]
    update = next(c for c in conn.calls if c[0].startswith("update uploads_pendentes") and c[1][0] == "concluido")
    assert update[1][1] == "m1"


def test_processar_uploads_pendentes_mantem_staging_no_r2_quando_falha(monkeypatch):
    conn = _UploadsConn([("u1", "g1", "765", "uploads-pendentes/abc.dem", None, None)])
    config = _config_com_r2()

    monkeypatch.setattr(main.storage_r2, "make_client", lambda cfg: "fake-client")
    monkeypatch.setattr(main.storage_r2, "download_bytes", lambda client, bucket, key: b"dem-bytes")
    deletes = []
    monkeypatch.setattr(main.storage_r2, "delete_object", lambda client, bucket, key: deletes.append((bucket, key)))
    monkeypatch.setattr(main, "ingest_demo", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("parser explodiu")))

    total = main.cmd_processar_uploads_pendentes(config, conn)

    assert total == 0
    assert deletes == []
    update = next(c for c in conn.calls if c[0].startswith("update uploads_pendentes") and c[1][0] == "falhou")
    assert "parser explodiu" in update[1][2]
```

Você vai precisar escrever `_UploadsConn`/o cursor fake equivalente a
`_FilaConn`/`_FilaCursor`, só trocando a query que o `fetchall()` reconhece
pra `"select id, group_id, adicionado_por, arquivo_r2_key, share_code, played_at from uploads_pendentes"`
e as tuplas de linha pra ter 6 campos em vez de 3. Reaproveite ao máximo a
estrutura das classes já existentes (copie e adapte, não invente um
mecanismo diferente).

- [ ] **Step 8: Subcomando CLI `processar-uploads-pendentes`**

Em `coletor/src/coletor/main.py`, dentro de `main()`, adicione ao lado de
`sub.add_parser("processar-fila-pro", ...)` (por volta da linha 635):

```python
    sub.add_parser(
        "processar-uploads-pendentes",
        help="Processa a fila de uploads manuais de demo (qualquer membro do grupo, via 'Enviar Demo').",
    )
```

E no bloco de despacho (por volta da linha 673, ao lado do
`elif args.cmd == "processar-fila-pro":`):

```python
        elif args.cmd == "processar-uploads-pendentes":
            cmd_processar_uploads_pendentes(config, conn)
```

- [ ] **Step 9: Rodar a suíte inteira do coletor**

Run: `cd coletor && .venv/Scripts/python -m pytest -q`
Expected: todos os testes passam (os já existentes + os novos dessa task).

- [ ] **Step 10: Commit**

```bash
git add coletor/src/coletor/db.py coletor/src/coletor/main.py coletor/tests/test_storage_db.py coletor/tests/test_main.py
git commit -m "feat: fila de uploads manuais de demo no Coletor (processar-uploads-pendentes) + group_id explicito no ingest"
```

---

### Task 3: Servidor — nova rota `/api/upload/upload-url`, remove a antiga

**Files:**
- Modify: `site/server/src/routes/upload.js` (reescrito por completo)
- Modify: `site/server/src/app.js`
- Modify: `site/server/src/config.js`
- Modify: `site/server/src/index.js`
- Modify: `site/server/test/upload.test.js` (reescrito por completo)

**Interfaces:**
- Consumes: `presignUpload` (já existe em `site/server/src/r2.js`, usada
  por `partidasPro.js` — mesma assinatura), tabela `uploads_pendentes` da
  Task 1.
- Produces: `POST /api/upload/upload-url` → `{ id, uploadUrl, key }`.
  Consumida pela Task 4.

- [ ] **Step 1: Reescrever `site/server/src/routes/upload.js`**

Substitua o arquivo inteiro por:

```js
import { Router } from 'express'
import crypto from 'node:crypto'
import { presignUpload } from '../r2.js'

const SHARE_CODE_RE = /^CSGO(-\S{5}){5}$/
// aceita datetime-local do browser ("2026-07-09T20:15") ou ISO completo com timezone
const PLAYED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)?$/

// Upload manual de demo: o arquivo (100-300MB) sobe DIRETO pro R2 via URL
// pré-assinada — nunca passa pelo corpo da request na função serverless
// (limite de payload da Vercel, poucos MB, não aguentaria). Uma linha fica
// pendente em uploads_pendentes; o Coletor (GitHub Actions, a cada 30 min)
// baixa do R2 e processa. Mesmo padrão já usado pela fila de Partidas Pro
// (site/server/src/routes/partidasPro.js), mas aberto a qualquer membro do
// grupo, não só super admin.
export function createUploadRouter({ db, requireAuth, requireGroupMember, r2Client, r2Bucket }) {
  const router = Router()

  router.post('/upload-url', requireAuth, requireGroupMember, async (req, res) => {
    if (!r2Client) return res.status(503).json({ erro: 'Arquivamento (R2) não configurado' })

    const filename = String(req.body?.filename ?? '').trim()
    if (!filename.toLowerCase().endsWith('.dem')) {
      return res.status(400).json({ erro: 'Só arquivos .dem são aceitos (demos comprimidos .bz2/.gz ainda não)' })
    }
    const shareCode = String(req.body?.shareCode ?? '').trim()
    if (shareCode && !SHARE_CODE_RE.test(shareCode)) {
      return res.status(400).json({ erro: 'Share code inválido (formato CSGO-…-…-…-…-…)' })
    }
    const playedAt = String(req.body?.playedAt ?? '').trim()
    if (playedAt && !PLAYED_AT_RE.test(playedAt)) {
      return res.status(400).json({ erro: 'Data/hora inválida' })
    }

    const key = `uploads-pendentes/${crypto.randomUUID()}.dem`
    const { rows } = await db.query(
      `insert into uploads_pendentes (group_id, adicionado_por, arquivo_r2_key, share_code, played_at)
       values ($1, $2, $3, $4, $5) returning id`,
      [req.groupId, req.player.steamId, key, shareCode || null, playedAt || null],
    )
    const uploadUrl = await presignUpload(r2Client, r2Bucket, key, 'application/octet-stream')
    res.json({ id: rows[0].id, uploadUrl, key })
  })

  return router
}
```

- [ ] **Step 2: Montar a rota nova em `app.js`, remover o gate condicional antigo**

Em `site/server/src/app.js`, troque o bloco (por volta das linhas 86-99):

```js
  // Upload manual via web só existe quando o Coletor Python está no mesmo host
  // (dev/self-hosted). Na Vercel (serverless) config.coletorDir/pythonBin ficam
  // indefinidos e a rota nem é montada — evita um 500 confuso em produção.
  if (config.coletorDir && config.pythonBin) {
    app.use(
      '/api/upload',
      createUploadRouter({
        requireAuth,
        coletorDir: config.coletorDir,
        pythonBin: config.pythonBin,
        ...(execFileImpl ? { execFileImpl } : {}),
      }),
    )
  } else {
    // Sem essa rota, um POST em /api/upload cairia no fallback SPA (200 com o HTML do
    // index) ou num 404 sem corpo JSON — o client tenta parsear como JSON, falha, e
    // mostra o erro genérico "Erro ao processar o demo" (engana sobre a causa real:
    // essa hospedagem não roda o Coletor local, não é falha no processamento).
    app.use('/api/upload', (req, res) => {
      res.status(503).json({
        erro: 'Envio manual de demo não está disponível nessa hospedagem — use a fila de Partidas Pro ou aguarde a descoberta automática da partida.',
      })
    })
  }
```

por:

```js
  app.use('/api/upload', createUploadRouter({ db, requireAuth, requireGroupMember, r2Client, r2Bucket: config.r2Bucket }))
```

`execFileImpl` deixa de ser um parâmetro que `createApp` repassa a algum
router (ele ainda pode continuar existindo como parâmetro de `createApp`
sem uso, MAS se não for usado por mais nenhum router depois dessa mudança,
remova-o da desestruturação de `createApp({ ... })` no topo do arquivo
também — confira com um grep por `execFileImpl` no arquivo antes de
decidir).

- [ ] **Step 3: Remover `coletorDir`/`pythonBin` de `config.js`**

Em `site/server/src/config.js`, remova as linhas:

```js
    // Upload manual de demo (roda o Coletor Python local via child_process). Só faz
    // sentido em dev/self-hosted — indefinido no ambiente serverless da Vercel, onde
    // a rota fica desligada (não há Python nem filesystem persistente na função).
    coletorDir: env.COLETOR_DIR ?? null,
    pythonBin: env.COLETOR_PYTHON ?? null,
```

- [ ] **Step 4: Remover `coletorDir`/`pythonBin` de `index.js`**

Em `site/server/src/index.js`, remova o bloco:

```js
// index.js só roda local/self-hosted (a Vercel usa api/index.js, que não define
// isso) — o repo inteiro está presente no checkout, então dá pra assumir coletor/
// do lado, sem precisar configurar COLETOR_DIR/COLETOR_PYTHON no .env na maioria dos casos.
const coletorDir = config.coletorDir ?? path.join(repoRoot, 'coletor')
const pythonBin =
  config.pythonBin ??
  path.join(coletorDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
```

E troque `config: { ...config, coletorDir, pythonBin },` por `config,` na
chamada de `createApp({ ... })` logo abaixo. Se isso deixar `path`/
`fileURLToPath` sem outro uso no arquivo, mantenha os imports mesmo assim
(`repoRoot`/`staticDir` ainda os usam — confira antes de remover imports).

- [ ] **Step 5: Reescrever `site/server/test/upload.test.js`**

Substitua o arquivo inteiro (o `describe('POST /api/upload', ...)` atual,
baseado em `multer`/`execFileImpl`, não existe mais) por:

```js
import { describe, it, expect, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { signToken } from '../src/auth/jwt.js'

vi.mock('../src/r2.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, presignUpload: vi.fn().mockResolvedValue('https://r2.example/presigned-put') }
})
import { presignUpload } from '../src/r2.js'

const config = { jwtSecret: 's', appUrl: 'http://localhost:5173', isProduction: false, r2Bucket: 'resenha-demos' }
const cookie = `resenha_token=${signToken({ steamId: '765', isSuperAdmin: false }, config.jwtSecret)}`
const GRUPO = '11111111-1111-1111-1111-111111111111'

function appWith(handlers, extra = {}) {
  const db = {
    query: vi.fn().mockImplementation((sql) => {
      for (const [needle, rows] of [...handlers, ['group_members where group_id = $1 and steam_id64', [{}]]]) {
        if (sql.includes(needle)) return Promise.resolve({ rows })
      }
      return Promise.resolve({ rows: [] })
    }),
  }
  return { app: createApp({ config, db, r2Client: { send: vi.fn() }, ...extra }), db }
}

describe('POST /api/upload/upload-url', () => {
  it('sem login: 401', async () => {
    const { app } = appWith([])
    const res = await request(app).post('/api/upload/upload-url').send({ filename: 'x.dem' })
    expect(res.status).toBe(401)
  })

  it('sem R2 configurado: 503', async () => {
    const { app } = appWith([], { r2Client: null })
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .set('X-Group-Id', GRUPO)
      .send({ filename: 'x.dem' })
    expect(res.status).toBe(503)
  })

  it('extensão errada: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .set('X-Group-Id', GRUPO)
      .send({ filename: 'demo.txt' })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/\.dem/)
  })

  it('share code inválido: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .set('X-Group-Id', GRUPO)
      .send({ filename: 'x.dem', shareCode: 'nao-e-um-share-code' })
    expect(res.status).toBe(400)
    expect(res.body.erro).toMatch(/share code/i)
  })

  it('data inválida: 400', async () => {
    const { app } = appWith([])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .set('X-Group-Id', GRUPO)
      .send({ filename: 'x.dem', playedAt: 'ontem à noite' })
    expect(res.status).toBe(400)
  })

  it('caminho feliz: insere na fila com o group_id do requisitante e devolve a url assinada', async () => {
    const { app, db } = appWith([['insert into uploads_pendentes', [{ id: 'u1' }]]])
    const res = await request(app)
      .post('/api/upload/upload-url')
      .set('Cookie', cookie)
      .set('X-Group-Id', GRUPO)
      .send({ filename: 'MinhaDemo.DEM', shareCode: 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee', playedAt: '2026-07-09T20:15' })
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('u1')
    expect(res.body.uploadUrl).toBe('https://r2.example/presigned-put')
    expect(res.body.key).toMatch(/^uploads-pendentes\/.+\.dem$/)
    expect(db.query.mock.calls[0][1]).toEqual([GRUPO, '765', res.body.key, 'CSGO-aaaaa-bbbbb-ccccc-ddddd-eeeee', '2026-07-09T20:15'])
    expect(presignUpload).toHaveBeenCalledWith(expect.anything(), 'resenha-demos', res.body.key, 'application/octet-stream')
  })
})
```

Confira o formato exato de `X-Group-Id`/`req.groupId` usado pelos outros
arquivos de teste (`matches.test.js`, `partidasPro.test.js`) antes de
finalizar — use o MESMO padrão de header/middleware já estabelecido nesse
projeto (`requireGroupMember` lê de onde exatamente? confirme lendo
`site/server/src/auth/middleware.js` se tiver dúvida).

- [ ] **Step 6: Rodar a suíte do servidor**

Run: `cd site/server && npm test`
Expected: todos os testes passam, incluindo os 6 novos e nenhum resquício
do describe antigo (`POST /api/upload` com multer).

- [ ] **Step 7: Commit**

```bash
git add site/server/src/routes/upload.js site/server/src/app.js site/server/src/config.js site/server/src/index.js site/server/test/upload.test.js
git commit -m "feat: troca upload manual de demo pra fila via R2 (remove caminho child_process, so funcionava em dev)"
```

---

### Task 4: Cliente — `EnviarDemo.jsx` em 2 passos + mensagem assíncrona

**Files:**
- Modify: `site/client/src/pages/EnviarDemo.jsx`

**Interfaces:**
- Consumes: `POST /api/upload/upload-url` (Task 3).

- [ ] **Step 1: Trocar a função `enviar` pelo fluxo em 2 passos**

Em `site/client/src/pages/EnviarDemo.jsx`, substitua a função `enviar`
inteira (a que hoje monta `FormData` e faz um único `POST /api/upload`)
por:

```jsx
  async function enviar(e) {
    e.preventDefault()
    if (!arquivo) return
    setEnviando(true)
    setErro(null)
    setResultado(null)
    try {
      const resUrl = await fetch('/api/upload/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: arquivo.name, shareCode, playedAt }),
      })
      const bodyUrl = await resUrl.json().catch(() => ({}))
      if (!resUrl.ok) {
        setErro(bodyUrl.erro ?? 'Erro ao preparar o envio')
        return
      }
      const resPut = await fetch(bodyUrl.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: arquivo,
      })
      if (!resPut.ok) {
        setErro('Falha ao enviar o arquivo pro armazenamento')
        return
      }
      setResultado(true)
    } catch {
      setErro('Falha de rede ao enviar')
    } finally {
      setEnviando(false)
    }
  }
```

- [ ] **Step 2: Trocar o texto de ajuda e a mensagem de sucesso**

Substitua o parágrafo de ajuda logo abaixo do `<SectionHeader titulo="Enviar demo" />`:

```jsx
      <p className="font-mono text-sm leading-relaxed text-texto-fraco">
        Baixe o .dem em CS2 → Assistir → Suas Partidas (ou do Faceit/GC) e envie aqui.
        O processamento roda a cada ~30 minutos — a Partida aparece no Feed quando terminar.
      </p>
```

E substitua o bloco `{resultado && (...)}` (que hoje mostra "Partida
gravada!" com um link pro `matchId`, que não existe mais nesse fluxo) por:

```jsx
        {resultado && (
          <p className="mt-4 font-mono text-sm text-sucesso">
            Envio recebido! Processando em até 30 minutos — a Partida aparece no Feed quando terminar.
          </p>
        )}
```

- [ ] **Step 3: Rodar o build do cliente**

Run: `cd site/client && npm run build`
Expected: build sem erros.

- [ ] **Step 4: Verificação manual (opcional, se houver ambiente com R2 configurado)**

Se houver como testar num ambiente com R2 de fato configurado: escolher um
`.dem`, enviar, confirmar que a mensagem muda pra "Envio recebido!" (sem
esperar resposta de matchId). Sem R2/banco reais disponíveis, pular esse
step é aceitável — a Task 6 cobre a verificação automatizada.

- [ ] **Step 5: Commit**

```bash
git add site/client/src/pages/EnviarDemo.jsx
git commit -m "feat: envio manual de demo em 2 passos (upload direto pro R2) + mensagem assincrona"
```

---

### Task 5: GitHub Actions — novo step agendado

**Files:**
- Modify: `.github/workflows/coletor.yml`

**Interfaces:**
- Consumes: `python -m coletor.main processar-uploads-pendentes` (Task 2).

- [ ] **Step 1: Adicionar o step, mesmo padrão do `processar-fila-pro`**

Em `.github/workflows/coletor.yml`, logo depois do step "Processar fila de
partidas profissionais (HLTV)" (por volta da linha 105), adicione:

```yaml
      - name: Processar uploads manuais de demo pendentes
        working-directory: coletor
        env:
          PYTHONPATH: src
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          R2_ACCOUNT_ID: ${{ secrets.R2_ACCOUNT_ID }}
          R2_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          R2_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
          R2_BUCKET: ${{ secrets.R2_BUCKET }}
        run: python -m coletor.main processar-uploads-pendentes
```

- [ ] **Step 2: Validar o YAML**

Run: `cd .github/workflows && python -c "import yaml; yaml.safe_load(open('coletor.yml'))"`
(ou qualquer validador de YAML disponível no ambiente — só precisa
confirmar que o arquivo continua parseável, sem indentação quebrada)
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/coletor.yml
git commit -m "feat: agenda processar-uploads-pendentes no job do Coletor (a cada 30min)"
```

---

### Task 6: Verificação final

- [ ] **Step 1: Rodar as 3 suítes**

Run: `cd coletor && .venv/Scripts/python -m pytest -q && cd ../site/server && npm test && cd ../client && npm test -- --run`
Expected: todas passam.

- [ ] **Step 2: Build do cliente**

Run: `cd site/client && npm run build`
Expected: sem erros.

- [ ] **Step 3: Confirmar com o usuário e aplicar a migration 0026 em produção**

Antes desse ponto, a migration da Task 1 deve ter sido aplicada (ou
aplicar agora, se ainda não foi) via Supabase MCP — SEMPRE com confirmação
explícita nomeando `0026_uploads_pendentes.sql`, igual ao padrão já seguido
nas migrations anteriores desse projeto.

- [ ] **Step 4: Push**

```bash
git push
```
