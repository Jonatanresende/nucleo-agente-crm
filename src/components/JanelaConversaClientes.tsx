import React, { useEffect, useRef, useState } from 'react'
import {
  Send, UserCheck, Undo2, MessagesSquare, FileText,
  PanelRightOpen, PanelRightClose, Paperclip, X, Mic, Square,
} from 'lucide-react'
import { formatarWhatsapp, MAX_ARQUIVO_BYTES } from '../lib/conversas-clientes'
import { hora, diaPorExtenso } from '../lib/conversas'
import type { ClienteChatResumo, MensagemCliente, AutorMensagemCliente } from '../types'
import { MARCA, MARCA_SUAVE } from '../lib/marca'
import MidiaDaMensagem from './MidiaDaMensagem'

/**
 * A janela de chat do canal "Atendimento ao Cliente".
 *
 * Diferenças em relação à JanelaConversa (canal IA):
 *   - Sem aviso de "A IA está atendendo" — não há IA neste canal.
 *   - Sem botão "Assumir" para pausar IA — aqui o assumir é apenas para
 *     registrar quem está respondendo (evitar dois atendentes no mesmo chat).
 *   - Campo de texto SEMPRE acessível — não precisa assumir para escrever.
 *     (Assumir é opcional e serve só para coordenação interna da equipe.)
 *   - Sem link "ficha" — este contato não tem lead no CRM de anúncios.
 */

const FONTE = "'Plus Jakarta Sans', sans-serif"

const ESTILO_BALAO: Record<AutorMensagemCliente, React.CSSProperties> = {
  cliente:   { background: '#FFFFFF', border: '1px solid #DCE6EA', color: '#16232B' },
  atendente: { background: '#16232B', border: '1px solid #16232B', color: '#FFFFFF' },
}

function Balao({ mensagem, mostrarAutor }: { mensagem: MensagemCliente; mostrarAutor: boolean }) {
  const doCliente = mensagem.autor === 'cliente'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: doCliente ? 'flex-start' : 'flex-end', marginBottom: 8,
    }}>
      {mostrarAutor && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          fontSize: 10, fontWeight: 700, color: '#6B818C', margin: '4px 4px 3px',
        }}>
          {doCliente ? 'Cliente' : <><UserCheck size={10} /> Atendente</>}
        </div>
      )}

      <div style={{
        ...ESTILO_BALAO[mensagem.autor],
        maxWidth: '68%', padding: '9px 12px 7px', borderRadius: 12,
        borderBottomLeftRadius: doCliente ? 3 : 12,
        borderBottomRightRadius: doCliente ? 12 : 3,
        fontSize: 13.5, lineHeight: 1.55, wordBreak: 'break-word',
      }}>
        {/* Com arquivo guardado (migração 0032): o player, a foto, o vídeo ou o
            link do documento. Sem ele — mensagem antiga, ou download que
            falhou —, só o rótulo, como era antes. */}
        {mensagem.midia_url && mensagem.tipo !== 'texto' ? (
          <div style={{ marginBottom: mensagem.conteudo ? 7 : 2 }}>
            <MidiaDaMensagem
              caminho={mensagem.midia_url}
              tipo={mensagem.tipo}
              nome={mensagem.midia_nome}
            />
          </div>
        ) : (
          <>
            {mensagem.tipo === 'audio' && (
              <div style={{ fontSize: 11.5, opacity: 0.75, marginBottom: 4 }}>🎵 Áudio</div>
            )}
            {mensagem.tipo === 'imagem' && (
              <div style={{ fontSize: 11.5, opacity: 0.75, marginBottom: 4 }}>📷 Imagem</div>
            )}
            {mensagem.tipo === 'video' && (
              <div style={{ fontSize: 11.5, opacity: 0.75, marginBottom: 4 }}>🎥 Vídeo</div>
            )}
            {mensagem.tipo === 'documento' && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <FileText size={14} /> Documento
              </div>
            )}
          </>
        )}

        {mensagem.conteudo && (
          <div style={{ whiteSpace: 'pre-wrap' }}>{mensagem.conteudo}</div>
        )}

        <div style={{
          fontSize: 9.5, opacity: doCliente ? 0.55 : 0.78, marginTop: 4,
          textAlign: doCliente ? 'left' : 'right',
        }}>
          {hora(mensagem.criada_em)}
        </div>
      </div>
    </div>
  )
}

/**
 * Toca o áudio gravado antes de enviar — ouvir antes é o que evita mandar silêncio.
 *
 * ⚠️ A URL nasce DENTRO do efeito, e é gravada direto no elemento. Criada fora
 * (num useMemo) ela quebrava em desenvolvimento: o React monta, desmonta e
 * monta de novo, o cleanup da primeira montagem revogava a URL, e a segunda
 * reaproveitava a já revogada — `ERR_FILE_NOT_FOUND`, e o player mudo.
 */
function PreviaDoAudio({ arquivo }: { arquivo: File }) {
  const player = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(arquivo)
    if (player.current) player.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [arquivo])

  return <audio ref={player} controls style={{ height: 28, maxWidth: 200 }} />
}

interface Props {
  conversa: ClienteChatResumo | null
  mensagens: MensagemCliente[]
  carregando: boolean
  enviando: boolean
  erro: string
  onEnviar: (texto: string) => void
  /** Devolve true quando saiu — só então o anexo é limpo da caixa. */
  onEnviarArquivo: (arquivo: File, legenda: string) => Promise<boolean>
  onAssumir: () => void
  onDevolver: () => void
  usuarioId: string | null
  painelAberto: boolean
  onAlternarPainel: () => void
}

export default function JanelaConversaClientes({
  conversa, mensagens, carregando, enviando, erro,
  onEnviar, onEnviarArquivo, onAssumir, onDevolver, usuarioId,
  painelAberto, onAlternarPainel,
}: Props) {
  const [texto, setTexto] = useState('')
  const [anexo, setAnexo] = useState<File | null>(null)
  const [erroAnexo, setErroAnexo] = useState('')
  const seletor = useRef<HTMLInputElement | null>(null)

  // Gravação de áudio pelo microfone do navegador.
  const [gravando, setGravando] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const gravador = useRef<MediaRecorder | null>(null)
  const pedacos = useRef<Blob[]>([])
  const relogio = useRef<number | null>(null)
  const descartar = useRef(false)

  // Trocar de conversa (o componente remonta) ou sair da tela solta o microfone.
  useEffect(() => () => {
    descartar.current = true
    if (relogio.current) window.clearInterval(relogio.current)
    gravador.current?.stream.getTracks().forEach((t) => t.stop())
    if (gravador.current?.state === 'recording') gravador.current.stop()
  }, [])
  const fim = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    fim.current?.scrollIntoView({ block: 'end' })
  }, [mensagens, conversa?.cliente_id])

  if (!conversa) {
    return (
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 10, padding: 40, textAlign: 'center',
      }}>
        <MessagesSquare size={30} color="#B6C6CD" />
        <div style={{ fontSize: 14, fontWeight: 700, color: '#16232B' }}>
          Escolha uma conversa
        </div>
        <div style={{ fontSize: 12.5, color: '#6B818C', maxWidth: 320, lineHeight: 1.6 }}>
          Aqui você responde diretamente para o cliente. Não há IA neste canal.
        </div>
      </div>
    )
  }

  const nome = conversa.nome?.trim() || formatarWhatsapp(conversa.whatsapp)
  // Assumida pelo usuário atual — usado apenas para colorir o botão
  const assumidaPorMim = conversa.assumido_por === usuarioId && !!usuarioId
  const assumidaPorOutrem = !!conversa.assumido_por && !assumidaPorMim

  function escolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0] ?? null
    e.target.value = ''  // permite escolher o mesmo arquivo de novo
    if (!arquivo) return
    if (arquivo.size > MAX_ARQUIVO_BYTES) {
      setErroAnexo(`"${arquivo.name}" passa de 16 MB.`)
      return
    }
    setErroAnexo('')
    setAnexo(arquivo)
  }

  async function comecarGravacao() {
    setErroAnexo('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErroAnexo('Este navegador não grava áudio.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // ogg/opus onde o navegador sabe (Firefox); webm/opus no Chrome e Edge.
      const formato = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm']
        .find((f) => MediaRecorder.isTypeSupported(f))
      const rec = new MediaRecorder(stream, formato ? { mimeType: formato } : undefined)

      pedacos.current = []
      descartar.current = false
      rec.ondataavailable = (e) => { if (e.data.size) pedacos.current.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        if (relogio.current) window.clearInterval(relogio.current)
        setGravando(false)
        if (descartar.current || !pedacos.current.length) return

        const tipo = (rec.mimeType || 'audio/webm').split(';')[0]
        const ext = tipo.includes('ogg') ? 'ogg' : 'webm'
        const arquivo = new File(pedacos.current, `audio-${Date.now()}.${ext}`, { type: tipo })
        if (arquivo.size > MAX_ARQUIVO_BYTES) { setErroAnexo('A gravação passa de 16 MB.'); return }
        setAnexo(arquivo)
      }

      gravador.current = rec
      rec.start()
      setSegundos(0)
      setGravando(true)
      relogio.current = window.setInterval(() => setSegundos((s) => s + 1), 1000)
    } catch {
      setErroAnexo('Não consegui usar o microfone. Libere a permissão no navegador.')
    }
  }

  function pararGravacao(guardar: boolean) {
    descartar.current = !guardar
    gravador.current?.stop()
  }

  const relogioTexto = `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`

  async function enviar() {
    if (enviando) return
    const limpo = texto.trim()

    if (anexo) {
      // O texto vira a legenda. Só limpa se o envio deu certo: falhou, a
      // pessoa tenta de novo sem redigitar nem reanexar.
      if (await onEnviarArquivo(anexo, limpo)) { setAnexo(null); setTexto('') }
      return
    }

    if (!limpo) return
    onEnviar(limpo)
    setTexto('')
  }

  const podeEnviar = !enviando && !gravando && (!!anexo || !!texto.trim())

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%' }}>

      {/* Cabeçalho */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '13px 20px',
        borderBottom: '1px solid #DCE6EA', background: '#fff', flexShrink: 0,
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%', background: MARCA_SUAVE, color: MARCA,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, flexShrink: 0,
        }}>
          {nome.charAt(0).toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            fontSize: 14, fontWeight: 700, color: '#16232B',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
          }}>
            {nome}
          </span>
          <div style={{ fontSize: 11.5, color: '#6B818C' }}>
            {formatarWhatsapp(conversa.whatsapp)}
          </div>
        </div>

        {/* Assumir / Devolver (opcional — só para coordenação interna) */}
        {assumidaPorMim ? (
          <button onClick={onDevolver}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px',
              borderRadius: 9, border: '1px solid #DCE6EA', background: '#fff',
              cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#16232B',
              fontFamily: FONTE, flexShrink: 0,
            }}>
            <Undo2 size={13} /> Liberar
          </button>
        ) : (
          <button onClick={onAssumir}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px',
              borderRadius: 9,
              background: assumidaPorOutrem ? '#F7FAFB' : MARCA,
              border: assumidaPorOutrem ? '1px solid #DCE6EA' : 'none',
              color: assumidaPorOutrem ? '#6B818C' : '#fff',
              cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
              fontFamily: FONTE, flexShrink: 0,
            } as React.CSSProperties}>
            <UserCheck size={13} /> {assumidaPorOutrem ? `Com ${conversa.assumido_por_nome}` : 'Assumir'}
          </button>
        )}

        <button onClick={onAlternarPainel}
          title={painelAberto ? 'Esconder dados' : 'Ver dados do contato'}
          style={{
            display: 'flex', alignItems: 'center', padding: 8, borderRadius: 9,
            border: '1px solid #DCE6EA', background: painelAberto ? MARCA_SUAVE : '#fff',
            cursor: 'pointer', color: painelAberto ? MARCA : '#6B818C', flexShrink: 0,
          }}>
          {painelAberto ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        </button>
      </div>

      {/* Faixa de status: quem está atendendo */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '7px 20px',
        background: assumidaPorMim ? '#FFFBEB' : assumidaPorOutrem ? '#F0FDF4' : '#F7FAFB',
        borderBottom: `1px solid ${assumidaPorMim ? '#FDE68A' : assumidaPorOutrem ? '#BBF7D0' : '#EDF2F4'}`,
        fontSize: 11.5,
        color: assumidaPorMim ? '#92400E' : assumidaPorOutrem ? '#166534' : '#6B818C',
        flexShrink: 0,
      }}>
        <UserCheck size={12} />
        {assumidaPorMim
          ? <span><strong>Você está atendendo.</strong> Colegas podem ver a conversa.</span>
          : assumidaPorOutrem
            ? <span><strong>{conversa.assumido_por_nome}</strong> está atendendo este cliente.</span>
            : <span>Nenhum atendente assumiu. Qualquer um pode responder.</span>
        }
      </div>

      {/* Mensagens */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: '#F2F6F7' }}>
        {carregando && mensagens.length === 0 && (
          <div style={{ textAlign: 'center', fontSize: 12.5, color: '#6B818C', padding: 20 }}>
            Carregando a conversa…
          </div>
        )}

        {mensagens.map((m, i) => {
          const anterior = mensagens[i - 1]
          const dia = diaPorExtenso(m.criada_em)
          const novoDia = !anterior || diaPorExtenso(anterior.criada_em) !== dia

          return (
            <div key={m.id}>
              {novoDia && (
                <div style={{ textAlign: 'center', margin: '14px 0 12px' }}>
                  <span style={{
                    background: '#DCE6EA', color: '#16232B', fontSize: 10.5, fontWeight: 600,
                    padding: '3px 11px', borderRadius: 20,
                  }}>
                    {dia}
                  </span>
                </div>
              )}
              <Balao mensagem={m} mostrarAutor={!anterior || anterior.autor !== m.autor} />
            </div>
          )
        })}
        <div ref={fim} />
      </div>

      {/* Caixa de resposta — sempre habilitada (sem necessidade de assumir) */}
      <div style={{ borderTop: '1px solid #DCE6EA', background: '#fff', padding: '12px 20px', flexShrink: 0 }}>
        {(erro || erroAnexo) && (
          <div style={{
            marginBottom: 9, padding: '8px 12px', background: '#FEF2F2',
            border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, color: '#DC2626',
          }}>
            {erroAnexo || erro}
          </div>
        )}

        {anexo && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 9,
            padding: '6px 8px 6px 10px', background: MARCA_SUAVE, color: MARCA,
            borderRadius: 8, fontSize: 12.5, fontWeight: 600, maxWidth: '100%',
          }}>
            <FileText size={13} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {anexo.name}
            </span>
            {anexo.type.startsWith('audio/') && <PreviaDoAudio arquivo={anexo} />}
            <button onClick={() => setAnexo(null)} disabled={enviando} title="Tirar o arquivo"
              style={{
                display: 'flex', border: 'none', background: 'transparent', padding: 2,
                cursor: enviando ? 'not-allowed' : 'pointer', color: MARCA,
              }}>
              <X size={13} />
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-end' }}>
          <input ref={seletor} type="file" onChange={escolherArquivo} style={{ display: 'none' }}
            accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" />
          <button onClick={() => seletor.current?.click()} disabled={enviando}
            title="Anexar imagem, vídeo, áudio ou documento"
            style={{
              display: 'flex', alignItems: 'center', padding: 11, borderRadius: 10,
              border: '1px solid #DCE6EA', background: '#fff', color: '#6B818C',
              cursor: enviando ? 'not-allowed' : 'pointer', flexShrink: 0,
            }}>
            <Paperclip size={15} />
          </button>
          {gravando ? (
            <>
              <button onClick={() => pararGravacao(false)} title="Cancelar a gravação"
                style={{
                  display: 'flex', alignItems: 'center', padding: 11, borderRadius: 10,
                  border: '1px solid #DCE6EA', background: '#fff', color: '#6B818C',
                  cursor: 'pointer', flexShrink: 0,
                }}>
                <X size={15} />
              </button>
              <button onClick={() => pararGravacao(true)} title="Parar e guardar a gravação"
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, padding: '11px 14px',
                  borderRadius: 10, border: 'none', background: '#DC2626', color: '#fff',
                  cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONTE, flexShrink: 0,
                }}>
                <Square size={13} /> Gravando {relogioTexto}
              </button>
            </>
          ) : (
            <button onClick={comecarGravacao} disabled={enviando || !!anexo}
              title="Gravar um áudio"
              style={{
                display: 'flex', alignItems: 'center', padding: 11, borderRadius: 10,
                border: '1px solid #DCE6EA', background: '#fff', color: '#6B818C',
                cursor: enviando || anexo ? 'not-allowed' : 'pointer', flexShrink: 0,
              }}>
              <Mic size={15} />
            </button>
          )}
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() }
            }}
            rows={1}
            placeholder={anexo ? 'Legenda (opcional)…' : 'Escreva a mensagem… (Enter envia, Shift+Enter quebra a linha)'}
            style={{
              flex: 1, padding: '10px 13px', borderRadius: 10, border: '1px solid #DCE6EA',
              fontSize: 13.5, fontFamily: FONTE, color: '#16232B', outline: 'none',
              resize: 'none', minHeight: 40, maxHeight: 140, lineHeight: 1.5,
              boxSizing: 'border-box', background: '#fff',
            }}
            onFocus={(e) => (e.target.style.borderColor = MARCA)}
            onBlur={(e) => (e.target.style.borderColor = '#DCE6EA')}
          />
          <button
            onClick={enviar}
            disabled={!podeEnviar}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '10px 17px',
              borderRadius: 10, border: 'none',
              background: !podeEnviar ? '#B6C6CD' : MARCA,
              color: '#fff', cursor: !podeEnviar ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: FONTE, flexShrink: 0,
            }}>
            <Send size={14} /> {enviando ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  )
}
