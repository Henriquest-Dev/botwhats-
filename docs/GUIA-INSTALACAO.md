# Guia de instalação: Pacotinho Já no Google Cloud (grátis)

Tempo: cerca de 1 hora, com calma. Custo: **0 MT**, desde que sigas as escolhas marcadas com ⚠️.

**O que vais montar:**

| Peça | Para que serve | Custo |
|---|---|---|
| **Supabase** | Base de dados: revendedores, pagamentos, pedidos e a sessão do WhatsApp | Grátis |
| **DuckDNS** | Um endereço fixo para o teu servidor, ex.: `pacotinhoja.duckdns.org` | Grátis |
| **Google Cloud** | A máquina sempre ligada onde corre o bot e o painel | Grátis (máquina e2-micro) |
| **Netlify** | O site público que mostras aos revendedores | Grátis |

**Antes de começar, tem à mão:**
- Uma conta Google (Gmail).
- Um cartão **Visa ou Mastercard** que funcione em compras online. O Google pede-o só para confirmar a identidade; não cobra nada se seguires este guia.
- O telemóvel com o **WhatsApp Business do bot**, para o passo 5.
- Um bloco de notas para ires guardando as palavras-passe e os códigos.

---

## Passo 1 — Supabase (base de dados)

1. Entra em **supabase.com** → **Start your project** → entra com o GitHub ou o Google.
2. **New project**:
   - **Name:** `pacotinho`
   - **Database Password:** carrega em **Generate a password**. ⚠️ Usa **só letras e números**: se aparecerem símbolos (`@ # $ % /`), gera outra até não ter nenhum. **Guarda esta senha.**
   - **Region:** ⚠️ **East US (North Virginia)**. Fica perto do servidor do Google, e assim o bot responde mais depressa.
   - Carrega em **Create new project** e espera 1 a 2 minutos.
3. Copia a ligação da base de dados:
   - Carrega no botão **Connect**, no topo.
   - Escolhe ⚠️ **Session pooler**. As outras opções não funcionam com o servidor do Google.
   - Copia o endereço, que começa por `postgresql://postgres.xxxxx:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres`.
   - Troca `[YOUR-PASSWORD]`, **incluindo os parênteses rectos**, pela senha que guardaste.
   - **Guarda este endereço**: é a tua `DATABASE_URL`.

Não precisas de criar tabelas. O bot cria-as sozinho quando arranca.

---

## Passo 2 — DuckDNS (endereço grátis)

1. Entra em **duckdns.org** e faz login com o Google ou o GitHub (botões no topo).
2. Em **sub domain**, escreve um nome, por exemplo `pacotinhoja`, e carrega em **add domain**. Se estiver ocupado, tenta `pacotinhoja-mz` ou outro.
3. No topo da página aparece o teu **token**, uma sequência longa de letras e números. **Guarda o token e o nome do subdomínio.**

Deixa o campo "current ip" como está: o servidor actualiza-o sozinho.

---

## Passo 3 — Google Cloud (a máquina grátis)

### 3.1 Criar a conta
1. Entra em **cloud.google.com** → **Começar gratuitamente** (Get started for free).
2. Preenche os dados e o cartão. Recebes um crédito de teste de 300 dólares, mas não vais precisar dele: a máquina que vamos criar é grátis para sempre.
3. Para teres a certeza de que nada é cobrado, cria um alerta:
   - Menu ☰ → **Faturamento** (Billing) → **Orçamentos e alertas** (Budgets & alerts) → **Criar orçamento**.
   - Valor: **1 USD**.
   - Assim recebes um email se alguma coisa começar a custar dinheiro.

### 3.2 Criar a máquina
1. Menu ☰ → **Compute Engine** → **Instâncias de VM**. Se pedir, carrega em **Ativar** a API e espera 1 minuto.
2. Carrega em **Criar instância** e preenche, com cuidado nas ⚠️:

| Campo | O que escolher |
|---|---|
| Nome | `pacotinho` |
| Região | ⚠️ **us-east1 (Carolina do Sul)**. Também servem us-central1 ou us-west1. **Qualquer outra região é paga.** |
| Série / Tipo de máquina | ⚠️ **E2** → **e2-micro** (2 vCPU partilhados, 1 GB de memória) |
| Disco de arranque (Boot disk) → Alterar | Sistema: **Debian 12**. ⚠️ Tipo de disco: **Disco permanente padrão** (Standard persistent disk), **não** o "equilibrado" (balanced). Tamanho: **30 GB** |
| Firewall | ⚠️ Marca **Permitir tráfego HTTP** e **Permitir tráfego HTTPS** |

3. Do lado direito, o preço estimado deve dizer algo como *"Utilização gratuita mensal de e2-micro"*. Carrega em **Criar** e espera até aparecer um ✓ verde.

> ⚠️ Quando o teste de 90 dias acabar, o Google pede para **activar a conta completa**. Faz isso: a máquina e2-micro continua grátis, só deixas de ter o crédito de teste. Se não activares, a máquina é desligada.

---

## Passo 4 — Instalar o Pacotinho Já na máquina

1. Na lista de instâncias, carrega no botão **SSH** ao lado da máquina `pacotinho`. Abre-se uma janela preta: é o terminal da tua máquina.
2. Copia e cola estes comandos, **um de cada vez**, carregando em Enter depois de cada um:

```bash
sudo apt-get update && sudo apt-get install -y git
```

```bash
git clone -b ccr-fc6d0dbd-y03zgb https://github.com/Henriquest-Dev/botwhats-.git pacotinho
```

> **Se pedir "Username" e "Password"** (repositório privado):
> - Em **Username**, escreve o teu utilizador do GitHub.
> - Em **Password**, **não** escrevas a tua senha. Usa um **token**:
>   1. No GitHub: a tua foto → **Settings** → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
>   2. **Repository access:** "Only select repositories" → `botwhats-`.
>   3. **Permissions:** em **Contents**, escolhe **Read-only**.
>   4. Gera o token e cola-o como Password. No terminal não aparece nada enquanto colas; é normal.

```bash
cd pacotinho && sudo bash deploy/install.sh
```

3. O instalador faz-te 5 perguntas:

| Pergunta | O que responder |
|---|---|
| Subdomínio DuckDNS | O nome do passo 2 (ex: `pacotinhoja`) |
| Token do DuckDNS | O token do passo 2 |
| Palavra-passe do painel | Uma senha forte só tua, para entrares no painel |
| Ligação do Supabase | A `DATABASE_URL` do passo 1 |
| Chave da NVIDIA | Carrega em Enter para já. A IA pode ser ligada depois |

Nas perguntas secretas, o texto não aparece enquanto escreves ou colas. É normal.

4. Espera 3 a 5 minutos. No fim aparece:
```
✅ Pronto!
   Painel:  https://pacotinhoja.duckdns.org/admin
```

---

## Passo 5 — Primeiro acesso ao painel e ligação do número do bot

1. No telemóvel ou no computador, abre `https://O-TEU-SUBDOMINIO.duckdns.org/admin`. Da primeira vez, o cadeado https pode demorar 1 a 2 minutos a aparecer.
2. Entra com a palavra-passe do painel.
3. **Planos e definições:**
   - Em **Os teus dados**: o teu nome, o **teu** WhatsApp pessoal (não o do bot) e as contas M-Pesa/e-Mola onde os revendedores te pagam. Carrega em **Guardar**.
   - Em **Planos**: ajusta os preços se quiseres.
4. **Números do bot** → escreve o número do bot → **Pedir código de ligação**.
5. No telemóvel do bot: **WhatsApp Business → ⋮ → Dispositivos ligados → Ligar um dispositivo → Ligar com número de telefone** e escreve o código de 8 letras.
6. Em poucos segundos, o painel mostra **Ligado**. 🎉
7. **Revendedores → Novo revendedor**: cria-te a ti próprio como teste, adiciona o bot a um grupo de teste e escreve lá `!ativar` seguido do código.

---

## Passo 6 — Site público na Netlify

1. No GitHub, abre o ficheiro `netlify.toml` do repositório, no ramo `ccr-fc6d0dbd-y03zgb`. Carrega no lápis ✏️, troca `SEU-SUBDOMINIO` pelo teu subdomínio do DuckDNS e carrega em **Commit changes**.
2. Entra em **netlify.com** → **Add new site** → **Import an existing project** → **GitHub** → escolhe `botwhats-`.
3. Preenche:
   - **Branch:** `ccr-fc6d0dbd-y03zgb`
   - **Build command:** deixa **vazio**
   - **Publish directory:** `public`
   - Carrega em **Deploy**.
4. Em **Site configuration → Change site name**, escreve `pacotinhoja`. O site fica em `https://pacotinhoja.netlify.app`.

Os preços que aparecem no site são os do teu painel. Sempre que os mudas lá, o site actualiza sozinho.

---

## No dia-a-dia

Para correr estes comandos, abre o **SSH** da máquina como no passo 4.

| Quero… | Comando ou acção |
|---|---|
| Ver o que o bot está a fazer, em directo | `sudo journalctl -u pacotinho -f` (sai com Ctrl+C) |
| Instalar uma actualização que eu fiz | `cd ~/pacotinho && git pull && sudo bash deploy/update.sh` |
| Reiniciar o bot | `sudo systemctl restart pacotinho` |
| Mudar a palavra-passe, a chave da IA, etc. | `cd ~/pacotinho && sudo bash deploy/install.sh` (Enter mantém o que já estava) |
| Ver se está tudo vivo | Abre `https://O-TEU-SUBDOMINIO.duckdns.org/api/health` |

**A cada 14 dias, no máximo,** abre o WhatsApp no telemóvel do bot. Se ficar muito tempo sem ligar, o WhatsApp desliga os dispositivos ligados.

---

## Se alguma coisa correr mal

| Problema | Solução |
|---|---|
| `git clone` diz "Authentication failed" | O token está errado ou não tem acesso ao repositório. Gera outro (passo 4) e confirma "Contents: Read-only". |
| O instalador diz "O DuckDNS recusou" | Confirma o nome do subdomínio (sem `.duckdns.org`) e o token. Corre o instalador outra vez. |
| "❌ O bot não arrancou" e aparece `password authentication failed` | A senha dentro da `DATABASE_URL` está errada, ou ficaram os `[ ]`. Corre o instalador outra vez e cola a ligação certa. |
| Aparece `ENETUNREACH` ou `timeout` a falar do Supabase | Copiaste a ligação "Direct" em vez da **Session pooler**. Volta ao passo 1.3. |
| O site abre sem cadeado ou dá erro de certificado | Espera 2 minutos. Se continuar, confirma que marcaste HTTP e HTTPS na firewall (passo 3.2). |
| O número do bot ficou "Sessão terminada" | Alguém removeu o dispositivo no telemóvel, ou passaram mais de 14 dias sem abrir o WhatsApp. No painel, carrega em **Ligar** e repete o passo 5. |
| Apareceu uma cobrança no Google | Confirma a região (us-east1, us-central1 ou us-west1), o tipo **e2-micro** e o disco **padrão**. Se algum estiver diferente, apaga a máquina e cria outra; os dados estão no Supabase e não se perdem. |

## Quando for altura de crescer
Com 30 a 40 grupos activos, ou se o bot começar a ficar lento:
1. Cria uma máquina maior, no Google (paga) ou numa VPS como a Hetzner.
2. Repete o **passo 4** nessa máquina. Usa a mesma `DATABASE_URL` e o mesmo DuckDNS.
3. Apaga a máquina antiga.

Os revendedores, os pagamentos e até a sessão do WhatsApp estão no Supabase, por isso o bot continua no mesmo número **sem precisares de o voltar a ligar**.
