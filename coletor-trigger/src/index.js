// Dispara o workflow "Coletor" via workflow_dispatch a cada 5 min (ver wrangler.toml).
// Substitui o gatilho `schedule` nativo do coletor.yml, que na prática estava
// disparando a cada 92-137 min mesmo configurado pra 30 (GitHub Actions deprioriza
// `schedule` sob carga; `workflow_dispatch` via API roda quase na hora).
export default {
  async scheduled(event, env, ctx) {
    const resp = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/coletor.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'resenha-coletor-trigger',
        },
        body: JSON.stringify({ ref: 'main' }),
      },
    )
    if (!resp.ok) {
      const texto = await resp.text().catch(() => '')
      console.error(`Falha ao disparar o Coletor: ${resp.status} ${texto}`)
    }
  },
}
