"""
Módulo de Autenticação e Controle de Acesso (RBAC) - NexusPort
Replica em Python 1:1 as regras de autorização de js/auth-guard.js
"""

PERMISSOES_CARGO = {
    'ESTIVADOR': [
        'VISUALIZAR_PAINEL', 'MOVIMENTAR_CARGA', 'REGISTRAR_OPERACAO'
    ],
    'CONFERENTE_CARGA': [
        'VISUALIZAR_PAINEL', 'REGISTRAR_RECEBIMENTO', 'CONFERIR_CARGA', 'REGISTRAR_OPERACAO'
    ],
    'ARRUMADOR_CONSERTADOR': [
        'VISUALIZAR_PAINEL', 'ALTERAR_PRONTA_ENTREGA', 'REGISTRAR_MANUTENCAO_CONTAINER'
    ],
    'PLANEJADOR_PATIO_NAVIOS': [
        'VISUALIZAR_PAINEL', 'GERENCIAR_PATIO', 'PLANEJAR_BERCOS', 'ATUALIZAR_DADOS_NAVIO_CONTAINER'
    ],
    'TECNICO_PORTOS': [
        'VISUALIZAR_PAINEL', 'CADASTRAR_FUNCIONARIO', 'GERENCIAR_OPERADORES',
        'CADASTRAR_VISITANTE', 'REGISTRAR_LIBERACAO_ENTRADA', 'EXIBIR_DADOS_SENSIVEIS_PESSOAS'
    ],
    'SUPERVISOR_GERENTE_OPERACOES': [
        'VISUALIZAR_PAINEL', 'VISAO_OPERACIONAL_AMPLA', 'APROVAR_MANUTENCAO',
        'SOLICITAR_MANUTENCAO', 'DESIGNAR_SUBSTITUTO', 'VER_TRILHA_DECISOES',
        'CADASTRAR_ROTA', 'LIBERAR_CARGA', 'CANCELAR_ENTREGA', 'LIBERAR_NAVIO'
    ],
    'INSPETOR': [
        'VISUALIZAR_PAINEL', 'INSPECIONAR_CARGA', 'CADASTRAR_NAVIO', 'CADASTRAR_CONTAINER',
        'CADASTRAR_GUINDASTE', 'SOLICITAR_MANUTENCAO', 'REGISTRAR_AVARIA'
    ],
    'DIRETOR_OPERACOES_LOGISTICA': [
        'VISUALIZAR_PAINEL', 'VISAO_ESTRATEGICA_GLOBAL', 'APROVAR_RELATORIO',
        'APROVAR_REFORMA', 'EXPORTAR_HISTORICO', 'VER_TRILHA_DECISOES',
        'APROVAR_MANUTENCAO', 'LIBERAR_NAVIO', 'LIBERAR_CARGA', 'CANCELAR_ENTREGA',
        'CADASTRAR_NAVIO', 'CADASTRAR_CONTAINER', 'CADASTRAR_GUINDASTE',
        'CADASTRAR_ROTA', 'DESIGNAR_SUBSTITUTO'
    ],
    'DIRETOR_PRESIDENTE_SUPERINTENDENTE': [
        'VISUALIZAR_PAINEL', 'VISAO_ESTRATEGICA_GLOBAL', 'APROVAR_RELATORIO',
        'APROVAR_REFORMA', 'EXPORTAR_HISTORICO', 'VER_TRILHA_DECISOES',
        'APROVAR_MANUTENCAO', 'LIBERAR_NAVIO', 'LIBERAR_CARGA', 'CANCELAR_ENTREGA',
        'CADASTRAR_NAVIO', 'CADASTRAR_CONTAINER', 'CADASTRAR_GUINDASTE',
        'CADASTRAR_ROTA', 'DESIGNAR_SUBSTITUTO'
    ],
    'CONSELHO_ADMINISTRACAO': [
        'VISUALIZAR_PAINEL', 'VISAO_ESTRATEGICA_GLOBAL', 'APROVAR_RELATORIO',
        'APROVAR_REFORMA', 'EXPORTAR_HISTORICO', 'VER_TRILHA_DECISOES',
        'APROVAR_MANUTENCAO', 'LIBERAR_NAVIO', 'LIBERAR_CARGA', 'CANCELAR_ENTREGA',
        'CADASTRAR_NAVIO', 'CADASTRAR_CONTAINER', 'CADASTRAR_GUINDASTE',
        'CADASTRAR_ROTA', 'DESIGNAR_SUBSTITUTO'
    ]
}

NIVEIS_CARGO = {
    'ESTIVADOR': 'OPERACIONAL',
    'CONFERENTE_CARGA': 'OPERACIONAL',
    'ARRUMADOR_CONSERTADOR': 'OPERACIONAL',
    'PLANEJADOR_PATIO_NAVIOS': 'OPERACIONAL',
    'TECNICO_PORTOS': 'OPERACIONAL',
    'SUPERVISOR_GERENTE_OPERACOES': 'TATICO',
    'INSPETOR': 'GESTAO',
    'DIRETOR_OPERACOES_LOGISTICA': 'ESTRATEGICO',
    'DIRETOR_PRESIDENTE_SUPERINTENDENTE': 'ESTRATEGICO',
    'CONSELHO_ADMINISTRACAO': 'ESTRATEGICO'
}

CAMADAS_VISAO = {
    'OPERACIONAL': 'Visão Própria',
    'GESTAO': 'Visão Operacional',
    'TATICO': 'Visão Operacional',
    'ESTRATEGICO': 'Visão Estratégica'
}

class NexusAuth:
    def __init__(self, client):
        self.client = client
        self.session = None

    def login(self, identificador, cargo_hint=None):
        """
        Autentica o funcionário por matrícula ou código individual (ex: '888001' ou 'SUP-2001').
        Retorna o dicionário de sessão.
        """
        ident = str(identificador).strip()

        # Consulta no banco de dados
        funcionarios = self.client.request("GET", "funcionarios", params={
            "select": "*"
        }) or []

        func = None
        for f in funcionarios:
            if str(f.get("matricula", "")).strip() == ident or str(f.get("codigo_individual", "")).strip() == ident:
                func = f
                break

        if not func:
            cargo = cargo_hint
            if not cargo:
                if "EST" in ident.upper() or ident == "888002":
                    cargo = "ESTIVADOR"
                elif "INSP" in ident.upper():
                    cargo = "INSPETOR"
                elif "TEC" in ident.upper():
                    cargo = "TECNICO_PORTOS"
                elif "DIR" in ident.upper():
                    cargo = "DIRETOR_OPERACOES_LOGISTICA"
                else:
                    cargo = "SUPERVISOR_GERENTE_OPERACOES"

            # Sessão de fallback (funcionário não encontrado no banco): sem id de banco.
            # Não usar um id textual aqui: ele iria para colunas uuid (funcionario_id,
            # inspetor_id, solicitado_por...) e geraria erro 22P02 no Supabase.
            func = {
                "id": None,
                "matricula": ident,
                "codigo_individual": ident if "-" in ident else f"COD-{ident}",
                "nome": "Operador NexusPort",
                "cargo": cargo,
                "ativo": True
            }

        cargo = func.get("cargo", "ESTIVADOR")
        nivel = NIVEIS_CARGO.get(cargo, "OPERACIONAL")
        camada = CAMADAS_VISAO.get(nivel, "Visão Própria")

        self.session = {
            "id": func.get("id"),
            "matricula": func.get("matricula"),
            "codigo_individual": func.get("codigo_individual"),
            "nome": func.get("nome"),
            "cargo": cargo,
            "nivel": nivel,
            "camada_visao": camada,
            "permissoes": PERMISSOES_CARGO.get(cargo, [])
        }
        self.client.session = self.session
        return self.session

    def logout(self):
        self.session = None
        self.client.session = None

    def has_permission(self, permissao):
        if not self.session:
            return False
        return permissao in self.session.get("permissoes", [])

    def get_session(self):
        return self.session
