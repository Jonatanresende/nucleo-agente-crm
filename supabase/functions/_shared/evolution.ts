/**
 * Evolution API — a ponte com o WhatsApp.
 *
 * ⚠️ ESCRITO PARA A **v2** (confirmado 2.3.7 na instância da clínica).
 * A v1 usa outros formatos de corpo — `{ textMessage: { text } }` em vez de
 * `{ text }`, por exemplo. Trocar a versão do servidor quebra este arquivo.
 *
 * Implementa a porta de `whatsapp.ts`, junto com a uazapi. Ver lá o porquê.
 */

import {
  foraDoAr, soDigitos,
  type Conexao, type Estado, type Midia, type OpcoesLeitura, type Ponte, type Recebimento,
  type WebhookLido,
} from './whatsapp.ts'

export type { Conexao, Estado }

/** `5511987654321@s.whatsapp.net` → `5511987654321`. Mora em `whatsapp.ts`. */
export const numeroDoJid = soDigitos

/** Prazo para o servidor responder. Passou disso, tratamos como fora do ar. */
const PRAZO_MS = 8_000

interface InstanciaBruta {
  name?: string
  instanceName?: string
  connectionStatus?: string
  state?: string
  ownerJid?: string
  profileName?: string
  profilePicUrl?: string
  instance?: InstanciaBruta
}

/**
 * O formato do Baileys, que a Evolution repassa cru.
 */
function leConteudo(dados: Record<string, unknown>): {
  tipo: string
  texto: string | null
  temMidia: boolean
} {
  const m = (dados?.message ?? {}) as Record<string, Record<string, unknown>>

  const texto = (m.conversation as unknown as string) ??
    (m.extendedTextMessage?.text as string) ??
    (m.imageMessage?.caption as string) ??
    (m.videoMessage?.caption as string) ?? null

  if (m.audioMessage) return { tipo: 'audio', texto: null, temMidia: true }
  if (m.imageMessage) return { tipo: 'imagem', texto: texto ?? null, temMidia: true }
  if (m.videoMessage) return { tipo: 'video', texto: texto ?? null, temMidia: false }
  if (m.documentMessage) return { tipo: 'documento', texto: texto ?? null, temMidia: false }

  return { tipo: 'texto', texto: texto ?? null, temMidia: false }
}

export function lerWebhook(
  corpo: Record<string, unknown>,
  opcoes: OpcoesLeitura = {},
): Recebimento {
  if (corpo.event && String(corpo.event).toUpperCase().replace(/\./g, '_') !== 'MESSAGES_UPSERT') {
    return { tipo: 'ignorar', motivo: `evento_${corpo.event}` }
  }

  const dados = (Array.isArray(corpo.data) ? corpo.data[0] : corpo.data) as
    Record<string, unknown> | undefined
  const chave = (dados?.key ?? {}) as { fromMe?: boolean; remoteJid?: string; id?: string }

  if (!dados || !chave.remoteJid) return { tipo: 'ignorar', motivo: 'formato_desconhecido' }

  // Mensagem que nós mesmos mandamos volta pelo webhook.
  if (chave.fromMe && !opcoes.incluirPropria) return { tipo: 'ignorar', motivo: 'propria' }

  // Grupo não é atendimento. Newsletter e status, muito menos.
  if (!chave.remoteJid.endsWith('@s.whatsapp.net')) {
    return { tipo: 'ignorar', motivo: 'nao_e_conversa' }
  }

  const whatsapp = numeroDoJid(chave.remoteJid)
  if (!whatsapp) return { tipo: 'ignorar', motivo: 'sem_numero' }

  const c = leConteudo(dados)
  return {
    tipo: 'mensagem',
    mensagem: {
      whatsapp,
      idExterno: chave.id ?? null,
      tipo: c.tipo,
      texto: c.texto,
      midia: c.temMidia ? { via: 'evolution', mensagem: dados } : null,
      propria: chave.fromMe === true,
    },
  }
}

export interface OpcoesEvolution {
  urlBase?: string
  chave?: string
  instancia?: string
}

/**
 * Cria uma ponte Evolution configurada com parâmetros explícitos ou variáveis de ambiente.
 *
 * Permite que múltiplos números/instâncias coexistam (ex: 1º número da IA e 2º número de clientes)
 * com URLs, chaves ou instâncias distintas.
 */
export function criarPonteEvolution(opcoes?: OpcoesEvolution): Ponte {
  const URL_BASE = (opcoes?.urlBase ?? Deno.env.get('EVOLUTION_API_URL') ?? '').replace(/\/+$/, '')
  const CHAVE = opcoes?.chave ?? Deno.env.get('EVOLUTION_API_KEY') ?? ''
  const INSTANCIA = opcoes?.instancia ?? Deno.env.get('EVOLUTION_INSTANCIA') ?? ''

  const CABECALHOS = {
    apikey: CHAVE,
    'Content-Type': 'application/json',
  }

  async function chamar<T>(caminho: string, corpo: Record<string, unknown>): Promise<T> {
    const r = await fetch(`${URL_BASE}/${caminho}/${INSTANCIA}`, {
      method: 'POST',
      headers: CABECALHOS,
      body: JSON.stringify(corpo),
    })
    if (!r.ok) throw new Error(`evolution ${caminho}: ${r.status} ${await r.text()}`)
    return await r.json() as T
  }

  async function buscar<T>(caminho: string, metodo = 'GET'): Promise<T | null> {
    try {
      const r = await fetch(`${URL_BASE}/${caminho}`, {
        method: metodo,
        headers: CABECALHOS,
        signal: AbortSignal.timeout(PRAZO_MS),
      })
      if (!r.ok) return null
      return await r.json() as T
    } catch {
      return null
    }
  }

  async function digitando(numero: string, ms: number): Promise<void> {
    try {
      await chamar('chat/sendPresence', { number: numero, delay: ms, presence: 'composing' })
    } catch {
      // Presença é cosmética.
    }
  }

  async function enviarTexto(numero: string, texto: string): Promise<string | null> {
    const r = await chamar<{ key?: { id?: string } }>('message/sendText', {
      number: numero,
      text: texto,
    })
    return r?.key?.id ?? null
  }

  async function baixarMidia(
    midia: Midia,
  ): Promise<{ base64: string; tipoMime: string } | null> {
    if (midia.via !== 'evolution') return null
    try {
      const r = await chamar<{ base64?: string; mimetype?: string }>(
        'chat/getBase64FromMediaMessage',
        { message: midia.mensagem, convertToMp4: false },
      )
      if (!r?.base64) return null
      return { base64: r.base64, tipoMime: r.mimetype ?? 'application/octet-stream' }
    } catch {
      return null
    }
  }

  async function fotoDoPerfil(numero: string): Promise<string | null> {
    try {
      const r = await chamar<{ profilePictureUrl?: string | null }>(
        'chat/fetchProfilePictureUrl',
        { number: numero },
      )
      return r?.profilePictureUrl ?? null
    } catch {
      return null
    }
  }

  async function estadoDaConexao(): Promise<Conexao> {
    if (!configurada()) return foraDoAr('nao_configurado')

    const lista = await buscar<InstanciaBruta[] | InstanciaBruta>('instance/fetchInstances')
    if (lista === null) return foraDoAr('indisponivel')

    const todas = (Array.isArray(lista) ? lista : [lista]).map((i) => i.instance ?? i)
    const nossa = todas.find((i) => (i.name ?? i.instanceName) === INSTANCIA)

    if (!nossa) return foraDoAr('desconectado')

    const bruto = (nossa.connectionStatus ?? nossa.state ?? '').toLowerCase()
    const estado: Estado =
      bruto === 'open' ? 'conectado' : bruto === 'connecting' ? 'conectando' : 'desconectado'

    return {
      estado,
      numero: nossa.ownerJid ? numeroDoJid(nossa.ownerJid) : null,
      perfil: nossa.profileName ?? null,
      foto: nossa.profilePicUrl ?? null,
    }
  }

  async function iniciarConexao(
    numero?: string,
  ): Promise<{ codigo: string | null; qr: string | null } | null> {
    const limpo = (numero ?? '').replace(/\D/g, '')
    const r = await buscar<{ pairingCode?: string; code?: string; base64?: string }>(
      `instance/connect/${INSTANCIA}${limpo ? `?number=${limpo}` : ''}`,
    )
    if (!r) return null

    return { codigo: r.pairingCode ?? null, qr: r.base64 ?? r.code ?? null }
  }

  async function desconectar(): Promise<boolean> {
    return await buscar<unknown>(`instance/logout/${INSTANCIA}`, 'DELETE') !== null
  }

  function identificacao(): {
    servidor: string | null
    instancia: string | null
    chaveFinal: string | null
  } {
    return {
      servidor: URL_BASE ? URL_BASE.replace(/^https?:\/\//i, '') : null,
      instancia: INSTANCIA || null,
      chaveFinal: CHAVE.length >= 4 ? CHAVE.slice(-4) : null,
    }
  }

  function configurada(): boolean {
    return Boolean(URL_BASE && CHAVE && INSTANCIA)
  }

  async function webhook(): Promise<WebhookLido | null> {
    try {
      const r = await fetch(`${URL_BASE}/webhook/find/${INSTANCIA}`, {
        headers: CABECALHOS,
        signal: AbortSignal.timeout(PRAZO_MS),
      })
      if (r.status === 404) return { url: null, ativo: false }
      if (!r.ok) return null
      const d = await r.json().catch(() => null) as { url?: string; enabled?: boolean } | null
      if (!d) return { url: null, ativo: false }
      return { url: d.url ?? null, ativo: d.enabled !== false }
    } catch {
      return null
    }
  }

  async function apontarWebhook(url: string, segredo: string): Promise<boolean> {
    try {
      const r = await fetch(`${URL_BASE}/webhook/set/${INSTANCIA}`, {
        method: 'POST',
        headers: CABECALHOS,
        body: JSON.stringify({
          webhook: {
            enabled: true,
            url,
            headers: { 'x-webhook-segredo': segredo },
            byEvents: false,
            base64: false,
            events: ['MESSAGES_UPSERT'],
          },
        }),
        signal: AbortSignal.timeout(PRAZO_MS),
      })
      return r.ok
    } catch {
      return false
    }
  }

  return {
    nome: 'evolution',
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

/** Ponte padrão do 1º número (lê envs padrão). */
export const EVOLUTION: Ponte = criarPonteEvolution()

export const digitando = EVOLUTION.digitando
export const enviarTexto = EVOLUTION.enviarTexto
export const baixarMidia = EVOLUTION.baixarMidia
export const fotoDoPerfil = EVOLUTION.fotoDoPerfil
export const estadoDaConexao = EVOLUTION.estadoDaConexao
export const iniciarConexao = EVOLUTION.iniciarConexao
export const desconectar = EVOLUTION.desconectar
export const identificacao = EVOLUTION.identificacao
export const configurada = EVOLUTION.configurada
export const webhook = EVOLUTION.webhook
export const apontarWebhook = EVOLUTION.apontarWebhook
