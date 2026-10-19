-- =============================================================================
-- KIT ESCRITÓRIO DE ADVOCACIA — os serviços
-- =============================================================================
--
-- Catálogo para um escritório de advocacia que atende com hora marcada: uma
-- consulta inicial (porta de entrada gratuita ou cobrada) e as áreas do
-- direito que o escritório trabalha.
--
-- ⚠️ NÃO É UMA MIGRAÇÃO. A instalação do Núcleo nasce sem serviço nenhum
-- (migração 0025). Este arquivo roda UMA vez, no SQL Editor do Supabase,
-- depois das migrações — e só quando a empresa é um escritório de advocacia.
--
-- O QUE ELE CADASTRA
--
--   • "Consulta Inicial" como a porta de entrada: sem custo, 60 minutos.
--     Só pode existir uma porta; se o escritório já tiver outra, esta linha é
--     pulada, e as áreas passam a apontar para a que já existe.
--   • 12 áreas do direito que passam pela consulta inicial.
--
-- Rodar de novo não duplica: serviço com o mesmo nome é pulado.
--
-- ⚠️ OS TEXTOS SÃO RASCUNHO e precisam da revisão de um advogado do
-- escritório antes de irem para a boca da atendente — prazos, possibilidades
-- e condutas variam por caso e por área. Sem promessa de resultado: a
-- atendente nunca antecipa o que o advogado pode oferecer.
--
-- Depois de rodar, abra a página Serviços: confira os textos, preencha os
-- valores que o escritório aceita falar e desative o que ele não atende.
-- =============================================================================

insert into public.servicos_clinica
  (nome, descricao, descricao_longa, ativo, e_avaliacao, exige_avaliacao,
   preco_a_partir_de, duracao_minutos, created_at)
select v.nome, v.descricao, v.descricao_longa, true, v.e_avaliacao, v.exige_avaliacao,
       v.preco, v.duracao,
       -- Deslocamento crescente: a página Serviços ordena por `created_at`, e
       -- vários `now()` iguais deixariam a ordem por conta do acaso.
       now() + (v.ordem * interval '1 millisecond')
from (values
  ( 1, 'Consulta Inicial',
       'Primeira conversa com o advogado: você conta o seu caso e ele explica o que pode ser feito',
       'É a primeira reunião com o advogado. Você conta o que está acontecendo, o advogado faz as perguntas necessárias para entender bem o caso e explica, com clareza, quais são as opções e o caminho mais indicado para a sua situação. Dura em torno de uma hora. Não é preciso trazer documentos nesse primeiro momento, mas se tiver algo relacionado ao caso pode trazer. Ao final você já sai sabendo o que está diante de você e o que pode ser feito.',
       true, false, 0, 60),
  ( 2, 'Direito do Trabalho',
       'Questões entre trabalhador e empregador: demissão, verbas, assédio, horas extras, acidente',
       'Cobre as relações entre trabalhador e empresa: rescisão indevida, verbas não pagas, hora extra, adicional, assédio moral ou sexual, acidente de trabalho, doença ocupacional, reconhecimento de vínculo. O advogado analisa o caso, orienta sobre os direitos e, se houver fundamento, ajuíza a ação ou conduz a negociação com o empregador. O caminho — acordo ou ação — e os prazos são definidos na consulta, conforme os documentos do caso.',
       false, true, null, 60),
  ( 3, 'Direito de Família',
       'Divórcio, guarda, pensão alimentícia, inventário, adoção e demais questões familiares',
       'Abrange divórcio (consensual ou litigioso), guarda e convivência dos filhos, pensão alimentícia, partilha de bens, inventário e herança, adoção e reconhecimento de paternidade. O advogado orienta sobre cada fase, busca o caminho mais rápido quando há acordo entre as partes e representa nos casos em que é preciso litigar. Documentação, prazos e honorários são definidos na consulta inicial conforme o que está sendo pedido.',
       false, true, null, 60),
  ( 4, 'Direito do Consumidor',
       'Problemas com produto, serviço, banco, plano de saúde, construtora ou qualquer fornecedor',
       'Cobre conflitos entre pessoa e empresa: produto com defeito, serviço não prestado, cobrança indevida, negativação injusta, problema com banco, seguro, plano de saúde ou construtora. O advogado analisa o que aconteceu, orienta sobre os direitos e, se houver base, entra com a ação no Juizado Especial ou na Justiça Comum, conforme o valor e a complexidade. Muitos casos se resolvem sem precisar ir a julgamento.',
       false, true, null, 60),
  ( 5, 'Direito Previdenciário',
       'Aposentadoria, benefício por incapacidade, pensão por morte e demais questões com o INSS',
       'Trata de pedidos negados ou não concedidos pelo INSS: aposentadoria por tempo de contribuição, aposentadoria por invalidez, auxílio por incapacidade, pensão por morte, BPC/LOAS e outros benefícios. O advogado analisa o histórico contributivo, reúne a documentação necessária e representa na esfera administrativa ou judicial. Em muitos casos é possível reaver benefícios retroativos desde a data do pedido negado.',
       false, true, null, 60),
  ( 6, 'Direito Imobiliário',
       'Compra e venda, locação, distrato, usucapião, condomínio e regularização de imóveis',
       'Abrange contratos de compra e venda, problemas com construtora ou incorporadora, distrato, locação residencial e comercial, despejo, usucapião, regularização de imóvel, partilha de bem imóvel em inventário e questões condominiais. O advogado analisa o contrato ou a situação e orienta o caminho mais seguro, seja para negociar, regularizar ou litigar.',
       false, true, null, 60),
  ( 7, 'Direito Criminal',
       'Defesa em inquéritos e processos criminais, e orientação para quem foi vítima de crime',
       'Atende tanto quem está sendo investigado ou processado quanto quem sofreu um crime. Para o investigado ou réu: acompanhamento em inquérito policial, defesa criminal, recursos e execução penal. Para a vítima: orientação sobre boletim de ocorrência, representação, medidas protetivas (em casos de violência) e acompanhamento no processo. O advogado avalia a situação na consulta e explica os próximos passos.',
       false, true, null, 60),
  ( 8, 'Direito Civil',
       'Cobranças, contratos, indenizações, danos morais e outros conflitos entre particulares',
       'Cobre conflitos entre pessoas físicas ou empresas fora das áreas específicas: cobrança de dívida, inadimplemento de contrato, indenização por danos materiais ou morais, responsabilidade civil, posse e propriedade. O advogado analisa o caso, orienta sobre a viabilidade e, se houver base, representa na negociação ou na Justiça. Casos de menor valor tramitam no Juizado Especial, sem necessidade de advogado — mas com representação fica mais seguro.',
       false, true, null, 60),
  ( 9, 'Direito Empresarial',
       'Contratos, sociedades, recuperação de crédito e questões jurídicas de empresas',
       'Atende empresas de todos os portes: elaboração e revisão de contratos, constituição e dissolução de sociedade, exclusão de sócio, recuperação de crédito, propriedade intelectual, questões trabalhistas da empresa e assessoria jurídica preventiva. O advogado orienta sobre o que pode ser resolvido extrajudicialmente e representa nos casos que chegam a processo.',
       false, true, null, 60),
  (10, 'Inventário e Herança',
       'Partilha dos bens após o falecimento: inventário judicial ou extrajudicial, testamento',
       'Cuida de todo o processo de partilha: levantamento dos bens, abertura do inventário (em cartório quando todos os herdeiros são maiores e há acordo, ou na Justiça nos demais casos), cumprimento de testamento e transferência dos bens para os herdeiros. O advogado orienta sobre o caminho mais rápido e econômico conforme a situação da família e o que foi deixado.',
       false, true, null, 60),
  (11, 'Planejamento Patrimonial',
       'Proteção e organização do patrimônio familiar: holding, doação em vida, testamento',
       'Organiza o patrimônio pensando na continuidade da família e na redução de conflitos futuros: criação de holding familiar, doação em vida com reserva de usufruto, testamento, blindagem patrimonial e estruturação societária. O objetivo é proteger o que foi construído e facilitar a transmissão para os herdeiros, com menos custo e menos burocracia do que o inventário comum. O advogado explica as opções na consulta e monta a estratégia conforme o patrimônio.',
       false, true, null, 60),
  (12, 'Revisão e Elaboração de Contratos',
       'Contratos de qualquer tipo: revisão antes de assinar, elaboração do zero ou renegociação',
       'Analisa ou redige contratos para pessoas físicas e empresas: locação, compra e venda, prestação de serviço, parceria, trabalho e outros. O advogado verifica cláusulas abusivas, omissões que podem gerar problema futuro e pontos de risco antes de assinar — ou redige o contrato do zero com as condições que protegem o cliente. É mais barato e rápido resolver antes do problema do que depois.',
       false, true, null, 60)
) as v(ordem, nome, descricao, descricao_longa, e_avaliacao, exige_avaliacao, preco, duracao)
where not exists (
  select 1 from public.servicos_clinica s where s.nome = v.nome
);

-- Garante que os serviços que exigem avaliação apontem para a
-- "Consulta Inicial" cadastrada acima (ou para outra porta de entrada já existente).
update public.servicos_clinica dest
set exige_avaliacao = true
where dest.nome in (
  'Direito do Trabalho',
  'Direito de Família',
  'Direito do Consumidor',
  'Direito Previdenciário',
  'Direito Imobiliário',
  'Direito Criminal',
  'Direito Civil',
  'Direito Empresarial',
  'Inventário e Herança',
  'Planejamento Patrimonial',
  'Revisão e Elaboração de Contratos'
);
