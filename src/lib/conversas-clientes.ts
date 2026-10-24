import { supabase } from './supabase'
import type { ClienteChatResumo, MensagemCliente } from '../types'

/**
 * Tudo que a aba "Atendimento ao Cliente" faz com o banco e com a Edge Function.
 *
 * Canal do 2º número de WhatsApp — sem IA, somente atendente humano.
 * Análogo a `conversas.ts` para o canal IA.
 *
 * ⚠️ REALTIME assina a TABELA, nunca a view. A lista vem de `clientes_chat_lista`,
 * mas a assinatura do Supabase Realtime é em `mensagens_clientes` e `clientes_chat`.
 */

/** Quantas mensagens a janela carrega de uma vez. */
const HISTORICO = 200

// ---------------------------------------------------------------------------
// Lista e mensagens
// ---------------------------------------------------------------------------

export async function listarConversasClientes(): Promise<ClienteChatResumo[]> {
  const { data, error } = await supabase
    .from('clientes_chat_lista')
    .select('*')
    .order('ultima_em', { ascending: false })
    .limit(200)

  if (error) throw error
  return (data ?? []) as ClienteChatResumo[]
}

export async function carregarMensagensCliente(clienteId: string): Promise<MensagemCliente[]> {
  const { data, error } = await supabase
    .from('mensagens_clientes')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('criada_em', { ascending: false })
    .limit(HISTORICO)

  if (error) throw error
  // Vem em decrescente para o `limit` pegar as recentes; exibido em crescente.
  return ((data ?? []) as MensagemCliente[]).reverse()
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

/**
 * Envia uma mensagem pelo 2º número via Edge Function.
 *
 * Não grava direto na tabela — a Edge Function grava após o WhatsApp aceitar.
 * O mesmo motivo de `enviarMensagem` em `conversas.ts`.
 */
export async function enviarMensagemCliente(clienteId: string, texto: string): Promise<void> {
  const { data: sessao } = await supabase.auth.getSession()
  const token = sessao.session?.access_token
  if (!token) throw new Error('sessão expirada')

  const r = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp/clientes/enviar`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_id: clienteId, texto }),
    },
  )

  const dados = await r.json().catch(() => null)
  if (!r.ok || !dados?.ok) throw new Error(dados?.motivo ?? 'falha_no_envio')
}

/**
 * Teto do arquivo enviado pelo painel. Igual ao do recebimento
 * (`MAX_MIDIA_BYTES` na função): o que passa por um lado passa pelo outro.
 */
export const MAX_ARQUIVO_BYTES = 16 * 1024 * 1024

export type TipoDeArquivo = 'imagem' | 'video' | 'documento' | 'audio'

/** Qual dos quatro tipos do WhatsApp é este arquivo. Na dúvida, documento. */
export function tipoDoArquivo(arquivo: File): TipoDeArquivo {
  if (arquivo.type.startsWith('image/')) return 'imagem'
  if (arquivo.type.startsWith('video/')) return 'video'
  if (arquivo.type.startsWith('audio/')) return 'audio'
  return 'documento'
}

/**
 * Envia um arquivo (com legenda opcional) pelo 2º número.
 *
 * Dois passos, de propósito: o navegador sobe o arquivo para o bucket e a
 * função recebe só a referência. Mandar o arquivo em base64 dentro do JSON
 * estouraria o limite da requisição muito antes dos 16 MB.
 *
 * ⚠️ Se o envio falhar depois do upload, o arquivo fica órfão no bucket — o
 * bucket não tem política de DELETE para o navegador, de propósito.
 */
export async function enviarArquivoCliente(
  clienteId: string,
  arquivo: File,
  legenda: string,
): Promise<void> {
  if (arquivo.size > MAX_ARQUIVO_BYTES) throw new Error('arquivo_grande_demais')

  const { data: sessao } = await supabase.auth.getSession()
  const token = sessao.session?.access_token
  if (!token) throw new Error('sessão expirada')

  const extensao = /\.([a-z0-9]{1,8})$/i.exec(arquivo.name)?.[1]?.toLowerCase() ?? 'bin'
  const caminho = `clientes/${clienteId}/${crypto.randomUUID()}.${extensao}`
  const mime = arquivo.type || 'application/octet-stream'

  const { error: erroUpload } = await supabase.storage
    .from('midias-whatsapp')
    .upload(caminho, arquivo, { contentType: mime })
  if (erroUpload) throw new Error('falha_no_upload')

  const r = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp/clientes/enviar`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cliente_id: clienteId,
        texto: legenda,
        midia: { caminho, nome: arquivo.name, mime, tipo: tipoDoArquivo(arquivo) },
      }),
    },
  )

  const dados = await r.json().catch(() => null)
  if (!r.ok || !dados?.ok) throw new Error(dados?.motivo ?? 'falha_no_envio')
}

// ---------------------------------------------------------------------------
// Leitura de mensagens
// ---------------------------------------------------------------------------

/** Marca todas as mensagens do cliente como lidas. */
export async function marcarClienteComoLido(clienteId: string): Promise<void> {
  const { error } = await supabase
    .from('mensagens_clientes')
    .update({ lida: true })
    .eq('cliente_id', clienteId)
    .eq('autor', 'cliente')
    .eq('lida', false)

  if (error) throw error
}

// ---------------------------------------------------------------------------
// Assumir / devolver
// ---------------------------------------------------------------------------

/**
 * Atendente assume o contato: marca que está respondendo este cliente.
 *
 * No canal de clientes não há IA para pausar — apenas registra quem está
 * atendendo, para os colegas saberem.
 */
export async function assumirContatoCliente(clienteId: string, usuarioId: string): Promise<void> {
  const { error } = await supabase
    .from('clientes_chat')
    .update({ assumido_por: usuarioId, assumido_em: new Date().toISOString() })
    .eq('id', clienteId)

  if (error) throw error
}

/** Libera o contato: qualquer atendente pode responder agora. */
export async function devolverContatoCliente(clienteId: string): Promise<void> {
  const { error } = await supabase
    .from('clientes_chat')
    .update({ assumido_por: null, assumido_em: null })
    .eq('id', clienteId)

  if (error) throw error
}

// ---------------------------------------------------------------------------
// Formatação (análogas às de conversas.ts)
// ---------------------------------------------------------------------------

/**
 * Texto curto para o preview da mensagem na lista lateral.
 * Análogo a `previaDaMensagem` em `conversas.ts`.
 */
export function previaDaMensagemCliente(c: ClienteChatResumo): string {
  if (!c.ultimo_conteudo && !c.ultimo_tipo) return ''
  if (c.ultimo_tipo === 'audio') return '🎵 Áudio'
  if (c.ultimo_tipo === 'imagem') return '📷 Imagem'
  if (c.ultimo_tipo === 'video') return '🎥 Vídeo'
  if (c.ultimo_tipo === 'documento') return '📄 Documento'
  return c.ultimo_conteudo ?? ''
}

/** "14:03" se hoje, "19/10" se outro dia. */
export function quandoCurtoCliente(dataIso: string): string {
  const d = new Date(dataIso)
  const hoje = new Date()
  if (
    d.getDate() === hoje.getDate() &&
    d.getMonth() === hoje.getMonth() &&
    d.getFullYear() === hoje.getFullYear()
  ) {
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

/** Número de whatsapp formatado para exibição (55 11 9 8765-4321 → +55 11 9 8765-4321). */
export function formatarWhatsapp(numero: string): string {
  const d = numero.replace(/\D/g, '')
  if (d.length === 13) {
    // +55 (DD) 9XXXX-XXXX
    return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 5)} ${d.slice(5, 9)}-${d.slice(9)}`
  }
  if (d.length === 12) {
    // +55 (DD) XXXX-XXXX
    return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`
  }
  return `+${d}`
}
