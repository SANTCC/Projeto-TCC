-- Backlog 3, item B: bucket privado para o cache dos PDFs de relatório gerados no servidor.
-- Chave do arquivo = SHA-256 do modelo do relatório (<hash>.pdf), então o mesmo conteúdo reaproveita o arquivo.
-- Bucket privado e sem políticas em storage.objects: só a Edge Function relatorio-pdf (service role) lê e grava.
-- Idempotente: pode ser reaplicada.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('relatorios-pdf', 'relatorios-pdf', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false,
      allowed_mime_types = array['application/pdf'];
