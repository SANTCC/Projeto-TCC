"""
Utilitários de UUID para a Suíte Python NexusPort (tools/nexus_api/uuid_utils.py)

As chaves primárias e estrangeiras das tabelas operacionais (funcionarios, navios,
cargas, manutencoes, ...) são do tipo `uuid` no PostgreSQL. Qualquer valor que não
seja um UUID válido (ex.: "func-default-id", "navio-uuid-1", None -> "None") gera o
erro 22P02 ("invalid input syntax for type uuid") no Supabase.
"""

import uuid


def is_valid_uuid(value):
    """Retorna True somente para UUIDs válidos (str ou uuid.UUID)."""
    if value is None or value == "":
        return False
    try:
        uuid.UUID(str(value))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def uuid_or_none(value):
    """Devolve o valor como string se for UUID válido; caso contrário, None."""
    return str(value) if is_valid_uuid(value) else None
