import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { urlDaMidia } from '../lib/conversas'
import type { TipoMensagem } from '../types'

/**
 * O arquivo de um balão: foto, áudio, vídeo ou documento.
 *
 * O bucket `midias-whatsapp` é privado, então tudo aqui passa por URL assinada,
 * buscada na montagem (ver `urlDaMidia`). É a mesma ideia do `Midia` de
 * `JanelaConversa.tsx`, generalizada: recebe o caminho e o tipo em vez da
 * mensagem inteira, e entende vídeo e o nome do documento.
 *
 * O PDF abre em outra aba — o visualizador do navegador cuida dele. O atributo
 * `download` não adianta aqui: a URL assinada é de outro domínio, e o
 * navegador ignora `download` entre domínios.
 */
export default function MidiaDaMensagem({ caminho, tipo, nome }: {
  caminho: string
  tipo: TipoMensagem
  nome?: string | null
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [falhou, setFalhou] = useState(false)

  useEffect(() => {
    let vivo = true
    urlDaMidia(caminho)
      .then((u) => { if (vivo) { setUrl(u); setFalhou(!u) } })
      .catch(() => { if (vivo) setFalhou(true) })
    return () => { vivo = false }
  }, [caminho])

  if (falhou) {
    return <div style={{ fontSize: 11.5, opacity: 0.75 }}>Não consegui abrir o arquivo.</div>
  }
  if (!url) {
    return <div style={{ fontSize: 11.5, opacity: 0.75 }}>Carregando…</div>
  }

  if (tipo === 'imagem') {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt="Imagem enviada"
          style={{ maxWidth: 260, maxHeight: 300, borderRadius: 9, display: 'block' }} />
      </a>
    )
  }

  if (tipo === 'audio') {
    return <audio controls src={url} style={{ maxWidth: 260, display: 'block' }} />
  }

  if (tipo === 'video') {
    return (
      <video controls src={url}
        style={{ maxWidth: 280, maxHeight: 320, borderRadius: 9, display: 'block' }} />
    )
  }

  return (
    <a href={url} target="_blank" rel="noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'inherit' }}>
      <FileText size={14} /> {nome || 'Abrir arquivo'}
    </a>
  )
}
