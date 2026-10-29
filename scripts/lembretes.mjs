/**
 * Liga, desliga e mostra os lembretes automáticos de agendamento (migração 0033).
 *
 *     npm run lembretes:ligar      agenda o cron de minuto em minuto
 *     npm run lembretes:desligar   tira o cron da agenda
 *     npm run lembretes:estado     o job, as últimas batidas e a fila de agora
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const MANAGEMENT = 'https://api.supabase.com/v1'
const AGENTE = 'nucleo-lembretes/1.0'

/** O nome do job no `cron.job`. */
const JOB = 'lembretes_agendamento'

function morrer(mensagem) {
  console.error(`\n  ✖  ${mensagem}\n`)
  process.exit(1)
}

function ler(caminho) {
  if (!existsSync(caminho)) return null
  const fora = {}
  for (const linha of readFileSync(caminho, 'utf8').split(/\r?\n/)) {
    const corte = linha.indexOf('=')
    if (corte < 1 || linha.trimStart().startsWith('#')) continue
    fora[linha.slice(0, corte).trim()] = linha.slice(corte + 1).trim()
  }
  return fora
}

const texto = (valor) => `'${String(valor).replace(/'/g, "''")}'`

const cfg = ler(join(RAIZ, '.supabase-token.local'))
if (!cfg) {
  morrer('Falta o .supabase-token.local.\n\n'
    + '     É dele que saem o token e o ref do projeto. O molde\n'
    + '     .supabase-token.example explica como preencher.')
}
const TOKEN = cfg.SUPABASE_ACCESS_TOKEN
const REF = cfg.SUPABASE_PROJECT_REF
if (!TOKEN) morrer('SUPABASE_ACCESS_TOKEN está vazio em .supabase-token.local.')
if (!REF) morrer('SUPABASE_PROJECT_REF está vazio em .supabase-token.local.')

async function sql(consulta) {
  const r = await fetch(`${MANAGEMENT}/projects/${REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'User-Agent': AGENTE,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: consulta }),
  })
  const corpo = await r.text()
  if (!r.ok) {
    const mensagem = (() => {
      try { return JSON.parse(corpo).message ?? corpo } catch { return corpo }
    })()
    morrer(`O banco recusou:\n\n     ${String(mensagem).slice(0, 500)}`)
  }
  try { return JSON.parse(corpo) } catch { return [] }
}

async function exigirMigracao() {
  const achou = await sql(
    `select 1 from pg_proc where proname = 'disparar_lembretes'
       and pronamespace = 'public'::regnamespace`,
  )
  if (!achou.length) {
    morrer('A migração 0033 ainda não foi aplicada neste banco.\n\n'
      + '     Aplique supabase/migrations/0033_lembretes_agendamento.sql antes de ligar os\n'
      + '     lembretes — é ela que cria a fila e a função de disparo.')
  }
}

async function ligar() {
  await exigirMigracao()

  const agente = ler(join(RAIZ, 'agente-ia', '.env.agente.local'))
  const segredo = agente?.WEBHOOK_SEGREDO
  if (!segredo) {
    morrer('WEBHOOK_SEGREDO está vazio em agente-ia/.env.agente.local.\n\n'
      + '     É o mesmo segredo do webhook: a rota /lembrete recusa quem chega sem ele.')
  }

  const url = `https://${REF}.supabase.co/functions/v1/whatsapp/lembrete`

  for (const [nome, valor, descricao] of [
    ['lembrete_url', url, 'Endereco da rota de lembrete da Edge Function whatsapp'],
    ['followup_segredo', segredo, 'O WEBHOOK_SEGREDO, para aceitar o cron'],
  ]) {
    await sql(`
      select vault.update_secret(id, ${texto(valor)}, ${texto(nome)}, ${texto(descricao)})
      from vault.secrets where name = ${texto(nome)};

      select vault.create_secret(${texto(valor)}, ${texto(nome)}, ${texto(descricao)})
      where not exists (select 1 from vault.secrets where name = ${texto(nome)});
    `)
  }
  console.log('\n  ✔ Endereço e segredo guardados no Vault do seu projeto.')

  await sql(`select cron.schedule(${texto(JOB)}, '* * * * *', 'select public.disparar_lembretes()')`)
  console.log('  ✔ Cron dos lembretes agendado: de minuto em minuto.')

  await estado()

  console.log('  Os lembretes de agendamento estão no ar (24h antes e reforço horas antes).\n')
}

async function desligar() {
  const achou = await sql(`select 1 from cron.job where jobname = ${texto(JOB)}`)
  if (!achou.length) {
    console.log('\n  · Não havia job agendado. Nada a desligar.\n')
    return
  }
  await sql(`select cron.unschedule(${texto(JOB)})`)
  console.log('\n  ✔ Cron desagendado. Nenhum lembrete automático será enviado.\n')
}

async function estado() {
  const [config] = await sql(`
    select ativo, lembrete_ativo, modo_teste,
           lembrete_horas_antecedencia, lembrete_reforco_horas,
           to_char(lembrete_inicio, 'HH24:MI') as inicio,
           to_char(lembrete_fim,    'HH24:MI') as fim
    from public.configuracoes_agente limit 1
  `)

  const [job] = await sql(
    `select schedule, active from cron.job where jobname = ${texto(JOB)}`,
  )

  const fila = await sql('select tipo, count(*)::int as quantos from public.lembretes_pendentes() group by tipo order by tipo')

  const enviados = await sql(`
    select tipo, count(*)::int as quantos
    from public.agente_lembretes
    where enviado_em > now() - interval '7 days'
    group by tipo order by tipo
  `)

  const batidas = await sql(`
    select d.status, count(*)::int as quantas
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
    where j.jobname = ${texto(JOB)} and d.start_time > now() - interval '1 hour'
    group by d.status
  `)

  const conta = (linhas, tipo) =>
    linhas.find((l) => l.tipo === tipo)?.quantos ?? 0

  console.log('')
  console.log(`  Cron          ${job ? `${job.schedule}${job.active ? '' : ' (PAUSADO)'}` : 'não agendado — rode npm run lembretes:ligar'}`)
  console.log(`  Batidas 1h    ${batidas.length ? batidas.map((b) => `${b.quantas} ${b.status}`).join(', ') : 'nenhuma ainda'}`)
  console.log(`  Agente        ${config?.ativo ? 'ligado' : 'DESLIGADO — nada é enviado'}${config?.modo_teste ? ', em modo teste' : ''}`)
  console.log(`  Lembretes     ${config?.lembrete_ativo ? 'ligado' : 'DESLIGADO na configuracoes_agente'}`)
  console.log(`  Janela        das ${config?.inicio} às ${config?.fim}`)
  console.log(`  1º Lembrete   ${config?.lembrete_horas_antecedencia} horas antes do agendamento`)
  console.log(`  Reforço       ${config?.lembrete_reforco_horas} horas antes do agendamento (se calado)`)
  console.log(`  Fila agora    ${conta(fila, 'lembrete_24h')} lembrete 24h, ${conta(fila, 'reforco_horas_antes')} reforço`)
  console.log(`  Últimos 7d    ${conta(enviados, 'lembrete_24h')} enviados (24h), ${conta(enviados, 'reforco_horas_antes')} reforço`)
  console.log('')
}

const acao = process.argv[2]
if (acao === 'ligar') await ligar()
else if (acao === 'desligar') await desligar()
else if (acao === 'estado') await estado()
else morrer('Comando inválido. Use: ligar | desligar | estado')
