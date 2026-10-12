"""Regressions for the locally generated Material Symbols font subset."""

import importlib.util
import re
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "tools" / "subset-material-symbols.py"
SPEC = importlib.util.spec_from_file_location("subset_material_symbols", SCRIPT)
if SPEC is None or SPEC.loader is None:  # pragma: no cover - erro de configuração do teste
    raise RuntimeError(f"Não foi possível carregar {SCRIPT}")
SUBSET_SCRIPT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SUBSET_SCRIPT)


class TestMaterialSymbolsSubset(unittest.TestCase):
    def test_extracts_icons_from_runtime_text_updates(self):
        fonte = """
        const themeIcon = document.querySelector('#themeToggleIcon');
        themeIcon.textContent = document.documentElement.classList.contains('dark')
          ? 'light_mode' : 'dark_mode';
        statusIcon.textContent = 'hourglass_empty';
        const feedback = { icon: 'error' };
        let icone = 'verified';
        """

        encontrados = SUBSET_SCRIPT.icones_no_conteudo(fonte)

        self.assertEqual(
            {"light_mode", "dark_mode", "hourglass_empty", "error", "verified"},
            encontrados,
        )
        # A condição `classList.contains('dark')` não é um nome de ícone.
        self.assertNotIn("dark", encontrados)

    def test_project_icon_inventory_includes_dynamic_icons(self):
        encontrados = set(SUBSET_SCRIPT.icones_usados())

        self.assertTrue(
            {"light_mode", "hourglass_empty", "error"}.issubset(encontrados),
            "ícones definidos via textContent devem entrar no subconjunto local",
        )

    def test_audit_screen_icons_are_detected_in_the_markup(self):
        """seguranca.html escreve os nomes no HTML: o scanner tem de vê-los."""
        marcacao = (ROOT / "seguranca.html").read_text(encoding="utf-8")

        encontrados = SUBSET_SCRIPT.icones_no_conteudo(marcacao)

        self.assertTrue(
            {"shield_lock", "filter_alt", "lan", "travel_explore"}.issubset(encontrados),
            "ícones da auditoria de tentativas de login devem entrar no subconjunto local",
        )

    def test_fonts_css_points_to_the_generated_subset(self):
        """css/fonts.css é gerado: a URL tem de bater com o subconjunto versionado em fonts/."""
        css = (ROOT / "css" / "fonts.css").read_text(encoding="utf-8")

        referencias = re.findall(r"url\('\.\./fonts/(material-symbols[^']*)'\)", css)

        self.assertEqual(
            [SUBSET_SCRIPT.FONTE_SUBCONJUNTO.name],
            referencias,
            "tools/assets.js (FONTE_ICONES) e tools/subset-material-symbols.py divergem do css/fonts.css",
        )
        self.assertTrue(
            SUBSET_SCRIPT.FONTE_SUBCONJUNTO.exists(),
            "rode python3 tools/subset-material-symbols.py para gerar a fonte de ícones",
        )

    @unittest.skipUnless(
        SUBSET_SCRIPT.TTFont is not None and SUBSET_SCRIPT.FONTE_COMPLETA.exists(),
        "fontTools/material-symbols não instalados (pip install fonttools brotli && npm ci)",
    )
    def test_shipped_subset_renders_every_detected_icon(self):
        """Sem a ligadura na fonte, o navegador mostra o nome do ícone como texto."""
        ligaduras = SUBSET_SCRIPT.mapa_de_ligaduras(SUBSET_SCRIPT.FONTE_SUBCONJUNTO)
        completos = SUBSET_SCRIPT.mapa_de_ligaduras(SUBSET_SCRIPT.FONTE_COMPLETA)

        faltando = [
            nome
            for nome in SUBSET_SCRIPT.icones_usados()
            if nome in completos and nome not in ligaduras
        ]

        self.assertEqual(
            [],
            faltando,
            "subconjunto desatualizado (" + ", ".join(faltando) + "): "
            "rode python3 tools/subset-material-symbols.py e troque a versão do nome do arquivo",
        )


if __name__ == "__main__":
    unittest.main()
