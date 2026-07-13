const YOUTUBE_ID_RE = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/

export function extrairYoutubeId(url) {
  if (!url) return null
  const m = YOUTUBE_ID_RE.exec(url)
  return m ? m[1] : null
}

export function thumbYoutube(url) {
  const id = extrairYoutubeId(url)
  return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null
}

export function embedYoutube(url) {
  const id = extrairYoutubeId(url)
  return id ? `https://www.youtube-nocookie.com/embed/${id}` : null
}
