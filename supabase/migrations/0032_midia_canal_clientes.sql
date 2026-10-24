-- =============================================================================
-- 0032 — MÍDIA NO CANAL DE ATENDIMENTO AO CLIENTE
--
-- Até a 0031, `mensagens_clientes` guardava só o texto: foto, áudio, vídeo e PDF
-- chegavam como um rótulo ("Áudio", "Documento") e o arquivo nunca era baixado.
-- Isto acrescenta onde o arquivo mora.
--
-- ── O QUE ESTE ARQUIVO FAZ ──────────────────────────────────────────────────
--
--   Três colunas em `mensagens_clientes`, todas opcionais:
--
--     midia_url   o caminho no bucket PRIVADO `midias-whatsapp`
--                 (clientes/{cliente_id}/{mensagem_id}.{ext}); a tela abre com
--                 URL assinada, como na tela da IA
--     midia_nome  o nome original do arquivo — o que a equipe lê num PDF
--     midia_mime  o tipo MIME que o servidor entregou
--
-- ── O QUE NÃO PRECISA MUDAR ────────────────────────────────────────────────
--
--   • O bucket e as políticas dele (0010): leitura e gravação para a equipe
--     logada já existem.
--   • A publicação Realtime (0031): a tabela já é publicada, e o UPDATE que
--     grava o `midia_url` depois do download chega na tela sozinho.
--   • A view `clientes_chat_lista`: ela só olha a última mensagem (tipo e
--     texto), e isso não mudou.
--
-- Idempotente: `if not exists`, pode rodar de novo sem estrago.
-- =============================================================================

alter table public.mensagens_clientes
  add column if not exists midia_url  text,
  add column if not exists midia_nome text,
  add column if not exists midia_mime text;

comment on column public.mensagens_clientes.midia_url is
  'Caminho do arquivo no bucket privado midias-whatsapp (clientes/{cliente_id}/...). '
  'Nulo quando a mensagem é só texto, ou quando o download falhou.';

comment on column public.mensagens_clientes.midia_nome is
  'Nome original do arquivo, como o contato enviou. Só documentos costumam ter.';

comment on column public.mensagens_clientes.midia_mime is
  'Tipo MIME do arquivo guardado, como a ponte entregou.';


-- =============================================================================
-- CONFERÊNCIA
-- =============================================================================

-- As três colunas existem?
--   select column_name from information_schema.columns
--    where table_name = 'mensagens_clientes' and column_name like 'midia_%'
--    order by column_name;
--   (esperado: midia_mime, midia_nome, midia_url)

-- Depois de receber um arquivo de verdade:
--   select tipo, midia_url, midia_nome from public.mensagens_clientes
--    where midia_url is not null order by criada_em desc limit 5;
