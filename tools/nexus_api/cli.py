"""
CLI Runner para a Suíte Python NexusPort (tools/nexus_api/cli.py)
"""

import sys
import json
import argparse
from . import NexusPortApp

def build_parser():
    parser = argparse.ArgumentParser(description="NexusPort Python API & CLI Suite (Terminal STS-01 Santos)")
    subparsers = parser.add_subparsers(dest="command", help="Comandos operacionais")

    # login
    p_login = subparsers.add_parser("login", help="Autentica um operador")
    p_login.add_argument("identificador", help="Matrícula ou Código Individual (ex: '888001' ou 'SUP-2001')")

    # cargas
    p_cargas = subparsers.add_parser("cargas", help="Operações de Cargas")
    p_cargas.add_argument("--action", choices=["list", "get", "schedule", "receive", "move", "ready", "release", "cancel"], default="list")
    p_cargas.add_argument("--id", help="ID ou QR Code da carga")
    p_cargas.add_argument("--tipo", help="Tipo/Natureza da carga")
    p_cargas.add_argument("--peso", help="Peso (t)")
    p_cargas.add_argument("--volume", help="Volume (m³)")
    p_cargas.add_argument("--motivo", help="Motivo (para cancelamento ou liberação)")

    # navios
    p_navios = subparsers.add_parser("navios", help="Operações de Navios")
    p_navios.add_argument("--action", choices=["list", "get", "save", "release", "return", "delete"], default="list")
    p_navios.add_argument("--id", help="ID, IMO ou Nome do navio")
    p_navios.add_argument("--nome", help="Nome do navio")
    p_navios.add_argument("--imo", help="Número IMO")

    # bercos
    p_bercos = subparsers.add_parser("bercos", help="Operações de Berços Operacionais")
    p_bercos.add_argument("--action", choices=["list", "save", "link"], default="list")
    p_bercos.add_argument("--nome", help="Nome do berço (ex: Berço 01)")
    p_bercos.add_argument("--navio", help="Nome do navio a vincular")

    # inspecoes
    p_insp = subparsers.add_parser("inspecoes", help="Operações de Inspeção Técnica")
    p_insp.add_argument("--action", choices=["list", "inspect", "reject"], default="list")
    p_insp.add_argument("--carga_id", help="ID ou QR Code da carga")
    p_insp.add_argument("--resultado", choices=["APROVADA", "RECUSADA"], default="APROVADA")
    p_insp.add_argument("--observacoes", help="Observações / Motivo")

    # manutencao
    p_manut = subparsers.add_parser("manutencao", help="Operações de Manutenção & OS")
    p_manut.add_argument("--action", choices=["list", "request", "approve", "reject", "complete", "preventive"], default="list")
    p_manut.add_argument("--os_id", help="ID da Ordem de Serviço")
    p_manut.add_argument("--entidade_tipo", choices=["NAVIO", "CONTAINER", "GUINDASTE"], default="NAVIO")
    p_manut.add_argument("--entidade_id", help="ID da entidade")
    p_manut.add_argument("--descricao", help="Descrição do serviço")

    # emergencia
    p_panic = subparsers.add_parser("emergencia", help="Botão de Pânico Global e Emergências")
    p_panic.add_argument("--action", choices=["status", "trigger", "resolve"], default="status")
    p_panic.add_argument("--motivo", help="Motivo do disparo")
    p_panic.add_argument("--id", help="ID da emergência a resolver")

    # indicadores
    p_kpis = subparsers.add_parser("indicadores", help="Indicadores e KPIs Operacionais Consolidados")

    return parser

def main(args=None):
    parser = build_parser()
    parsed = parser.parse_args(args)

    app = NexusPortApp()

    if parsed.command == "login":
        res = app.login(parsed.identificador)
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif parsed.command == "cargas":
        if parsed.action == "list":
            res = app.cargas.get_cargas()
        elif parsed.action == "get":
            res = app.cargas.get_carga(parsed.id)
        elif parsed.action == "schedule":
            res = app.cargas.agendar_carga({
                "id": parsed.id,
                "natureza": parsed.tipo or "Carga Geral",
                "peso": parsed.peso or 10,
                "volume": parsed.volume or 20
            })
        elif parsed.action == "receive":
            res = app.cargas.receber_carga(parsed.id)
        elif parsed.action == "move":
            res = app.cargas.movimentar_carga(parsed.id)
        elif parsed.action == "ready":
            res = app.cargas.marcar_pronta_entrega(parsed.id)
        elif parsed.action == "release":
            res = app.cargas.liberar_carga_saida(parsed.id, parsed.motivo)
        elif parsed.action == "cancel":
            res = app.cargas.cancelar_carga(parsed.id, parsed.motivo or "Cancelado via CLI")
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif parsed.command == "navios":
        if parsed.action == "list":
            res = app.embarcacoes.get_navios()
        elif parsed.action == "get":
            res = app.embarcacoes.get_navio(parsed.id)
        elif parsed.action == "save":
            res = app.embarcacoes.save_navio({"nome": parsed.nome, "imo": parsed.imo})
        elif parsed.action == "release":
            res = app.embarcacoes.liberar_saida_navio(parsed.id)
        elif parsed.action == "return":
            res = app.embarcacoes.autorizar_retorno_navio(parsed.id)
        elif parsed.action == "delete":
            res = app.embarcacoes.delete_navio(parsed.id)
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif parsed.command == "bercos":
        if parsed.action == "list":
            res = app.embarcacoes.get_bercos()
        elif parsed.action == "link":
            res = app.embarcacoes.vincular_navio_berco(parsed.nome, {"nome": parsed.navio} if parsed.navio else None)
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif parsed.command == "inspecoes":
        if parsed.action == "list":
            res = app.inspecoes.get_cargas_inspecao()
        elif parsed.action in ("inspect", "reject"):
            resultado = "RECUSADA" if parsed.action == "reject" or parsed.resultado == "RECUSADA" else "APROVADA"
            res = app.inspecoes.inspecionar_carga(
                carga_id=parsed.carga_id,
                resultado=resultado,
                observacoes=parsed.observacoes
            )
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif parsed.command == "manutencao":
        if parsed.action == "list":
            res = app.manutencao.get_manutencoes()
        elif parsed.action == "request":
            res = app.manutencao.solicitar_manutencao(parsed.entidade_tipo, parsed.entidade_id, parsed.descricao or "Solicitação via CLI")
        elif parsed.action == "approve":
            res = app.manutencao.aprovar_manutencao(parsed.os_id)
        elif parsed.action == "reject":
            res = app.manutencao.recusar_manutencao(parsed.os_id)
        elif parsed.action == "complete":
            res = app.manutencao.concluir_manutencao(parsed.os_id)
        elif parsed.action == "preventive":
            res = app.manutencao.buscar_equipamentos_preventiva_sugerida()
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif parsed.command == "emergencia":
        if parsed.action == "status":
            res = app.panic.get_emergencia_ativa()
        elif parsed.action == "trigger":
            res = app.panic.trigger_panic(parsed.motivo)
        elif parsed.action == "resolve":
            res = app.panic.resolve_panic(parsed.id)
        print(json.dumps(res, indent=2, ensure_ascii=False))

    elif parsed.command == "indicadores":
        res = app.kpis.buscar_indicadores_operacionais()
        print(json.dumps(res, indent=2, ensure_ascii=False))

    else:
        parser.print_help()

if __name__ == "__main__":
    main()
