import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bot, UserCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'

// Canal IA
import ListaConversas from '../components/ListaConversas'
import JanelaConversa from '../components/JanelaConversa'
import PainelLead from '../components/PainelLead'
import PainelCliente from '../components/PainelCliente'
import {
  listarConversas, carregarMensagens, enviarMensagem,
  assumirConversa, devolverConversa, marcarComoLidas,
} from '../lib/conversas'

// Canal de Atendimento ao Cliente
import ListaConversasClientes from '../components/ListaConversasClientes'
import JanelaConversaClientes from '../components/JanelaConversaClientes'
import {
  listarConversasClientes, carregarMensagensCliente, enviarMensagemCliente,
  assumirContatoCliente, devolverContatoCliente, marcarClienteComoLido,
} from '../lib/conversas-clientes'

import type { ConversaResumo, MensagemWhatsapp, ClienteChatResumo, MensagemCliente } from '../types'
import { MARCA } from '../lib/marca'

/**
 * A tela Conversas — duas abas: Atendente IA e Atendimento ao Cliente.
 *
 * ⚠️ REALTIME ASSINA TABELAS, NUNCA VIEWS. Cada aba assina suas próprias
 * tabelas: `mensagens_whatsapp` + `crm_clinica_dados` para a aba IA, e
 * `mensagens_clientes` + `clientes_chat` para a aba Clientes.
 *
 * A aba ativa é gravada em `?aba=ia` ou `?aba=clientes` na URL, para que
 * o botão "voltar" do navegador restaure a aba correta.
 */

const FONTE = "'Plus Jakarta Sans', sans-serif"

type Aba = 'ia' | 'clientes'

export default function Conversas() {
  const [params, setParams] = useSearchParams()

  const abaInicial: Aba = params.get('aba') === 'clientes' ? 'clientes' : 'ia'
  const [aba, setAba] = useState<Aba>(abaInicial)

  const [usuarioId, setUsuarioId] = useState<string | null>(null)

  // ── Estado do canal IA ─────────────────────────────────────────────────────
  const [conversas, setConversas] = useState<ConversaResumo[]>([])
  const [selecionada, setSelecionada] = useState<string | null>(
    aba === 'ia' ? params.get('lead') : null
  )
  const [mensagens, setMensagens] = useState<MensagemWhatsapp[]>([])
  const [carregandoLista, setCarregandoLista] = useState(true)
  const [carregandoConversa, setCarregandoConversa] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  // ── Estado do canal Clientes ───────────────────────────────────────────────
  const [conversasClientes, setConversasClientes] = useState<ClienteChatResumo[]>([])
  const [selecionadaCliente, setSelecionadaCliente] = useState<string | null>(
    aba === 'clientes' ? params.get('cliente') : null
  )
  const [mensagensCliente, setMensagensCliente] = useState<MensagemCliente[]>([])
  const [carregandoListaClientes, setCarregandoListaClientes] = useState(true)
  const [carregandoConversaCliente, setCarregandoConversaCliente] = useState(false)
  const [enviandoCliente, setEnviandoCliente] = useState(false)
  const [erroCliente, setErroCliente] = useState('')

  // Painel lateral (preferência salva por canal)
  const [painelAberto, setPainelAberto] = useState(() => {
    try { return localStorage.getItem('conversas.painel') !== 'fechado' } catch { return true }
  })
  const [painelClienteAberto, setPainelClienteAberto] = useState(() => {
    try { return localStorage.getItem('conversas-clientes.painel') !== 'fechado' } catch { return true }
  })

  // Refs para o Realtime (não enxerga closure de estado)
  const abertaRef = useRef<string | null>(selecionada)
  useEffect(() => { abertaRef.current = selecionada }, [selecionada])

  const abertaClienteRef = useRef<string | null>(selecionadaCliente)
  useEffect(() => { abertaClienteRef.current = selecionadaCliente }, [selecionadaCliente])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUsuarioId(data.user?.id ?? null))
  }, [])

  // ── Carregadores ──────────────────────────────────────────────────────────

  const recarregarLista = useCallback(() =>
    listarConversas()
      .then((c) => { setConversas(c); setCarregandoLista(false) })
      .catch(() => { setErro('Não consegui carregar as conversas.'); setCarregandoLista(false) }),
  [])

  const recarregarMensagens = useCallback((leadId: string) =>
    carregarMensagens(leadId)
      .then((m) => { setMensagens(m); setCarregandoConversa(false) })
      .catch(() => { setErro('Não consegui carregar esta conversa.'); setCarregandoConversa(false) }),
  [])

  const recarregarListaClientes = useCallback(() =>
    listarConversasClientes()
      .then((c) => { setConversasClientes(c); setCarregandoListaClientes(false) })
      .catch(() => { setErroCliente('Não consegui carregar as conversas.'); setCarregandoListaClientes(false) }),
  [])

  const recarregarMensagensCliente = useCallback((clienteId: string) =>
    carregarMensagensCliente(clienteId)
      .then((m) => { setMensagensCliente(m); setCarregandoConversaCliente(false) })
      .catch(() => { setErroCliente('Não consegui carregar esta conversa.'); setCarregandoConversaCliente(false) }),
  [])

  // ── Carregamento inicial ──────────────────────────────────────────────────

  useEffect(() => { recarregarLista() }, [recarregarLista])
  useEffect(() => { recarregarListaClientes() }, [recarregarListaClientes])

  // Abrir uma conversa IA
  useEffect(() => {
    if (!selecionada) return
    recarregarMensagens(selecionada)
    marcarComoLidas(selecionada).then(recarregarLista)
  }, [selecionada, recarregarMensagens, recarregarLista])

  // Abrir uma conversa de cliente
  useEffect(() => {
    if (!selecionadaCliente) return
    recarregarMensagensCliente(selecionadaCliente)
    marcarClienteComoLido(selecionadaCliente).then(recarregarListaClientes)
  }, [selecionadaCliente, recarregarMensagensCliente, recarregarListaClientes])

  // ── Realtime ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const canal = supabase
      .channel('conversas-ia')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mensagens_whatsapp' },
        (payload) => {
          const linha = (payload.new ?? payload.old) as { lead_id?: string } | null
          recarregarLista()
          if (linha?.lead_id && linha.lead_id === abertaRef.current) {
            recarregarMensagens(linha.lead_id)
          }
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'crm_clinica_dados' },
        () => recarregarLista())
      .subscribe()

    return () => { supabase.removeChannel(canal) }
  }, [recarregarLista, recarregarMensagens])

  useEffect(() => {
    const canal = supabase
      .channel('conversas-clientes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mensagens_clientes' },
        (payload) => {
          const linha = (payload.new ?? payload.old) as { cliente_id?: string } | null
          recarregarListaClientes()
          if (linha?.cliente_id && linha.cliente_id === abertaClienteRef.current) {
            recarregarMensagensCliente(linha.cliente_id)
          }
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'clientes_chat' },
        () => recarregarListaClientes())
      .subscribe()

    return () => { supabase.removeChannel(canal) }
  }, [recarregarListaClientes, recarregarMensagensCliente])

  // ── Handlers canal IA ──────────────────────────────────────────────────────

  function selecionarConversa(leadId: string) {
    if (leadId === selecionada) return
    setMensagens([])
    setCarregandoConversa(true)
    setErro('')
    setSelecionada(leadId)
    setParams({ aba: 'ia', lead: leadId }, { replace: true })
  }

  async function aoEnviar(texto: string) {
    if (!selecionada) return
    setEnviando(true); setErro('')
    try {
      await enviarMensagem(selecionada, texto)
      await recarregarMensagens(selecionada)
      await recarregarLista()
    } catch {
      setErro('A mensagem não saiu. Confira se a Evolution está conectada e tente de novo.')
    }
    setEnviando(false)
  }

  async function aoAssumir() {
    if (!selecionada || !usuarioId) return
    setErro('')
    try { await assumirConversa(selecionada, usuarioId); await recarregarLista() }
    catch { setErro('Não consegui assumir a conversa.') }
  }

  async function aoDevolver() {
    if (!selecionada) return
    setErro('')
    try { await devolverConversa(selecionada); await recarregarLista() }
    catch { setErro('Não consegui devolver a conversa.') }
  }

  // ── Handlers canal Clientes ────────────────────────────────────────────────

  function selecionarCliente(clienteId: string) {
    if (clienteId === selecionadaCliente) return
    setMensagensCliente([])
    setCarregandoConversaCliente(true)
    setErroCliente('')
    setSelecionadaCliente(clienteId)
    setParams({ aba: 'clientes', cliente: clienteId }, { replace: true })
  }

  async function aoEnviarCliente(texto: string) {
    if (!selecionadaCliente) return
    setEnviandoCliente(true); setErroCliente('')
    try {
      await enviarMensagemCliente(selecionadaCliente, texto)
      await recarregarMensagensCliente(selecionadaCliente)
      await recarregarListaClientes()
    } catch {
      setErroCliente('A mensagem não saiu. Confira a conexão do 2º número.')
    }
    setEnviandoCliente(false)
  }

  async function aoAssumirCliente() {
    if (!selecionadaCliente || !usuarioId) return
    setErroCliente('')
    try { await assumirContatoCliente(selecionadaCliente, usuarioId); await recarregarListaClientes() }
    catch { setErroCliente('Não consegui assumir o atendimento.') }
  }

  async function aoDevolverCliente() {
    if (!selecionadaCliente) return
    setErroCliente('')
    try { await devolverContatoCliente(selecionadaCliente); await recarregarListaClientes() }
    catch { setErroCliente('Não consegui liberar o atendimento.') }
  }

  // ── Badges de notificação ─────────────────────────────────────────────────

  const naoLidasIA = conversas.reduce((acc, c) => acc + c.nao_lidas, 0)
  const naoLidasClientes = conversasClientes.reduce((acc, c) => acc + c.nao_lidas, 0)

  // ── Dados da conversa aberta ──────────────────────────────────────────────

  const abertaIA = conversas.find((c) => c.lead_id === selecionada) ?? null
  const abertaCliente = conversasClientes.find((c) => c.cliente_id === selecionadaCliente) ?? null

  // ── Alternadores de painel ────────────────────────────────────────────────

  function alternarPainel() {
    setPainelAberto((antes) => {
      const agora = !antes
      try { localStorage.setItem('conversas.painel', agora ? 'aberto' : 'fechado') } catch { /* segue */ }
      return agora
    })
  }

  function alternarPainelCliente() {
    setPainelClienteAberto((antes) => {
      const agora = !antes
      try { localStorage.setItem('conversas-clientes.painel', agora ? 'aberto' : 'fechado') } catch { /* segue */ }
      return agora
    })
  }

  // ── Troca de aba ─────────────────────────────────────────────────────────

  function trocarAba(nova: Aba) {
    setAba(nova)
    const novosParams: Record<string, string> = { aba: nova }
    if (nova === 'ia' && selecionada) novosParams.lead = selecionada
    if (nova === 'clientes' && selecionadaCliente) novosParams.cliente = selecionadaCliente
    setParams(novosParams, { replace: true })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' }}>

      {/* Abas */}
      <div style={{
        display: 'flex', borderBottom: '2px solid #EDF2F4', background: '#fff',
        flexShrink: 0, paddingLeft: 18, gap: 0,
      }}>
        {(['ia', 'clientes'] as Aba[]).map((a) => {
          const ativo = aba === a
          const naoLidas = a === 'ia' ? naoLidasIA : naoLidasClientes
          return (
            <button
              key={a}
              id={`aba-conversas-${a}`}
              onClick={() => trocarAba(a)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '11px 18px 10px', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 700, fontFamily: FONTE,
                background: 'transparent',
                color: ativo ? MARCA : '#6B818C',
                borderBottom: ativo ? `2px solid ${MARCA}` : '2px solid transparent',
                marginBottom: -2, transition: 'color 0.15s',
              }}
            >
              {a === 'ia' ? <Bot size={14} /> : <UserCheck size={14} />}
              {a === 'ia' ? 'Atendente IA' : 'Atendimento ao Cliente'}
              {naoLidas > 0 && (
                <span style={{
                  background: ativo ? MARCA : '#B6C6CD',
                  color: '#fff', borderRadius: 20,
                  fontSize: 9.5, fontWeight: 700, padding: '1px 6px',
                }}>
                  {naoLidas}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Conteúdo da aba ativa */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

        {aba === 'ia' && (
          <>
            <ListaConversas
              conversas={conversas}
              selecionada={selecionada}
              onSelecionar={selecionarConversa}
              carregando={carregandoLista}
            />
            <JanelaConversa
              conversa={abertaIA}
              mensagens={mensagens}
              carregando={carregandoConversa}
              enviando={enviando}
              erro={erro}
              onEnviar={aoEnviar}
              onAssumir={aoAssumir}
              onDevolver={aoDevolver}
              painelAberto={painelAberto}
              onAlternarPainel={alternarPainel}
            />
            {painelAberto && abertaIA && (
              <PainelLead key={abertaIA.lead_id} leadId={abertaIA.lead_id} onFechar={alternarPainel} />
            )}
          </>
        )}

        {aba === 'clientes' && (
          <>
            <ListaConversasClientes
              conversas={conversasClientes}
              selecionada={selecionadaCliente}
              onSelecionar={selecionarCliente}
              carregando={carregandoListaClientes}
            />
            <JanelaConversaClientes
              conversa={abertaCliente}
              mensagens={mensagensCliente}
              carregando={carregandoConversaCliente}
              enviando={enviandoCliente}
              erro={erroCliente}
              onEnviar={aoEnviarCliente}
              onAssumir={aoAssumirCliente}
              onDevolver={aoDevolverCliente}
              usuarioId={usuarioId}
              painelAberto={painelClienteAberto}
              onAlternarPainel={alternarPainelCliente}
            />
            {painelClienteAberto && abertaCliente && (
              <PainelCliente key={abertaCliente.cliente_id} conversa={abertaCliente} onFechar={alternarPainelCliente} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
