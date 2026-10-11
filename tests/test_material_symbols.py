"""Regressions for the locally generated Material Symbols font subset."""

import importlib.util
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


if __name__ == "__main__":
    unittest.main()
