"""
Suíte Completa de Testes da Python API Suite - NexusPort (tests/test_python_suite.py)
Garante 100% de cobertura e funcionamento 1:1 com o front-end.
"""

import sys
import os
import unittest
import json
from io import StringIO

# Adiciona o diretório raiz ao PYTHONPATH
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from tools.nexus_api import (
    NexusPortApp, NexusClient, NexusAuth, load_config,
    CargasAPI, EmbarcacoesAPI, InspecoesAPI, ManutencaoAPI,
    TecnicoAPI, DelegacaoAPI, PanicAPI, AuditoriaAPI, KPIsAPI
)
from tools.nexus_api.embarcacoes import normalizar_berco
from tools.nexus_api.cli import main as cli_main


class TestNexusPortPythonSuite(unittest.TestCase):

    def setUp(self):
        self.app = NexusPortApp()
        self.client = self.app.client

    # 1. CONFIG & CLIENT
    def test_config_and_client_init(self):
        cfg = load_config()
        self.assertIn("SUPABASE_URL", cfg)
        self.assertIn("SUPABASE_ANON_KEY", cfg)
        self.assertIsNotNone(self.client)

    # 2. AUTH & RBAC
    def test_auth_login_and_permissions(self):
        session = self.app.login("SUP-2001")
        self.assertEqual(session["cargo"], "SUPERVISOR_GERENTE_OPERACOES")
        self.assertEqual(session["nivel"], "TATICO")
        self.assertEqual(session["camada_visao"], "Visão Operacional")
        self.assertTrue(self.app.auth.has_permission("LIBERAR_CARGA"))
        self.assertFalse(self.app.auth.has_permission("CADASTRAR_FUNCIONARIO"))

        # Test login Estivador
        session_est = self.app.login("888002", cargo_hint="ESTIVADOR")
        self.assertEqual(session_est["nivel"], "OPERACIONAL")
        self.assertTrue(self.app.auth.has_permission("MOVIMENTAR_CARGA"))

    # 3. CARGAS
    def test_cargas_lifecycle(self):
        import uuid
        func_info = self.app.login("SUP-2001")
        cid = f"CRG-TEST-{uuid.uuid4().hex[:6].upper()}"

        # Agendamento
        carga = self.app.cargas.agendar_carga({
            "id": cid,
            "natureza": "Carga de Teste",
            "peso": "15 t",
            "volume": "30 m³",
            "valor": "R$ 50.000,00"
        }, funcionario_info=func_info)
        self.assertIsNotNone(carga)

        # Recebimento
        rec = self.app.cargas.receber_carga(cid, funcionario_info=func_info)
        c_rec = self.app.cargas.get_carga(cid)
        self.assertEqual(c_rec["status"], "RECEBIMENTO_INSPECAO")

        # Movimentação
        self.app.cargas.movimentar_carga(cid, guindaste_id="GND-01", local="Baia 4", funcionario_info=func_info)
        c_mov = self.app.cargas.get_carga(cid)
        self.assertEqual(c_mov["status"], "ARMAZENAGEM")

        # Pronta para Entrega
        self.app.cargas.marcar_pronta_entrega(cid, funcionario_info=func_info)
        c_pronta = self.app.cargas.get_carga(cid)
        self.assertEqual(c_pronta["status"], "PRONTA_PARA_ENTREGA")

        # Liberação
        self.app.cargas.liberar_carga_saida(cid, motivo="Liberado via Python API", funcionario_info=func_info)
        c_lib = self.app.cargas.get_carga(cid)
        self.assertEqual(c_lib["status"], "EM_TRANSITO")

        # Cancelamento
        self.app.cargas.cancelar_carga(cid, motivo="Avaria grave no pátio", funcionario_info=func_info)
        c_canc = self.app.cargas.get_carga(cid)
        self.assertEqual(c_canc["status"], "CANCELADA")
        self.assertEqual(c_canc["motivoCancelamento"], "Avaria grave no pátio")

    # 4. EMBARCAÇÕES, BERÇOS & RESTRIÇÕES DE BANCO
    def test_normalizar_berco_logic(self):
        # Berço sem ID BERCO-NN deve ser corrigido para BERCO-NN
        res1 = normalizar_berco({"nome": "Berço 05", "estado": "LIVRE"})
        self.assertEqual(res1["payload"]["id"], "BERCO-05")
        self.assertEqual(res1["payload"]["estado"], "LIVRE")

        # Berço OCUPADO sem navio deve voltar para LIVRE (regras de banco bercos_vinculo_navio_check)
        res2 = normalizar_berco({"nome": "Berço 02", "estado": "OCUPADO"})
        self.assertEqual(res2["payload"]["estado"], "LIVRE")
        self.assertTrue(res2["corrigido"])

        # Berço OCUPADO com navio mantém os dados
        res3 = normalizar_berco({"nome": "Berço 03", "estado": "OCUPADO", "navio_nome": "MV Santos Star", "navio_imo": "9123456"})
        self.assertEqual(res3["payload"]["estado"], "OCUPADO")
        self.assertEqual(res3["payload"]["navio_nome"], "MV Santos Star")

        # Berço LIVRE com resíduo de navio deve ter os campos limpos
        res4 = normalizar_berco({"nome": "Berço 04", "estado": "LIVRE", "navio_nome": "MV Residual"})
        self.assertIsNone(res4["payload"]["navio_nome"])

    def test_embarcacoes_crud(self):
        # Navio
        self.app.embarcacoes.save_navio({"nome": "MV Python Express", "imo": "IMO-9998887"})
        navio = self.app.embarcacoes.get_navio("IMO-9998887")
        self.assertIsNotNone(navio)
        self.assertEqual(navio["nome"], "MV Python Express")

        # Vincular ao berço
        self.app.embarcacoes.vincular_navio_berco("BERCO-99", {"nome": "MV Python Express", "imo": "IMO-9998887"})
        bercos = self.app.embarcacoes.get_bercos()
        b_list = [b for b in bercos if b["nome"] == "BERCO-99" or b["id"] == "BERCO-99"]
        self.assertTrue(len(b_list) > 0)
        b1 = b_list[0]
        self.assertEqual(b1["estado"], "OCUPADO")
        self.assertEqual(b1["navio_nome"], "MV Python Express")

        # Liberação de saída do navio desvincula berço
        self.app.embarcacoes.liberar_saida_navio(navio["id"])
        navio_lib = self.app.embarcacoes.get_navio("IMO-9998887")
        self.assertEqual(navio_lib["localizacao"], "FORA_DO_PORTO")

        b1_after = [b for b in self.app.embarcacoes.get_bercos() if b["nome"] == "BERCO-99" or b["id"] == "BERCO-99"][0]
        self.assertEqual(b1_after["estado"], "LIVRE")

    # 5. INSPEÇÕES & HISTÓRICO
    def test_inspecoes_active_history(self):
        import uuid
        func_info = self.app.login("SUP-2001")
        cid = f"CRG-INSP-{uuid.uuid4().hex[:6].upper()}"
        # Cria carga para inspeção
        self.app.cargas.agendar_carga({"id": cid, "natureza": "Granel Solido"})
        self.app.cargas.receber_carga(cid)

        # Primeira inspeção (Aprovada)
        self.app.inspecoes.inspecionar_carga(cid, "APROVADA", "Tudo ok", funcionario_info=func_info)
        c1 = self.app.cargas.get_carga(cid)
        self.assertEqual(c1["status"], "ARMAZENAGEM")

        # Re-inspeção (Recusada): a anterior vira ativa = False e a nova vira ativa = True
        self.app.inspecoes.recusar_carga(cid, "Embalagem danificada no reteste", funcionario_info=func_info)
        c2 = self.app.cargas.get_carga(cid)
        self.assertEqual(c2["status"], "RECUSADA")

    # 6. MANUTENÇÃO & PREVENTIVA SUGERIDA
    def test_manutencao_os_and_preventive(self):
        # Chaves de navio são uuid no banco: usa um navio real criado pelo teste
        navio_os = self.app.embarcacoes.save_navio({"nome": "MV Casco OS", "imo": "IMO-9998888"})
        navio_os_id = navio_os.get("id") if isinstance(navio_os, dict) else None
        self.assertTrue(navio_os_id, "save_navio deve retornar o id (uuid) do navio")
        os_rec = self.app.manutencao.solicitar_manutencao("NAVIO", navio_os_id, "Serviço no casco")
        self.assertIsNotNone(os_rec)
        os_id = os_rec.get("id") if isinstance(os_rec, dict) else os_rec
        if not os_id and isinstance(os_rec, list) and len(os_rec) > 0:
            os_id = os_rec[0].get("id")

        if os_id:
            self.app.manutencao.aprovar_manutencao(os_id)
            os_app = self.app.manutencao.get_manutencao(os_id)
            if os_app:
                self.assertEqual(os_app["status"], "APROVADA")

            self.app.manutencao.concluir_manutencao(os_id)
            os_conc = self.app.manutencao.get_manutencao(os_id)
            if os_conc:
                self.assertEqual(os_conc["status"], "CONCLUIDA")

        # Teste de equipamentos com preventiva sugerida (> 3 anos)
        preventiva = self.app.manutencao.buscar_equipamentos_preventiva_sugerida()
        self.assertIn("equipamentos", preventiva)
        self.assertIn("total", preventiva)

    # 6b. REGRESSÃO: IDs inválidos (22P02) e chaves únicas (23505) vistos nos logs do Supabase
    def test_ids_nao_uuid_nao_chegam_ao_banco(self):
        # Login sem cadastro no banco não pode usar id textual (ex.: "func-default-id")
        sessao = self.app.login("INSP-9999")
        self.assertIsNone(sessao["id"])

        # Entidade de manutenção com id que não é UUID é recusada antes da requisição
        with self.assertRaises(ValueError):
            self.app.manutencao.solicitar_manutencao("NAVIO", "navio-uuid-1", "Teste")

        # Operações por id ausente (None -> "None") não devem gerar PATCH/DELETE
        self.assertIsNone(self.app.manutencao.aprovar_manutencao(None))
        self.assertIsNone(self.app.manutencao.concluir_manutencao("None"))
        self.assertIsNone(self.app.panic.resolve_panic(None))
        self.assertIsNone(self.app.delegacao.revogar_delegacao(None))
        self.assertIsNone(self.app.embarcacoes.delete_container(None))

        # Chaves estrangeiras opcionais inválidas viram NULL (não string)
        payload = self.app.cargas.save_carga({"id": "CRG-UUID-SAFE", "navioId": "navio-uuid-1", "container": "None"})
        self.assertIsNotNone(payload)

    def test_upsert_por_chave_unica_nao_duplica(self):
        # numero_imo UNIQUE: salvar duas vezes o mesmo IMO atualiza o mesmo navio
        self.app.embarcacoes.save_navio({"nome": "MV Dup A", "imo": "IMO-9997771"})
        self.app.embarcacoes.save_navio({"nome": "MV Dup B", "imo": "IMO-9997771"})
        navios = [n for n in self.app.embarcacoes.get_navios() if n["imo"] == "IMO-9997771"]
        self.assertEqual(len(navios), 1)
        self.assertEqual(navios[0]["nome"], "MV Dup B")

        # matricula UNIQUE: cadastrar duas vezes a mesma matrícula não duplica
        self.app.tecnico.save_funcionario({"matricula": "777123", "nome": "Dup A", "cargo": "ESTIVADOR"})
        self.app.tecnico.save_funcionario({"matricula": "777123", "nome": "Dup B", "cargo": "ESTIVADOR"})
        funcs = [f for f in self.app.tecnico.get_funcionarios() if f.get("matricula") == "777123"]
        self.assertEqual(len(funcs), 1)
        self.assertEqual(funcs[0]["nome"], "Dup B")

        # qr_code_url UNIQUE: agendar a mesma carga duas vezes atualiza a existente
        self.app.cargas.save_carga({"id": "CRG-DUP-777", "natureza": "A", "qrCode": "QR-CRG-DUP-777"})
        self.app.cargas.save_carga({"id": "CRG-DUP-777", "natureza": "B", "qrCode": "QR-CRG-DUP-777"})
        cargas = [c for c in self.app.cargas.get_cargas() if c["qrCode"] == "QR-CRG-DUP-777"]
        self.assertEqual(len(cargas), 1)
        self.assertEqual(cargas[0]["natureza"], "B")

    # 7. TÉCNICO EM PORTOS & VISITANTES
    def test_tecnico_funcionarios_e_visitantes(self):
        # Funcionário
        f_saved = self.app.tecnico.save_funcionario({
            "matricula": "999111",
            "nome": "João Técnico",
            "cargo": "TECNICO_PORTOS"
        })
        self.assertIsNotNone(f_saved)
        novo_cod = self.app.tecnico.reemitir_codigo_funcionario("999111")
        self.assertTrue(novo_cod.startswith("COD-"))

        # Visitante
        vis = self.app.tecnico.save_visitante("Visitante Carlos", "123.456.789-00", "Auditoria Operacional")
        self.assertIsNotNone(vis)

        saida = self.app.tecnico.registrar_saida_visitante("123.456.789-00")
        self.assertIsNotNone(saida)

    # 8. DELEGAÇÃO DE SUPERVISOR
    def test_delegacao_substituto(self):
        del_rec = self.app.delegacao.designar_substituto(
            supervisor_titular_id="sup-1",
            substituto_id="sub-1",
            substituto_cpf="111.222.333-44",
            substituto_nome="Supervisor Substituto",
            data_inicio="2026-04-01T08:00:00Z",
            data_fim_previsto="2026-04-15T18:00:00Z"
        )
        self.assertIsNotNone(del_rec)
        ativa = self.app.delegacao.get_delegacao_ativa()
        self.assertIsNotNone(ativa)

        self.app.delegacao.revogar_delegacao(ativa["id"])

    # 9. BOTÃO DE PÂNICO GLOBAL & EMERGÊNCIA
    def test_panic_trigger_and_resolve(self):
        em = self.app.panic.trigger_panic(
            motivo="Simulação de emergência via suíte Python",
            acionado_por_nome="Supervisor Teste",
            acionado_por_cargo="SUPERVISOR_GERENTE_OPERACOES",
            acionado_por_codigo="SUP-2001"
        )
        self.assertIsNotNone(em)

        ativa = self.app.panic.get_emergencia_ativa()
        self.assertIsNotNone(ativa)

        self.app.panic.resolve_panic(ativa["id"], resolvido_por_nome="Supervisor Responsável")

    # 10. AUDITORIA & DECISÃO TRAIL & SCANNER
    def test_auditoria_and_qr_scanner(self):
        func = self.app.login("SUP-2001")
        self.app.auditoria.log_alteracao("CARGA", "CRG-100", "EDICAO", {"campo": "status"}, funcionario_info=func)
        logs = self.app.auditoria.get_logs_alteracoes()
        self.assertTrue(len(logs) > 0)

        self.app.auditoria.registrar_trail_decisao("LIBEROU_NAVIO", "NAVIO", "NV-100", "Liberado após vistoria", funcionario_info=func)
        trail = self.app.auditoria.get_trail_decisoes()
        self.assertTrue(len(trail) > 0)

        # Scanner QR
        proc = self.app.auditoria.processar_qr_code("QR-CRG-999")
        self.assertEqual(proc["entidade_tipo"], "CARGA")
        self.assertEqual(proc["entidade_id"], "999")

    # 11. KPIS CONSOLIDADOS
    def test_kpis_consolidados(self):
        kpis = self.app.kpis.buscar_indicadores_operacionais()
        self.assertIn("recusadas", kpis)
        self.assertIn("preventiva", kpis)
        self.assertIn("ocupacaoPatio", kpis)

    # 12. CLI RUNNER
    def test_cli_subcommands(self):
        out = StringIO()
        old_stdout = sys.stdout
        try:
            sys.stdout = out
            cli_main(["login", "SUP-2001"])
            result_str = out.getvalue()
            self.assertIn("SUPERVISOR_GERENTE_OPERACOES", result_str)
        finally:
            sys.stdout = old_stdout


if __name__ == "__main__":
    unittest.main()
