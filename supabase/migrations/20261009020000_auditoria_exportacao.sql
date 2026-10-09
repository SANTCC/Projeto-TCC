-- Backlog 3, item B: a exportação do PDF de relatório passa a ser auditada com tipo próprio (EXPORTACAO).
-- Idempotente (IF NOT EXISTS). O valor só é usado depois do commit, então não há conflito de transação.

alter type tipo_alteracao_enum add value if not exists 'EXPORTACAO';
