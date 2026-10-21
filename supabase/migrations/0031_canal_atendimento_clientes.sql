-- =============================================================================
-- 0031 — CANAL DE ATENDIMENTO AO CLIENTE (2º número de WhatsApp)
--
-- O sistema hoje tem um único canal de WhatsApp: o número da IA (Atendente IA),
-- usado para leads vindos de anúncios da Meta. Este arquivo cria um segundo
-- canal independente — "Atendimento ao Cliente" — para o público que já é
-- cliente e entra em contato pelo 2º número.
--
-- ── POR QUE TABELAS SEPARADAS, E NÃO UMA COLUNA "CANAL" ────────────────────
--
-- Os dois públicos têm jornadas completamente diferentes:
--   • Canal IA   → leads de anúncio, têm funil (status), agendamentos, a IA
--                  atende e anota tudo em crm_clinica_dados / mensagens_whatsapp.
--   • Canal Clientes → clientes existentes, sem funil, sem IA, só troca de
--                      mensagens com o atendente humano.
--
-- Adicionar uma coluna "canal" em crm_clinica_dados criaria conflito de UNIQUE
-- no whatsapp (o mesmo número pode existir nos dois públicos) e misturaria o
-- realtime das duas caixas de entrada. Tabelas separadas eliminam esses riscos.
--
-- ── O QUE ESTE ARQUIVO CRIA ─────────────────────────────────────────────────
--
--   1. `clientes_chat`              — cadastro de contatos do 2º número
--   2. `mensagens_clientes`         — mensagens desse canal
--   3. `clientes_chat_lista`        — view análoga a `conversas_lista`
--   4. Campos em `configuracoes_agente` para configurar o 2º número
--
-- Documentação: ver CLAUDE.md e DATABASE.md
-- =============================================================================


-- =============================================================================
-- 1. CADASTRO DE CONTATOS DO CANAL DE CLIENTES
-- =============================================================================

create table public.clientes_chat (
  id             uuid        primary key default gen_random_uuid(),
  nome           text,
  whatsapp       text        not null unique,
  assumido_por   uuid        references public.usuarios(id) on delete set null,
  assumido_em    timestamptz,
  criado_em      timestamptz not null default now(),
  ultimo_contato timestamptz
);

comment on table public.clientes_chat is
  'Contatos do canal de atendimento ao cliente (2º número de WhatsApp). '
  'Separado de crm_clinica_dados porque o público é diferente — clientes '
  'existentes, não leads de anúncio — e o mesmo número pode estar nos dois.';

comment on column public.clientes_chat.assumido_por is
  'Atendente que está gerenciando este contato no momento.';

create index clientes_chat_whatsapp_idx on public.clientes_chat (whatsapp);
create index clientes_chat_assumido_por_idx on public.clientes_chat (assumido_por);

alter table public.clientes_chat enable row level security;

create policy "autenticado lê e escreve clientes_chat"
  on public.clientes_chat
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.clientes_chat to authenticated, service_role;


-- =============================================================================
-- 2. MENSAGENS DO CANAL DE CLIENTES
-- =============================================================================

create table public.mensagens_clientes (
  id          uuid        primary key default gen_random_uuid(),
  cliente_id  uuid        not null references public.clientes_chat(id) on delete cascade,
  autor       text        not null check (autor in ('cliente', 'atendente')),
  tipo        text        not null default 'texto'
                check (tipo in ('texto', 'audio', 'imagem', 'video', 'documento', 'outro')),
  conteudo    text,
  id_externo  text        unique,  -- id da mensagem na Evolution/uazapi (evita duplicata)
  lida        boolean     not null default false,
  enviada_por uuid        references public.usuarios(id) on delete set null,
  criada_em   timestamptz not null default now()
);

comment on table public.mensagens_clientes is
  'Mensagens do canal de atendimento ao cliente (2º número). '
  'Análoga a mensagens_whatsapp, mas sem IA: só troca humano ↔ cliente.';

comment on column public.mensagens_clientes.autor is
  'Quem escreveu. "cliente" = veio do WhatsApp; "atendente" = enviado pelo painel.';

comment on column public.mensagens_clientes.id_externo is
  'ID da mensagem na Evolution ou uazapi. Constraint UNIQUE evita duplicata '
  'quando a ponte reenvia o webhook.';

create index mensagens_clientes_cliente_em_idx
  on public.mensagens_clientes (cliente_id, criada_em desc);

create index mensagens_clientes_nao_lidas_idx
  on public.mensagens_clientes (cliente_id, autor, lida)
  where not lida and autor = 'cliente';

alter table public.mensagens_clientes enable row level security;

create policy "autenticado lê e escreve mensagens_clientes"
  on public.mensagens_clientes
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.mensagens_clientes to authenticated, service_role;


-- =============================================================================
-- 3. VIEW DE LISTA — análoga a conversas_lista
-- =============================================================================

create view public.clientes_chat_lista
with (security_invoker = true)
as
  select
    c.id                          as cliente_id,
    c.nome,
    c.whatsapp,
    c.assumido_por,
    c.assumido_em,
    u.nome                        as assumido_por_nome,
    ultima.conteudo               as ultimo_conteudo,
    ultima.tipo                   as ultimo_tipo,
    ultima.autor                  as ultimo_autor,
    ultima.criada_em              as ultima_em,
    coalesce(pendentes.total, 0)  as nao_lidas
  from public.clientes_chat c

  -- Só exibe contatos que já trocaram mensagem.
  join lateral (
    select m.conteudo, m.tipo, m.autor, m.criada_em
      from public.mensagens_clientes m
     where m.cliente_id = c.id
     order by m.criada_em desc
     limit 1
  ) ultima on true

  left join lateral (
    select count(*) as total
      from public.mensagens_clientes m
     where m.cliente_id = c.id
       and m.autor = 'cliente'
       and not m.lida
  ) pendentes on true

  left join public.usuarios u on u.id = c.assumido_por;

comment on view public.clientes_chat_lista is
  'Uma linha por contato do canal de clientes, com a última mensagem, '
  'o número de não lidas e quem assumiu. Calculada na leitura. '
  'Ordene na consulta: order=ultima_em.desc. '
  'Análoga a conversas_lista — ⚠️ REALTIME assina a TABELA, nunca esta view.';

grant select on public.clientes_chat_lista to authenticated, service_role;


-- =============================================================================
-- 4. CONFIGURAÇÃO DO 2º NÚMERO EM configuracoes_agente
-- =============================================================================

alter table public.configuracoes_agente
  add column if not exists clientes_chat_ativo        boolean default false,
  add column if not exists clientes_provedor          text
    check (clientes_provedor in ('evolution', 'uazapi')),
  add column if not exists clientes_instancia         text,
  add column if not exists clientes_webhook_segredo   text,
  add column if not exists clientes_boas_vindas_ativo boolean default false,
  add column if not exists clientes_boas_vindas_texto text;

comment on column public.configuracoes_agente.clientes_chat_ativo is
  'Liga ou desliga o canal de atendimento ao cliente (2º número).';
comment on column public.configuracoes_agente.clientes_provedor is
  'Qual ponte usa o 2º número: evolution ou uazapi.';
comment on column public.configuracoes_agente.clientes_instancia is
  'Nome da instância do 2º número na Evolution/uazapi '
  '(ex: EVOLUTION_INSTANCIA_CLIENTES na secret).';
comment on column public.configuracoes_agente.clientes_webhook_segredo is
  'Segredo do webhook do 2º número. Gerado e gravado pelo sistema.';
comment on column public.configuracoes_agente.clientes_boas_vindas_ativo is
  'Se true, envia clientes_boas_vindas_texto ao receber a 1ª mensagem de um contato.';
comment on column public.configuracoes_agente.clientes_boas_vindas_texto is
  'Texto da mensagem automática de boas-vindas para o canal de clientes.';


-- =============================================================================
-- 5. PUBLICAÇÃO REALTIME
-- =============================================================================

alter publication supabase_realtime add table public.mensagens_clientes, public.clientes_chat;


-- =============================================================================
-- CONFERÊNCIA
-- =============================================================================

-- Tabelas criadas:
--   select table_name from information_schema.tables
--    where table_schema = 'public'
--      and table_name in ('clientes_chat', 'mensagens_clientes');

-- View criada e com security_invoker:
--   select relname, reloptions from pg_class
--    where relname = 'clientes_chat_lista';

-- Colunas novas em configuracoes_agente:
--   select column_name from information_schema.columns
--    where table_name = 'configuracoes_agente'
--      and column_name like 'clientes_%'
--    order by ordinal_position;

-- Publicação Realtime:
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime'
--      and tablename in ('mensagens_clientes', 'clientes_chat');
