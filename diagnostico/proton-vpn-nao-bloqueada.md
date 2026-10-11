# Diagnóstico — IPs da Proton VPN passando pelo gate `vpn-gate`

**Data:** 2026-10-11 · **Terminal:** STS-01 (Santos) · **Módulo:** bloqueio de IP (Supabase Edge Function `vpn-gate`)

---

## 1. Relato

Com a Proton VPN conectada, a interface do NexusPort era revelada: o gate não bloqueava o IP de saída.

## 2. O que foi verificado

### 2.1 A API da Proton não publica o IP que o site vê

A consulta `GET /vpn/logicals` devolve, para cada servidor, `EntryIP` e `ExitIP`. No *snapshot* capturado em 2026-10-11 (via [tn3w/ProtonVPN-IPs](https://github.com/tn3w/ProtonVPN-IPs), que espelha a API):

| Medida | Valor |
| --- | --- |
| Servidores lógicos | 1.612 |
| Entradas de servidor | 2.389 |
| IPs únicos (entrada) | 856 |
| Entradas em que `ExitIP` ≠ `EntryIP` | **0** |
| Blocos `/24` distintos | 303 |

Ou seja: o campo `ExitIP` **repete o `EntryIP`** — o endereço que o site efetivamente vê é uma saída NAT que nunca aparece na API. A própria documentação do tn3w registra isso ("the address a website actually sees is a different NAT egress IP the API never returns").

### 2.2 A cobertura das listas atuais

Comparando os 856 IPs anunciados com cada fonte usada pela função:

| Fonte | Cobertura dos IPs anunciados |
| --- | --- |
| tn3w `protonvpn_ip_ranges.txt` (`/24` de cada IP anunciado) | 856/856 — 100 % |
| tn3w `protonvpn_ips.txt` | 856/856 — 100 % |
| X4BNet `output/vpn/ipv4.txt` | 338/856 — 39,5 % |
| antonme `protonvpn/ipv4_merged.txt` | 591/856 — 69,0 % |
| União | 856/856 |

Conclusão: para os IPs **anunciados** a lista por `/24` bastava. O que escapava era a **saída NAT fora do `/24` anunciado**, mas ainda dentro do bloco que a operadora anuncia para a Proton — exatamente a lacuna que o recorte por `/24` não fecha.

### 2.3 Onde a Proton opera

AS de origem de cada IP anunciado (Team Cymru, `origin.asn.cymru.com`, 2026-10-11): **41 ASNs**, com destaque para

| ASN | Operadora | IPs anunciados |
| --- | --- | --- |
| AS209103 | PROTONVPN (Proton AG) | 209 |
| AS212238 | CDNEXT / Datacamp | 180 |
| AS9009 | M247 | 140 |
| AS56704 | FARICE | 119 |
| AS8473 | BAHNHOF | 67 |
| AS49981 | WorldStream | 33 |
| AS60068 | CDN77 / Datacamp | 27 |
| — | demais 34 ASNs | 81 |

`AS209103` **e** `AS208172` (PV-HOSTED) estão registradas em nome da **Proton AG** e só anunciam espaço da Proton — podem ser bloqueadas por inteiro sem falso positivo relevante.

## 3. Correção aplicada

Nova **camada Proton** na Edge Function, antes das listas genéricas:

1. **ASNs próprias da Proton AG** (`209103`, `208172`): todo o espaço anunciado (IPv4 e IPv6) é bloqueado, incluindo as saídas NAT que a API não publica. Fonte: [ipverse/as-ip-blocks](https://github.com/ipverse/as-ip-blocks) (`as/<asn>/ipv4-aggregated.txt` e `ipv6-aggregated.txt`, CC0, atualização diária).
2. **Blocos anunciados da hospedagem**: para cada IP anunciado pela Proton (`protonvpn_ips.txt`), bloqueia-se o **menor prefixo BGP anunciado** que o contém, entre os ASNs de hospedagem usados pela Proton. Nada maior que `/20` é herdado, para não arrastar blocos de backbone/transito.
3. **Modo agressivo (opcional)**: `VPN_GATE_NIVEL=agressivo` bloqueia todo o espaço anunciado pelos ASNs de hospedagem. Mais completo e com mais colateral — por isso não é o padrão.

### 3.1 Efeito medido

| Medida | Valor |
| --- | --- |
| Prefixos de hospedagem baixados por atualização | 5.987 (39 ASNs) |
| Blocos resultantes (hospedagem) | 235 |
| Blocos totais com as ASNs próprias | 257 |
| Espaço IPv4 bloqueado pela camada | 202.496 endereços — 0,0047 % do IPv4 |
| `/24` que as listas antigas não cobriam | 477 — 122.112 endereços |
| Amostra de `/24` novos revalidada | 141/141 bloqueados pela camada `proton` |

Exemplo concreto: `109.236.82.5` (vizinho de um bloco WorldStream anunciado para a Proton) **não** estava em nenhuma lista antiga e agora é bloqueado.

A resposta de bloqueio ganhou o cabeçalho `X-Vpn-Gate-Motivo` (`geo-eua`, `proton`, `vpn`, `*-indisponivel`) para o operador identificar a camada que decidiu.

## 4. Como verificar sem deploy

```bash
npm run check:ip -- 146.70.199.5 109.236.82.5 8.8.8.8
npm run check:ip -- --nivel agressivo <IP>
```

A ferramenta usa o mesmo `handler.js` da Edge Function com as fontes reais. Em produção, o mesmo diagnóstico sai em `curl -i` (cabeçalho `X-Vpn-Gate-Motivo`).

O deploy continua sendo obrigatório para valer em produção:

```bash
supabase functions deploy vpn-gate --no-verify-jwt
```

## 5. Limites que continuam

- **Latência de atualização:** a camada Proton é recalculada a cada 60 min por instância; um servidor aberto depois disso entra no ciclo seguinte. O modo agressivo reduz a dependência desses ciclos.
- **Colateral:** o modo agressivo pode bloquear clientes legítimos de Datacamp, M247, Bahnhof e afins.
- **Hospedagem estática:** a função apenas esconde a interface; o HTML/JS ainda é entregue pelo host. Bloqueio de rede de verdade exige um proxy de entrada no domínio.
- **Se um IP ainda passar:** coletar o endereço exibido por `https://ifconfig.me` com a VPN ligada e rodar `npm run check:ip -- <IP>`; o resultado mostra se falta uma fonte ou se o IP está fora de qualquer bloco conhecido.
