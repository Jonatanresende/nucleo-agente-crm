/**
 * uazapi — a segunda ponte com o WhatsApp.
 *
 * ⚠️ ESCRITO CONTRA A **v2** (confirmado 2.1.9 na instância da clínica), lendo
 * a API de verdade e não a documentação: `docs.uazapi.com` é uma página que
 * monta a referência por JavaScript, e os markdown por trás dela são rascunho
 * de template. Cada rota abaixo foi verificada contra o servidor.
 *
 * ── O QUE ELA TEM DE DIFERENTE DA EVOLUTION ────────────────────────────────
 *
 * 1. **O texto vem plano.** `text`, e não a árvore do Baileys
 *    (`message.conversation`, `message.extendedTextMessage.text`, …).
 * 2. **`isGroup` é booleano.** A Evolution obriga a olhar o sufixo do jid.
 * 3. **A mídia sai por um POST próprio.** `/message/download` com o
 *    `messageid` devolve uma URL do servidor da uazapi, já descriptografada.
 *    (O `fileURL` do evento existe, mas chega **vazio** nesta instalação — e
 *    a `content.URL` ao lado dele é a CDN do WhatsApp, criptografada.)
 *
 * Autenticação: header `token` com o token **da instância**. O token de admin
 * (que cria e apaga instâncias) não entra aqui — este sistema nunca cria
 * instância, só conversa com a que existe.
 */

import {
  foraDoAr, soDigitos,
  type Conexao, type Estado, type Midia, type Ponte, type Recebimento,
  type WebhookLido,
} from './whatsapp.ts'

/** O mesmo prazo da Evolution: passou disso, para quem olha a tela é "fora do ar". */
const PRAZO_MS = 8_000

interface StatusUazapi {
  instance?: {
    status?: string
    owner?: string
    profileName?: string
    profilePicUrl?: string
    paircode?: string
    qrcode?: string
  }
  status?: { connected?: boolean; jid?: string }
  connected?: boolean
}

function traduzEstado(bruto: string, conectado: boolean | undefined): Estado {
  if (conectado === true) return 'conectado'
  const s = (bruto ?? '').toLowerCase()
  if (s === 'connected') return 'conectado'
  if (s === 'connecting' || s === 'pairing') return 'conectando'
  return 'desconectado'
}

function tipoDe(messageType?: string): string {
  switch ((messageType ?? '').toLowerCase()) {
    case 'audio':
    case 'ptt':
      return 'audio'
    case 'image':
      return 'imagem'
    case 'video':
      return 'video'
    case 'document':
      return 'documento'
    default:
      return 'texto'
  }
}

export function lerWebhook(corpo: Record<string, unknown>): Recebimento {
  if (corpo.isGroup === true) return { tipo: 'ignorar', motivo: 'grupo' }
  if (corpo.fromMe === true) return { tipo: 'ignorar', motivo: 'propria' }

  const whatsapp = soDigitos(String(corpo.chat ?? corpo.sender ?? corpo.from ?? ''))
  if (!whatsapp) return { tipo: 'ignorar', motivo: 'sem_numero' }

  const tipo = tipoDe(String(corpo.messageType ?? 'conversation'))
  const texto = typeof corpo.text === 'string' ? corpo.text : null
  const idExterno = typeof corpo.messageId === 'string'
    ? corpo.messageId
    : typeof corpo.id === 'string' ? corpo.id : null

  const temMidia = tipo !== 'texto' && Boolean(idExterno)
  const midia: Midia | null = temMidia
    ? { via: 'uazapi', idExterno: idExterno!, tipo }
    : null

  return {
    tipo: 'mensagem',
    mensagem: {
      whatsapp,
      idExterno,
      tipo,
      texto,
      midia,
    },
  }
}

export interface OpcoesUazapi {
  urlBase?: string
  token?: string
}

export function criarPonteUazapi(opcoes?: OpcoesUazapi): Ponte {
  const URL_BASE = (opcoes?.urlBase ?? Deno.env.get('UAZAPI_API_URL') ?? '').replace(/\/+$/, '')
  const TOKEN = opcoes?.token ?? Deno.env.get('UAZAPI_TOKEN') ?? ''

  const CABECALHOS = {
    token: TOKEN,
    'Content-Type': 'application/json',
  }

  async function chamar<T>(
    caminho: string,
    corpo?: Record<string, unknown>,
    metodo = 'POST',
    prazo = PRAZO_MS,
  ): Promise<T | null> {
    try {
      const r = await fetch(`${URL_BASE}${caminho}`, {
        method: metodo,
        headers: CABECALHOS,
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(prazo),
      })
      if (!r.ok) return null
      return await r.json() as T
    } catch {
      return null
    }
  }

  async function digitando(numero: string, ms: number): Promise<void> {
    await chamar('/chat/presence', {
      number: soDigitos(numero),
      presence: 'composing',
      delay: ms,
    })
  }

  async function enviarTexto(numero: string, texto: string): Promise<string | null> {
    const r = await chamar<{ messageId?: string; id?: string }>('/message/sendText', {
      number: soDigitos(numero),
      text: texto,
    })
    return r?.messageId ?? r?.id ?? null
  }

  async function baixarMidia(
    midia: Midia,
  ): Promise<{ base64: string; tipoMime: string } | null> {
    if (midia.via !== 'uazapi') return null
    const r = await chamar<{ url?: string; fileURL?: string; mimetype?: string }>(
      '/message/download',
      { messageid: midia.idExterno },
      'POST',
      15_000,
    )
    const url = r?.url || r?.fileURL
    if (!url) return null

    try {
      const arq = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!arq.ok) return null
      const buf = await arq.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binario = ''
      for (let i = 0; i < bytes.byteLength; i++) {
        binario += String.fromCharCode(bytes[i])
      }
      return {
        base64: btoa(binario),
        tipoMime: r?.mimetype || arq.headers.get('content-type') || 'application/octet-stream',
      }
    } catch {
      return null
    }
  }

  async function fotoDoPerfil(numero: string): Promise<string | null> {
    const r = await chamar<{ image?: string }>('/chat/details', {
      number: soDigitos(numero),
      preview: false,
    })
    return r?.image || null
  }

  async function estadoDaConexao(): Promise<Conexao> {
    if (!configurada()) return foraDoAr('nao_configurado')

    const r = await chamar<StatusUazapi>('/instance/status', undefined, 'GET')
    if (!r) return foraDoAr('indisponivel')

    const i = r.instance ?? {}
    return {
      estado: traduzEstado(i.status ?? '', r.status?.connected),
      numero: i.owner ? soDigitos(i.owner) : null,
      perfil: i.profileName ?? null,
      foto: i.profilePicUrl ?? null,
    }
  }

  async function iniciarConexao(
    numero?: string,
  ): Promise<{ codigo: string | null; qr: string | null } | null> {
    const limpo = (numero ?? '').replace(/\D/g, '')
    const r = await chamar<StatusUazapi>(
      '/instance/connect',
      limpo ? { phone: limpo } : {},
    )
    if (!r) return null
    return { codigo: r.instance?.paircode || null, qr: r.instance?.qrcode || null }
  }

  async function desconectar(): Promise<boolean> {
    return await chamar<unknown>('/instance/disconnect', {}) !== null
  }

  function configurada(): boolean {
    return Boolean(URL_BASE && TOKEN)
  }

  function identificacao() {
    return {
      servidor: URL_BASE ? URL_BASE.replace(/^https?:\/\//i, '') : null,
      instancia: null,
      chaveFinal: TOKEN.length >= 4 ? TOKEN.slice(-4) : null,
    }
  }

  async function webhook(): Promise<WebhookLido | null> {
    const r = await chamar<{ url?: string; enabled?: boolean }[]>('/webhook', undefined, 'GET')
    if (!Array.isArray(r)) return null
    const w = r.find((x) => x?.enabled && x?.url) ?? r[0]
    if (!w) return { url: null, ativo: false }
    return { url: w.url ?? null, ativo: w.enabled === true }
  }

  async function apontarWebhook(url: string, segredo: string): Promise<boolean> {
    const r = await chamar<unknown>('/webhook', {
      enabled: true,
      url: `${url}?segredo=${encodeURIComponent(segredo)}`,
      events: ['messages'],
      excludeMessages: ['wasSentByApi', 'isGroupYes'],
      addUrlEvents: false,
      addUrlTypesMessages: false,
    })
    return r !== null
  }

  return {
    nome: 'uazapi',
    configurada,
    lerWebhook,
    webhook,
    apontarWebhook,
    digitando,
    enviarTexto,
    baixarMidia,
    fotoDoPerfil,
    estadoDaConexao,
    iniciarConexao,
    desconectar,
    identificacao,
  }
}

export const UAZAPI: Ponte = criarPonteUazapi()
