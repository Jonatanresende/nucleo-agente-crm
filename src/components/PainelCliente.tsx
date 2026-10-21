import React, { useEffect, useState } from 'react'
import { X, Phone, Clock, UserCheck, CircleUser } from 'lucide-react'
import { formatarWhatsapp } from '../lib/conversas-clientes'
import { fotoDoPerfil } from '../lib/conversas'
import type { ClienteChatResumo } from '../types'
import { MARCA, MARCA_SUAVE } from '../lib/marca'

/**
 * Painel da direita do canal "Atendimento ao Cliente": foto e dados do contato.
 *
 * Análogo ao PainelLead (canal IA), mas sem ficha de lead/consultas — este
 * canal não tem funil nem IA. Mostra só o que existe em `clientes_chat`.
 * A foto vem da Evolution/uazapi (pode ser `null` — fica a inicial).
 */

const rotulo: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, color: '#6B818C',
  textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5,
}
const valor: React.CSSProperties = { fontSize: 13, color: '#16232B', lineHeight: 1.6 }
const bloco: React.CSSProperties = { padding: '15px 18px', borderBottom: '1px solid #EDF2F4' }

function dataHora(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

interface Props {
  conversa: ClienteChatResumo
  onFechar: () => void
}

export default function PainelCliente({ conversa, onFechar }: Props) {
  const [foto, setFoto] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    fotoDoPerfil(conversa.whatsapp).then((u) => { if (vivo) setFoto(u) })
    return () => { vivo = false }
  }, [conversa.whatsapp])

  const temNome = !!conversa.nome?.trim()
  const titulo = temNome ? conversa.nome!.trim() : formatarWhatsapp(conversa.whatsapp)

  return (
    <div style={{
      width: 300, flexShrink: 0, borderLeft: '1px solid #DCE6EA', background: '#fff',
      display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '13px 18px', borderBottom: '1px solid #EDF2F4', flexShrink: 0,
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#16232B' }}>Sobre o cliente</span>
        <button onClick={onFechar} title="Esconder o painel"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B818C', display: 'flex', padding: 2 }}>
          <X size={16} />
        </button>
      </div>

      <div style={{ ...bloco, textAlign: 'center', paddingTop: 20, paddingBottom: 18 }}>
        {foto ? (
          <img src={foto} alt="" onError={() => setFoto(null)}
            style={{
              width: 68, height: 68, borderRadius: '50%', objectFit: 'cover',
              margin: '0 auto 11px', display: 'block', border: '1px solid #DCE6EA',
            }} />
        ) : (
          <div style={{
            width: 68, height: 68, borderRadius: '50%', background: MARCA_SUAVE, color: MARCA,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 25, fontWeight: 700, margin: '0 auto 11px',
          }}>
            {temNome ? titulo.charAt(0).toUpperCase() : <CircleUser size={30} />}
          </div>
        )}
        <div style={{ fontSize: 15, fontWeight: 700, color: '#16232B', wordBreak: 'break-word' }}>
          {titulo}
        </div>
      </div>

      <div style={bloco}>
        <div style={rotulo}>Contato</div>
        <div style={{ ...valor, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Phone size={13} color="#6B818C" />
          {formatarWhatsapp(conversa.whatsapp)}
        </div>
      </div>

      <div style={bloco}>
        <div style={rotulo}>Atendimento</div>
        <div style={{ ...valor, display: 'flex', alignItems: 'center', gap: 6 }}>
          <UserCheck size={13} color="#6B818C" />
          {conversa.assumido_por_nome
            ? `Com ${conversa.assumido_por_nome}`
            : <span style={{ color: '#6B818C' }}>Ninguém assumiu</span>}
        </div>
      </div>

      <div style={bloco}>
        <div style={rotulo}>Linha do tempo</div>
        <div style={{ ...valor, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Clock size={13} color="#6B818C" />
          Última mensagem: {dataHora(conversa.ultima_em)}
        </div>
      </div>
    </div>
  )
}
