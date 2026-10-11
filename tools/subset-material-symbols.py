#!/usr/bin/env python3
"""
SUBCONJUNTO DA FONTE DE ÍCONES (Material Symbols Outlined) — NexusPort.

O pacote npm `material-symbols` publica a fonte variável completa (3,7 MB, ~6.400 glifos). As telas
usam pouco mais de cem ícones, e a fonte é baixada em todas as páginas — então aqui ela é reduzida
aos ícones realmente usados (troca de ligaduras: o texto "add" vira o desenho do ícone).

Como funciona:
  1. Lê os nomes dos ícones das páginas (`material-symbols-outlined ...>nome<`) e dos módulos
     JavaScript (`icone: 'nome'`, atribuições a `icon.textContent`, etc.), inclusive ícones trocados
     em tempo de execução como `light_mode` no botão de tema.
  2. Lê a tabela GSUB da fonte para descobrir o glifo que cada ligadura produz (a sequência de
     componentes usa letras maiúsculas na fonte; aqui ela é normalizada para minúsculas).
  3. Gera `fonts/material-symbols-outlined-v2.woff2` com `fontTools.subset`, mantendo os eixos
     variáveis (FILL/wght/GRAD/opsz) e a feature de ligaduras. A expansão automática de layout é
     desligada (`--no-layout-closure`), senão o subconjunto voltaria a incluir todos os ícones.

Requisitos: `pip install fonttools brotli` (uma vez). O arquivo gerado é versionado no repositório;
rode este script quando ícones forem adicionados ou removidos das telas. `--check` confere se a fonte
versionada contém todos os ícones detectados sem regravá-la.

Uso: python3 tools/subset-material-symbols.py [--check]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    from fontTools.subset import Options, Subsetter, load_font, save_font
    from fontTools.ttLib import TTFont
except ImportError:  # pragma: no cover - verificação do ambiente ao gerar a fonte
    Options = Subsetter = load_font = save_font = TTFont = None

RAIZ = Path(__file__).resolve().parent.parent
FONTE_COMPLETA = RAIZ / 'node_modules' / 'material-symbols' / 'material-symbols-outlined.woff2'
FONTE_SUBCONJUNTO = RAIZ / 'fonts' / 'material-symbols-outlined-v2.woff2'

# <span class="material-symbols-outlined ...">nome_do_icone</span>
PADRAO_MARCAÇÃO = re.compile(r'material-symbols-outlined[^>]*>\s*([a-z0-9_]+)', re.IGNORECASE)
# Ícones declarados/selecionados em JS: propriedades e variáveis (icone: 'x', icon = 'x').
PADRAO_JS = re.compile(r"\bicon[e]?\s*[:=]\s*['\"]([a-z0-9_]+)['\"]")
# Ícones trocados em tempo de execução: icon.textContent = isDark ? 'light_mode' : 'dark_mode'.
PADRAO_JS_TEXTO = re.compile(r"\b(?:textContent|innerText)\s*=\s*([^;]*)", re.DOTALL)
PADRAO_LITERAL = re.compile(r"['\"]([a-z0-9_]+)['\"]")
PADRAO_VALIDO = re.compile(r'^[a-z][a-z0-9_]*$')


def exigir_fonttools() -> None:
    """Permite testar o scanner sem FontTools, mas exige-o para ler/gerar fontes."""
    if TTFont is None:
        sys.exit(
            '❌ fontTools não está instalado. Instale com:\n'
            '   pip install fonttools brotli\n'
        )


def arquivos_fonte() -> list[Path]:
    """Páginas e módulos onde as classes e os nomes dos ícones aparecem."""
    arquivos = sorted(RAIZ.glob('*.html')) + sorted((RAIZ / 'js').rglob('*.js'))
    return [a for a in arquivos if 'node_modules' not in a.parts]


def icones_no_conteudo(texto: str) -> set[str]:
    """Extrai ícones de marcação e de atribuições/declarações JavaScript."""
    nomes = set(PADRAO_MARCAÇÃO.findall(texto))
    nomes.update(PADRAO_JS.findall(texto))

    for expressao in PADRAO_JS_TEXTO.findall(texto):
        # Não inclua palavras da condição como o nome da classe `dark` no tema:
        # os nomes de ícone ficam nas duas expressões do operador ternário.
        if '?' in expressao:
            expressao = expressao.split('?', 1)[1]
        nomes.update(PADRAO_LITERAL.findall(expressao))

    return {nome for nome in nomes if PADRAO_VALIDO.fullmatch(nome)}


def icones_usados() -> list[str]:
    nomes: set[str] = set()
    for arquivo in arquivos_fonte():
        nomes.update(icones_no_conteudo(arquivo.read_text(encoding='utf-8')))
    return sorted(nomes)


def mapa_de_ligaduras(caminho: Path) -> dict[str, str]:
    """Sequência de caracteres digitada → nome do glifo desenhado (liga a tabela GSUB)."""
    exigir_fonttools()
    fonte = TTFont(caminho)
    caracteres = {glifo: chr(cp) for cp, glifo in fonte.getBestCmap().items()}
    ligaduras: dict[str, str] = {}
    for lookup in fonte['GSUB'].table.LookupList.Lookup:
        for subTabela in lookup.SubTable:
            # Os lookups são extensões (tipo 7) que embrulham o tipo 4 (ligaduras).
            while type(subTabela).__name__ == 'ExtensionSubst':
                subTabela = subTabela.ExtSubTable
            for primeira, lista in getattr(subTabela, 'ligatures', {}).items():
                for ligadura in lista:
                    sequencia = ''.join(
                        caracteres.get(g, '') for g in [primeira, *ligadura.Component]
                    )
                    ligaduras.setdefault(sequencia.lower(), ligadura.LigGlyph)
    return ligaduras


def subset(texto: str, glifos: list[str], destino: Path) -> None:
    exigir_fonttools()
    opcoes = Options()
    opcoes.layout_features = ['*']   # mantém rlig/liga: sem elas os ícones não aparecem
    opcoes.layout_closure = False    # sem fechar o layout: só os glifos pedidos entram
    opcoes.flavor = 'woff2'
    opcoes.drop_tables += ['DSIG']
    fonte = load_font(str(FONTE_COMPLETA), opcoes)
    subsetter = Subsetter(options=opcoes)
    subsetter.populate(text=texto, glyphs=glifos)
    subsetter.subset(fonte)
    destino.parent.mkdir(parents=True, exist_ok=True)
    save_font(fonte, str(destino), opcoes)


def principal(argv: list[str]) -> int:
    if not FONTE_COMPLETA.exists():
        sys.exit(
            f'❌ Fonte completa não encontrada em {FONTE_COMPLETA.relative_to(RAIZ)}.\n'
            '   Rode "npm ci" antes (o pacote material-symbols vem das devDependencies).\n'
        )

    icones = icones_usados()
    ligaduras = mapa_de_ligaduras(FONTE_COMPLETA)
    sem_glifo = [nome for nome in icones if nome not in ligaduras]
    if sem_glifo:
        print(f'⚠️  Sem glifo na fonte (ignorados): {", ".join(sem_glifo)}')

    if '--check' in argv:
        if not FONTE_SUBCONJUNTO.exists():
            print(f'❌ Subconjunto ausente: {FONTE_SUBCONJUNTO.relative_to(RAIZ)}')
            print('   Rode: python3 tools/subset-material-symbols.py')
            return 1
        ligaduras_subconjunto = mapa_de_ligaduras(FONTE_SUBCONJUNTO)
        faltando = [nome for nome in icones if nome in ligaduras and nome not in ligaduras_subconjunto]
        if faltando:
            print(f'❌ Subconjunto desatualizado; faltam os ícones: {", ".join(faltando)}')
            print('   Rode: python3 tools/subset-material-symbols.py')
            return 1
        reconhecidos = len(icones) - len(sem_glifo)
        print(f'✅ {FONTE_SUBCONJUNTO.relative_to(RAIZ)} contém todos os {reconhecidos} ícones reconhecidos.')
        return 0

    glifos: set[str] = set()
    for nome in icones:
        glifo = ligaduras.get(nome)
        if not glifo:
            continue
        glifos.add(glifo)
        # Variantes preenchidas usadas por font-variation-settings: 'FILL' 1.
        if f'{glifo}.fill' in ligaduras.values():
            glifos.add(f'{glifo}.fill')

    if not glifos:
        sys.exit('❌ Nenhum ícone reconhecido nas telas. Abortando para não gerar fonte vazia.')

    # O texto inclui os nomes (letras/dígitos/underscore) das ligaduras usadas.
    subset(''.join(sorted(icones)) + ''.join(sorted(set(''.join(icones)))), sorted(glifos), FONTE_SUBCONJUNTO)

    tamanho = FONTE_SUBCONJUNTO.stat().st_size
    relativo = FONTE_SUBCONJUNTO.relative_to(RAIZ)
    print(f'✅ {relativo}: {len(glifos)} glifos de {len(icones)} ícones, {tamanho / 1024:.1f} KiB')
    return 0


if __name__ == '__main__':
    raise SystemExit(principal(sys.argv[1:]))
