-- =============================================================================
-- 0033 — Lembretes de agendamento (24h e reforço), confirmação e follow-up
-- =============================================================================
--
-- Implementa a funcionalidade de lembretes automáticos para agendamentos:
--   1. Lembrete de 24 horas antes da consulta, informando o tipo de serviço.
--   2. Aviso de reforço poucas horas antes caso o lead permaneça em silêncio.
--   3. Confirmação do agendamento que reflete no Kanban com a tag "Confirmado".
--   4. Rejeição com tentativa de remarcação ou cancelamento amigável.
--   5. Follow-up de silêncio para agendamentos sem resposta ou não comparecimento.
-- =============================================================================

-- =============================================================================
-- 1. COLUNAS EM CONSULTAS E CRM_CLINICA_DADOS
-- =============================================================================

alter table public.consultas
  add column if not exists lembrete_enviado_em timestamptz,
  add column if not exists lembrete_reforco_em timestamptz,
  add column if not exists confirmado          boolean default null,
  add column if not exists confirmado_em       timestamptz;

comment on column public.consultas.lembrete_enviado_em is
  'Instante em que o lembrete de 24 horas foi enviado via WhatsApp.';
comment on column public.consultas.lembrete_reforco_em is
  'Instante em que o aviso de reforço (horas antes) foi enviado via WhatsApp.';
comment on column public.consultas.confirmado is
  'true = presença confirmada pelo paciente; false = recusado; null = aguardando.';
comment on column public.consultas.confirmado_em is
  'Quando a confirmação de presença foi registrada.';

alter table public.crm_clinica_dados
  add column if not exists agendamento_confirmado boolean not null default false;

comment on column public.crm_clinica_dados.agendamento_confirmado is
  'Espelho rápido para o Kanban (CRM.tsx) e Realtime: indica se a próxima consulta do lead está confirmada.';


-- =============================================================================
-- 2. ATUALIZAÇÃO DA VIEW crm_clinica (com security_invoker = true)
-- =============================================================================

create or replace view public.crm_clinica with (security_invoker = true) as
  select
    id,
    nome_lead,
    whatsapp_lead,
    procedimentos_interesse,
    nullif(array_to_string(procedimentos_interesse, ', '), '') as procedimento_interesse,
    data_nascimento,
    anotacoes,
    resumo_conversa,
    inicio_atendimento,
    ultima_mensagem,
    status,
    follow_up_1,
    follow_up_2,
    follow_up_3,
    data_agendamento,
    data_marcacao_agendamento,
    id_agendamento,
    id_conta_chatwoot,
    id_conversa_chatwoot,
    id_lead_chatwoot,
    inbox_id_chatwoot,
    valor_pago_acumulado,
    created_at,
    agente_pausado,
    assumido_por,
    assumido_em,
    case
      when ultima_mensagem is null then null::integer
      else floor(extract(epoch from now() - ultima_mensagem) / 60)::integer
    end as minutos_ultima_mensagem,
    (select max(c.data_consulta) from public.consultas c
      where c.lead_id = d.id and c.status = 'realizada') as ultima_consulta,
    nao_perturbe,
    nao_perturbe_em,
    nao_perturbe_motivo,
    agendamento_confirmado
  from public.crm_clinica_dados d;

revoke all on public.crm_clinica from anon;


-- =============================================================================
-- 3. CONFIGURAÇÕES DO LEMBRETE EM configuracoes_agente
-- =============================================================================

alter table public.configuracoes_agente
  add column if not exists lembrete_ativo              boolean not null default true,
  add column if not exists lembrete_horas_antecedencia  integer not null default 24,
  add column if not exists lembrete_reforco_horas       integer not null default 4,
  add column if not exists lembrete_inicio             time    not null default '08:00',
  add column if not exists lembrete_fim                time    not null default '21:00';

comment on column public.configuracoes_agente.lembrete_ativo is
  'Chave geral dos lembretes automáticos de agendamento.';
comment on column public.configuracoes_agente.lembrete_horas_antecedencia is
  'Horas de antecedência para o 1º lembrete (padrão 24h).';
comment on column public.configuracoes_agente.lembrete_reforco_horas is
  'Horas de antecedência para o aviso de reforço se continuar em silêncio (padrão 4h).';
comment on column public.configuracoes_agente.lembrete_inicio is
  'Abertura da janela de envio de lembretes no fuso da clínica (bloqueia envios de madrugada).';
comment on column public.configuracoes_agente.lembrete_fim is
  'Fechamento da janela de envio de lembretes no fuso da clínica.';


-- =============================================================================
-- 4. REGISTRO DE LEMBRETES ENVIADOS (agente_lembretes)
-- =============================================================================

create table if not exists public.agente_lembretes (
  id          uuid        primary key default gen_random_uuid(),
  consulta_id uuid        not null references public.consultas(id) on delete cascade,
  lead_id     uuid        not null references public.crm_clinica_dados(id) on delete cascade,
  tipo        text        not null check (tipo in ('lembrete_24h', 'reforco_horas_antes')),
  enviado_em  timestamptz not null default now(),
  texto       text
);

create index if not exists agente_lembretes_consulta_tipo_idx
  on public.agente_lembretes (consulta_id, tipo, enviado_em desc);

comment on table public.agente_lembretes is
  'Histórico e travas de envio de lembretes automáticos de consultas.';

alter table public.agente_lembretes enable row level security;

drop policy if exists "agente_lembretes_le" on public.agente_lembretes;
create policy "agente_lembretes_le" on public.agente_lembretes
  for select to authenticated using (true);


-- =============================================================================
-- 5. TRIGGERS: RESET AO REMARCAR E SINCRONIZAÇÃO COM LEAD
-- =============================================================================

create or replace function public.consultas_ao_mudar_data()
returns trigger
language plpgsql
as $$
begin
  if new.data_consulta is distinct from old.data_consulta then
    new.confirmado := null;
    new.confirmado_em := null;
    new.lembrete_enviado_em := null;
    new.lembrete_reforco_em := null;
  end if;
  return new;
end;
$$;

drop trigger if exists consultas_limpa_lembrete_ao_remarcar on public.consultas;
create trigger consultas_limpa_lembrete_ao_remarcar
  before update of data_consulta on public.consultas
  for each row execute function public.consultas_ao_mudar_data();

create or replace function public.sincronizar_agendamento_lead()
returns trigger
language plpgsql
as $function$
declare
  v_proxima timestamptz;
  v_realizadas int;
  v_confirmada boolean;
begin
  if new.status = 'agendada' then
    select min(c.data_consulta) into v_proxima
      from public.consultas c
     where c.lead_id = new.lead_id and c.status = 'agendada';

    select exists (
      select 1 from public.consultas c
       where c.lead_id = new.lead_id and c.status = 'agendada' and c.confirmado is true
    ) into v_confirmada;

    update public.crm_clinica_dados d
       set data_agendamento = v_proxima,
           data_marcacao_agendamento = case
             when tg_op = 'INSERT' then now()
             else d.data_marcacao_agendamento
           end,
           agendamento_confirmado = coalesce(v_confirmada, false),
           status = case
             when d.status in ('consulta_realizada', 'paciente_recorrente') then d.status
             else 'consulta_agendada'
           end
     where d.id = new.lead_id;

  elsif new.status in ('cancelada', 'faltou', 'realizada') and tg_op = 'UPDATE' then
    if old.status = 'agendada' then
      select min(c.data_consulta) into v_proxima
        from public.consultas c
       where c.lead_id = new.lead_id and c.status = 'agendada';

      select count(*) into v_realizadas
        from public.consultas c
       where c.lead_id = new.lead_id and c.status = 'realizada';

      select exists (
        select 1 from public.consultas c
         where c.lead_id = new.lead_id and c.status = 'agendada' and c.confirmado is true
      ) into v_confirmada;

      update public.crm_clinica_dados d
         set data_agendamento = v_proxima,
             agendamento_confirmado = coalesce(v_confirmada, false),
             status = case
               when new.status = 'realizada' and v_realizadas >= 2 then 'paciente_recorrente'
               when new.status = 'realizada' then 'consulta_realizada'
               when d.status in ('consulta_realizada', 'paciente_recorrente') then d.status
               when v_proxima is not null then d.status
               else 'consulta_cancelada'
             end
       where d.id = new.lead_id;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists consultas_sincroniza_lead on public.consultas;
create trigger consultas_sincroniza_lead
  after insert or update of data_consulta, status, confirmado on public.consultas
  for each row execute function public.sincronizar_agendamento_lead();


-- =============================================================================
-- 6. FUNÇÃO SQL: lembretes_pendentes()
-- =============================================================================

create or replace function public.lembretes_pendentes()
returns table (
  consulta_id    uuid,
  lead_id        uuid,
  whatsapp       text,
  nome           text,
  procedimento   text,
  data_consulta  timestamptz,
  profissional   text,
  tipo           text
)
language sql
stable
set search_path to 'public'
as $$
  with cfg as (
    select * from public.configuracoes_agente limit 1
  ),
  clinica as (
    select coalesce(nullif(fuso_horario, ''), 'America/Sao_Paulo') as tz
    from public.configuracoes_clinica limit 1
  ),
  candidatos as (
    select
      c.id                                                        as consulta_id,
      l.id                                                        as lead_id,
      l.whatsapp_lead                                             as whatsapp,
      coalesce(l.nome_lead, 'cliente')                            as nome,
      c.procedimento,
      c.data_consulta,
      coalesce(trim(p.nome || ' ' || coalesce(p.sobrenome, '')), 'nosso especialista') as profissional,
      c.lembrete_enviado_em,
      c.lembrete_reforco_em,
      c.confirmado
    from public.consultas c
    join public.crm_clinica_dados l on l.id = c.lead_id
    left join public.profissionais p on p.id = c.profissional_id
    cross join cfg
    cross join clinica
    where cfg.ativo
      and cfg.lembrete_ativo
      and c.status = 'agendada'
      and c.confirmado is distinct from true
      and c.data_consulta > now()
      and l.whatsapp_lead is not null
      and not l.agente_pausado
      and l.assumido_por is null
      and not l.nao_perturbe
      and public.agente_deve_responder(l.whatsapp_lead)
      and ((now() at time zone clinica.tz)::time
           between cfg.lembrete_inicio and cfg.lembrete_fim)
  )
  -- 1) Lembrete de 24h
  select
    c.consulta_id,
    c.lead_id,
    c.whatsapp,
    c.nome,
    c.procedimento,
    c.data_consulta,
    c.profissional,
    'lembrete_24h'::text as tipo
  from candidatos c
  cross join cfg
  where c.data_consulta <= now() + make_interval(hours => cfg.lembrete_horas_antecedencia)
    and c.data_consulta > now() + make_interval(hours => cfg.lembrete_reforco_horas)
    and c.lembrete_enviado_em is null
    and not exists (
      select 1 from public.agente_lembretes al
      where al.consulta_id = c.consulta_id and al.tipo = 'lembrete_24h'
    )

  union all

  -- 2) Reforço horas antes (para quem não confirmou e já recebeu o 1º lembrete)
  select
    c.consulta_id,
    c.lead_id,
    c.whatsapp,
    c.nome,
    c.procedimento,
    c.data_consulta,
    c.profissional,
    'reforco_horas_antes'::text as tipo
  from candidatos c
  cross join cfg
  where c.data_consulta <= now() + make_interval(hours => cfg.lembrete_reforco_horas)
    and c.data_consulta > now()
    and c.lembrete_enviado_em is not null
    and c.lembrete_reforco_em is null
    and not exists (
      select 1 from public.agente_lembretes al
      where al.consulta_id = c.consulta_id and al.tipo = 'reforco_horas_antes'
    )
$$;

comment on function public.lembretes_pendentes() is
  'Lista agendamentos que precisam receber lembrete de 24h ou aviso de reforço.';


-- =============================================================================
-- 7. FUNÇÃO SQL: disparar_lembretes()
-- =============================================================================

create or replace function public.disparar_lembretes()
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_url     text;
  v_segredo text;
  v_pedido  bigint;
begin
  if not exists (select 1 from public.lembretes_pendentes()) then
    return null;
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'lembrete_url';

  if v_url is null then
    select regexp_replace(decrypted_secret, '/follow-up$', '/lembrete') into v_url
    from vault.decrypted_secrets where name = 'followup_url';
  end if;

  select decrypted_secret into v_segredo
  from vault.decrypted_secrets where name = 'followup_segredo';

  if v_url is null or v_segredo is null then
    raise warning 'lembretes: falta endereco ou segredo no Vault.';
    return null;
  end if;

  select net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type',      'application/json',
                 'x-webhook-segredo', v_segredo
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 8000
  ) into v_pedido;

  return v_pedido;
end;
$$;

comment on function public.disparar_lembretes() is
  'Dispara lembretes de agendamento se houver fila em lembretes_pendentes().';

revoke execute on function public.lembretes_pendentes() from public, anon, authenticated;
revoke execute on function public.disparar_lembretes()  from public, anon, authenticated;

grant execute on function public.lembretes_pendentes() to service_role;
grant execute on function public.disparar_lembretes()  to service_role;
