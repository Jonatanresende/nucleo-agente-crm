import { useState } from 'react'
import { Search, MessageSquareDashed } from 'lucide-react'
import { formatarWhatsapp, previaDaMensagemCliente, quandoCurtoCliente } from '../lib/conversas-clientes'
import type { ClienteChatResumo } from '../types'
import { MARCA } from '../lib/marca'

/**
 * A lista da aba "Atendimento ao Cliente" — análoga ao `ListaConversas`,
 * mas para o 2º número (sem funil, sem filtro "agendadas").
 *
 * Os filtros são simplificados: Todas e Não lidas — apenas o essencial
 * para o atendimento humano.
 */

const FONTE = "'Plus Jakarta Sans', sans-serif"

type Filtro = 'todas' | 'nao_lidas'
const ROTULO_FILTRO: Record<Filtro, string> = {
  todas: 'Todas',
  nao_lidas: 'Não lidas',
}

interface Props {
  conversas: ClienteChatResumo[]
  selecionada: string | null
  onSelecionar: (clienteId: string) => void
  carregando: boolean
}

export default function ListaConversasClientes({
  conversas, selecionada, onSelecionar, carregando,
}: Props) {
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todas')

  const termo = busca.trim().toLowerCase()

  const passaNoFiltro = (c: ClienteChatResumo) =>
    filtro === 'todas' ? true : c.nao_lidas > 0

  const passaNaBusca = (c: ClienteChatResumo) =>
    !termo ||
    (c.nome ?? '').toLowerCase().includes(termo) ||
    c.whatsapp.includes(termo.replace(/\D/g, '')) ||
    (c.ultimo_conteudo ?? '').toLowerCase().includes(termo)

  const filtradas = conversas.filter((c) => passaNoFiltro(c) && passaNaBusca(c))

  const totais: Record<Filtro, number> = {
    todas: conversas.length,
    nao_lidas: conversas.filter((c) => c.nao_lidas > 0).length,
  }

  const vazioTexto = termo
    ? 'Tente outro nome ou número.'
    : filtro === 'nao_lidas'
      ? 'Nada esperando resposta. Tudo lido.'
      : 'Quando um cliente enviar mensagem para o 2º número, a conversa aparece aqui.'

  return (
    <div style={{
      width: 330, flexShrink: 0, borderRight: '1px solid #DCE6EA', background: '#fff',
      display: 'flex', flexDirection: 'column', height: '100%',
    }}>

      {/* Cabeçalho, busca e filtros */}
      <div style={{ padding: '18px 18px 12px', borderBottom: '1px solid #EDF2F4', flexShrink: 0 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#16232B', margin: '0 0 3px' }}>
          Atendimento ao Cliente
        </h2>
        <p style={{ fontSize: 12, color: '#6B818C', margin: '0 0 13px' }}>
          2º número — atendimento humano, sem IA.
        </p>

        <div style={{ position: 'relative' }}>
          <Search size={14} color="#6B818C"
            style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, número ou mensagem"
            style={{
              width: '100%', padding: '8px 12px 8px 32px', borderRadius: 9,
              border: '1px solid #DCE6EA', fontSize: 12.5, fontFamily: FONTE,
              color: '#16232B', outline: 'none', boxSizing: 'border-box', background: '#F7FAFB',
            }}
            onFocus={(e) => (e.target.style.borderColor = MARCA)}
            onBlur={(e) => (e.target.style.borderColor = '#DCE6EA')}
          />
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {(Object.keys(ROTULO_FILTRO) as Filtro[]).map((f) => {
            const ativo = filtro === f
            return (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '4px 9px', borderRadius: 20, cursor: 'pointer',
                  fontSize: 11.5, fontWeight: 600, fontFamily: FONTE,
                  border: `1px solid ${ativo ? MARCA : '#DCE6EA'}`,
                  background: ativo ? MARCA : '#fff',
                  color: ativo ? '#fff' : '#6B818C',
                  transition: 'background 0.15s, border-color 0.15s',
                }}
                onMouseEnter={(e) => { if (!ativo) e.currentTarget.style.background = '#F7FAFB' }}
                onMouseLeave={(e) => { if (!ativo) e.currentTarget.style.background = '#fff' }}
              >
                {ROTULO_FILTRO[f]}
                <span style={{ fontSize: 10.5, fontWeight: 700, color: ativo ? '#BBDDE8' : '#9AAEB6' }}>
                  {totais[f]}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* A lista */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {carregando && conversas.length === 0 && (
          <div style={{ padding: '28px 20px', textAlign: 'center', fontSize: 12.5, color: '#6B818C' }}>
            Carregando…
          </div>
        )}

        {!carregando && filtradas.length === 0 && (
          <div style={{ padding: '40px 26px', textAlign: 'center' }}>
            <MessageSquareDashed size={26} color="#B6C6CD" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: '#16232B', marginBottom: 4 }}>
              {termo ? 'Nada encontrado' : 'Nenhuma conversa ainda'}
            </div>
            <div style={{ fontSize: 11.5, color: '#6B818C', lineHeight: 1.55 }}>
              {vazioTexto}
            </div>
          </div>
        )}

        {filtradas.map((c) => {
          const ativo = c.cliente_id === selecionada
          const nome = c.nome?.trim() || formatarWhatsapp(c.whatsapp)
          const previa = previaDaMensagemCliente(c)
          const quando = c.ultima_em ? quandoCurtoCliente(c.ultima_em) : ''
          const temNaoLidas = c.nao_lidas > 0

          return (
            <button
              key={c.cliente_id}
              onClick={() => onSelecionar(c.cliente_id)}
              style={{
                width: '100%', textAlign: 'left', padding: '12px 18px',
                borderBottom: '1px solid #EDF2F4', cursor: 'pointer',
                background: ativo ? '#EDF2F4' : '#fff', border: 'none',
                fontFamily: FONTE,
                transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => { if (!ativo) e.currentTarget.style.background = '#F7FAFB' }}
              onMouseLeave={(e) => { if (!ativo) e.currentTarget.style.background = ativo ? '#EDF2F4' : '#fff' }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
                {/* Avatar */}
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: ativo ? '#B6D5DE' : '#DCE6EA',
                  color: ativo ? '#1A5C6B' : '#4A6975',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, flexShrink: 0,
                }}>
                  {nome.charAt(0).toUpperCase()}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                    <span style={{
                      fontSize: 13, fontWeight: temNaoLidas ? 700 : 600,
                      color: '#16232B', overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap', maxWidth: 160,
                    }}>
                      {nome}
                    </span>
                    <span style={{ fontSize: 10.5, color: '#9AAEB6', flexShrink: 0 }}>
                      {quando}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{
                      fontSize: 11.5, color: temNaoLidas ? '#16232B' : '#6B818C',
                      fontWeight: temNaoLidas ? 600 : 400,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      flex: 1,
                    }}>
                      {c.ultimo_autor === 'atendente' && <span style={{ color: '#9AAEB6' }}>Você: </span>}
                      {previa || '—'}
                    </span>
                    {temNaoLidas && (
                      <span style={{
                        background: MARCA, color: '#fff', borderRadius: 20,
                        fontSize: 9.5, fontWeight: 700, padding: '1px 6px', flexShrink: 0,
                      }}>
                        {c.nao_lidas}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
