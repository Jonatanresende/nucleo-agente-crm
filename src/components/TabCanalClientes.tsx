import React, { useEffect, useState } from 'react'
import {
  Save, Check, Smartphone, RefreshCw, LogOut,
  AlertTriangle, Radio, ShieldCheck,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  lerConexaoClientes, conectarClientes, desconectarClientes,
  apontarWebhookClientes, type Conexao,
} from '../lib/whatsappConexao'
import { MARCA, MARCA_SUAVE } from '../lib/marca'

const FONTE = "'Plus Jakarta Sans', sans-serif"
const MONO = "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace"

const VISUAL: Record<string, { cor: string; fundo: string; borda: string; rotulo: string }> = {
  verificando: { cor: '#6B818C', fundo: '#F2F6F7', borda: '#DCE6EA', rotulo: 'Verificando...' },
  conectado: { cor: '#1A7A48', fundo: '#E8F8EF', borda: '#B7E7CB', rotulo: 'Conectado' },
  conectando: { cor: '#D97706', fundo: '#FFFBEB', borda: '#FDE68A', rotulo: 'Conectando...' },
  desconectado: { cor: '#DC2626', fundo: '#FEF2F2', borda: '#FECACA', rotulo: 'Desconectado' },
  indisponivel: { cor: '#DC2626', fundo: '#FEF2F2', borda: '#FECACA', rotulo: 'Servidor fora do ar' },
  nao_configurado: { cor: '#D97706', fundo: '#FFFBEB', borda: '#FDE68A', rotulo: 'Sem instância configurada' },
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 9, border: '1px solid #DCE6EA',
  fontSize: 13.5, fontFamily: FONTE, color: '#16232B',
  outline: 'none', background: '#fff', boxSizing: 'border-box',
}

const rotuloStyle: React.CSSProperties = {
  fontSize: 12.5, fontWeight: 600, color: '#16232B', display: 'block', marginBottom: 6,
}

const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 14, border: '1px solid #DCE6EA',
  padding: '22px 26px', marginBottom: 16,
}

const tituloCardStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 700, color: '#16232B', marginBottom: 16,
  paddingBottom: 12, borderBottom: '1px solid #EDF2F4',
}

export default function TabCanalClientes() {
  const [ativo, setAtivo] = useState(false)
  const [provedor, setProvedor] = useState<'evolution' | 'uazapi'>('evolution')
  const [instancia, setInstancia] = useState('')
  const [boasVindasAtivo, setBoasVindasAtivo] = useState(false)
  const [boasVindasTexto, setBoasVindasTexto] = useState('')

  // Estado de conexão
  const [conexao, setConexao] = useState<Conexao | null>(null)
  const [verificando, setVerificando] = useState(false)
  const [apontando, setApontando] = useState(false)
  const [apontou, setApontou] = useState(false)
  const [pareando, setPareando] = useState(false)
  const [codigo, setCodigo] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [telefoneParear, setTelefoneParear] = useState('')
  const [configId, setConfigId] = useState<string | null>(null)

  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState('')

  // Carrega configuração do banco
  useEffect(() => {
    supabase
      .from('configuracoes_agente')
      .select('id, clientes_chat_ativo, clientes_provedor, clientes_instancia, clientes_boas_vindas_ativo, clientes_boas_vindas_texto')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        setConfigId(data.id)
        setAtivo(Boolean(data.clientes_chat_ativo))
        setProvedor((data.clientes_provedor as 'evolution' | 'uazapi') ?? 'evolution')
        setInstancia(data.clientes_instancia ?? '')
        setBoasVindasAtivo(Boolean(data.clientes_boas_vindas_ativo))
        setBoasVindasTexto(data.clientes_boas_vindas_texto ?? 'Olá! Sua mensagem foi recebida. Em breve um atendente irá retornar.')
      })
  }, [])

  // Verifica conexão da 2ª instância
  const checarConexao = async () => {
    setVerificando(true)
    setErro('')
    try {
      const c = await lerConexaoClientes()
      setConexao(c)
    } catch {
      setErro('Não foi possível verificar a conexão do 2º número.')
    } finally {
      setVerificando(false)
    }
  }

  useEffect(() => {
    checarConexao()
  }, [])

  const salvarConfiguracoes = async () => {
    if (!configId) {
      setErro('Configuração não encontrada no banco de dados.')
      return
    }

    setSalvando(true)
    setErro('')
    try {
      const { error: err } = await supabase
        .from('configuracoes_agente')
        .update({
          clientes_chat_ativo: ativo,
          clientes_provedor: provedor,
          clientes_instancia: instancia.trim() || null,
          clientes_boas_vindas_ativo: boasVindasAtivo,
          clientes_boas_vindas_texto: boasVindasTexto.trim() || null,
        })
        .eq('id', configId)

      if (err) throw err

      setSalvo(true)
      setTimeout(() => setSalvo(false), 2500)
      // Re-checa conexão com os novos dados
      void checarConexao()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar configurações do 2º número.')
    } finally {
      setSalvando(false)
    }
  }

  const handleApontarWebhook = async () => {
    setApontando(true)
    setErro('')
    try {
      await apontarWebhookClientes()
      setApontou(true)
      setTimeout(() => setApontou(false), 3000)
      await checarConexao()
    } catch (e) {
      setErro(e instanceof Error ? `Erro ao apontar webhook: ${e.message}` : 'A ponte recusou o apontamento do webhook.')
    } finally {
      setApontando(false)
    }
  }

  const handleIniciarPareamento = async () => {
    setPareando(true)
    setErro('')
    setCodigo(null)
    setQr(null)
    try {
      const r = await conectarClientes(telefoneParear)
      setCodigo(r.codigo)
      setQr(r.qr)
    } catch {
      setErro('Erro ao iniciar pareamento. Verifique se a instância está pronta.')
    } finally {
      setPareando(false)
    }
  }

  const handleDesconectar = async () => {
    if (!window.confirm('Tem certeza que deseja desconectar o WhatsApp do 2º número?')) return
    setVerificando(true)
    try {
      await desconectarClientes()
      await checarConexao()
    } catch {
      setErro('Erro ao desconectar WhatsApp.')
    } finally {
      setVerificando(false)
    }
  }

  const visualEstado = VISUAL[conexao?.estado ?? 'verificando'] ?? VISUAL.verificando

  return (
    <div style={{ maxWidth: 780, fontFamily: FONTE }}>

      {/* Card 1: Status da Conexão */}
      <div style={cardStyle}>
        <div style={{ ...tituloCardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Smartphone size={16} color={MARCA} />
            <span>Conexão do 2º Número (Atendimento ao Cliente)</span>
          </div>

          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '3px 9px', borderRadius: 20,
            background: visualEstado.fundo, border: `1px solid ${visualEstado.borda}`,
            color: visualEstado.cor, fontSize: 11.5, fontWeight: 700,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: visualEstado.cor }} />
            {visualEstado.rotulo}
          </div>
        </div>

        {/* Detalhes da conexão */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12, marginBottom: 16, background: '#F8FAFB', padding: '12px 16px', borderRadius: 10,
        }}>
          <div>
            <span style={{ fontSize: 11, color: '#6B818C', fontWeight: 600, display: 'block' }}>PROVEDOR</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#16232B' }}>
              {conexao?.provedor === 'uazapi' ? 'uazapi' : 'Evolution API'}
            </span>
          </div>

          <div>
            <span style={{ fontSize: 11, color: '#6B818C', fontWeight: 600, display: 'block' }}>INSTÂNCIA</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#16232B', fontFamily: MONO }}>
              {conexao?.instancia || instancia || '—'}
            </span>
          </div>

          <div>
            <span style={{ fontSize: 11, color: '#6B818C', fontWeight: 600, display: 'block' }}>WHATSAPP CONECTADO</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#16232B' }}>
              {conexao?.numero ? `+${conexao.numero}` : 'Nenhum'}
            </span>
          </div>

          <div>
            <span style={{ fontSize: 11, color: '#6B818C', fontWeight: 600, display: 'block' }}>WEBHOOK</span>
            <span style={{
              fontSize: 12, fontWeight: 700,
              color: conexao?.webhook === 'apontado' ? '#1A7A48' : '#D97706',
            }}>
              {conexao?.webhook === 'apontado' ? '✅ Apontado' : '⚠️ Não apontado'}
            </span>
          </div>
        </div>

        {/* Ações da conexão */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={checarConexao}
            disabled={verificando}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8,
              border: '1px solid #DCE6EA', background: '#fff',
              fontSize: 12.5, fontWeight: 600, color: '#16232B', cursor: 'pointer',
            }}
          >
            <RefreshCw size={13} className={verificando ? 'animate-spin' : ''} />
            {verificando ? 'Verificando...' : 'Verificar conexão'}
          </button>

          <button
            onClick={handleApontarWebhook}
            disabled={apontando}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8,
              border: '1px solid #DCE6EA', background: apontou ? '#E8F8EF' : '#fff',
              color: apontou ? '#1A7A48' : '#16232B',
              fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            }}
          >
            <ShieldCheck size={14} color={apontou ? '#1A7A48' : MARCA} />
            {apontou ? 'Webhook apontado!' : apontando ? 'Apontando...' : 'Apontar webhook para cá'}
          </button>

          {conexao?.estado === 'conectado' && (
            <button
              onClick={handleDesconectar}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 8,
                border: '1px solid #FECACA', background: '#FEF2F2',
                color: '#DC2626', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <LogOut size={13} /> Desconectar
            </button>
          )}
        </div>

        {/* Pareamento se desconectado */}
        {conexao?.estado === 'desconectado' && (
          <div style={{
            marginTop: 16, padding: '14px 16px', background: '#FFFBEB',
            border: '1px solid #FDE68A', borderRadius: 10,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#B45309', marginBottom: 6 }}>
              Aparelho desconectado
            </div>
            <p style={{ fontSize: 12.5, color: '#92400E', margin: '0 0 10px' }}>
              Para conectar este número ao WhatsApp, digite o número do aparelho com DDD para gerar o código de pareamento:
            </p>
            <div style={{ display: 'flex', gap: 8, maxWidth: 360, marginBottom: 12 }}>
              <input
                type="text"
                placeholder="Ex: 11987654321"
                value={telefoneParear}
                onChange={(e) => setTelefoneParear(e.target.value)}
                style={inputStyle}
              />
              <button
                onClick={handleIniciarPareamento}
                disabled={pareando || !telefoneParear.trim()}
                style={{
                  padding: '8px 16px', borderRadius: 8, border: 'none',
                  background: MARCA, color: '#fff', fontSize: 13, fontWeight: 700,
                  cursor: pareando || !telefoneParear.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {pareando ? 'Gerando...' : 'Parear'}
              </button>
            </div>

            {codigo && (
              <div style={{ background: '#fff', padding: '10px 14px', borderRadius: 8, border: '1px solid #FDE68A' }}>
                <span style={{ fontSize: 12, color: '#6B818C', display: 'block' }}>CÓDIGO DE PAREAMENTO:</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: '#16232B', letterSpacing: 2, fontFamily: MONO }}>
                  {codigo}
                </span>
                <p style={{ fontSize: 11.5, color: '#6B818C', margin: '4px 0 0' }}>
                  Abra o WhatsApp no celular → Aparelhos conectados → Conectar com número de telefone → digite este código.
                </p>
              </div>
            )}

            {qr && !codigo && (
              <div style={{ marginTop: 8 }}>
                <img src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`} alt="QR Code" style={{ width: 180, height: 180, borderRadius: 8 }} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Card 2: Parâmetros do Canal */}
      <div style={cardStyle}>
        <div style={tituloCardStyle}>Configurações do Canal</div>

        {/* Toggle Canal Ativo */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#16232B' }}>Canal de Clientes Ativo</div>
            <div style={{ fontSize: 12, color: '#6B818C', marginTop: 2 }}>
              Permite receber e enviar mensagens pelo 2º número na aba Conversas.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAtivo((v) => !v)}
            style={{
              width: 44, height: 24, borderRadius: 12,
              background: ativo ? MARCA : '#DCE6EA',
              border: 'none', cursor: 'pointer', position: 'relative',
              transition: 'background 0.2s', flexShrink: 0,
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: '50%', background: '#fff',
              position: 'absolute', top: 3, left: ativo ? 23 : 3,
              transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </button>
        </div>

        {/* Provedor */}
        <div style={{ marginBottom: 16 }}>
          <label style={rotuloStyle}>Provedor da 2ª Instância</label>
          <div style={{ display: 'flex', gap: 10 }}>
            {(['evolution', 'uazapi'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvedor(p)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 16px', borderRadius: 9,
                  border: `1px solid ${provedor === p ? MARCA : '#DCE6EA'}`,
                  background: provedor === p ? MARCA_SUAVE : '#fff',
                  color: provedor === p ? MARCA : '#16232B',
                  fontSize: 13, fontWeight: provedor === p ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                <Radio size={13} color={provedor === p ? MARCA : '#94A3B8'} />
                {p === 'evolution' ? 'Evolution API' : 'uazapi'}
              </button>
            ))}
          </div>
        </div>

        {/* Nome da Instância */}
        <div style={{ marginBottom: 20 }}>
          <label style={rotuloStyle}>
            Nome da Instância do 2º Número
            <span style={{ fontWeight: 400, color: '#6B818C', marginLeft: 6 }}>
              (ex: nucleo-clientes ou conforme criado na Evolution)
            </span>
          </label>
          <input
            type="text"
            placeholder="Nome da instância na Evolution/uazapi"
            value={instancia}
            onChange={(e) => setInstancia(e.target.value)}
            style={{ ...inputStyle, fontFamily: MONO }}
          />
          <span style={{ fontSize: 11.5, color: '#6B818C', display: 'block', marginTop: 4 }}>
            💡 Dica: a URL da Evolution é reutilizada. A API Key e o nome da instância também podem ser configurados nas secrets <code style={{ fontFamily: MONO }}>EVOLUTION_INSTANCIA_CLIENTES</code> e <code style={{ fontFamily: MONO }}>EVOLUTION_API_KEY_CLIENTES</code>.
          </span>
        </div>
      </div>

      {/* Card 3: Mensagem de Boas-Vindas */}
      <div style={cardStyle}>
        <div style={tituloCardStyle}>Mensagem de Boas-Vindas Automática</div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#16232B' }}>
              Enviar boas-vindas na primeira mensagem
            </div>
            <div style={{ fontSize: 12, color: '#6B818C', marginTop: 2 }}>
              Enviada apenas na primeira vez que um cliente mandar mensagem para este número.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setBoasVindasAtivo((v) => !v)}
            style={{
              width: 44, height: 24, borderRadius: 12,
              background: boasVindasAtivo ? MARCA : '#DCE6EA',
              border: 'none', cursor: 'pointer', position: 'relative',
              transition: 'background 0.2s', flexShrink: 0,
            }}
          >
            <div style={{
              width: 18, height: 18, borderRadius: '50%', background: '#fff',
              position: 'absolute', top: 3, left: boasVindasAtivo ? 23 : 3,
              transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </button>
        </div>

        {boasVindasAtivo && (
          <div>
            <label style={rotuloStyle}>Texto da Mensagem</label>
            <textarea
              rows={3}
              value={boasVindasTexto}
              onChange={(e) => setBoasVindasTexto(e.target.value)}
              placeholder="Digite a mensagem automática de retorno..."
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>
        )}
      </div>

      {/* Alerta de erro se houver */}
      {erro && (
        <div style={{
          background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 9,
          padding: '10px 14px', fontSize: 12.5, color: '#DC2626', marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <AlertTriangle size={15} style={{ flexShrink: 0 }} />
          <span>{erro}</span>
        </div>
      )}

      {/* Botão Salvar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button
          onClick={salvarConfiguracoes}
          disabled={salvando}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '10px 22px', borderRadius: 10, border: 'none',
            background: salvo ? '#1A7A48' : MARCA, color: '#fff',
            fontSize: 13.5, fontWeight: 700, cursor: salvando ? 'not-allowed' : 'pointer',
            transition: 'background 0.2s',
          }}
        >
          {salvo ? <Check size={16} /> : <Save size={16} />}
          {salvo ? 'Salvo com sucesso!' : salvando ? 'Salvando...' : 'Salvar configurações'}
        </button>
      </div>

    </div>
  )
}
