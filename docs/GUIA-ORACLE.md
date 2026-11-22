# Guia: Pacotinho Já na Oracle Cloud (VPS grátis)

Tempo: 1 a 1h30. Custo: **0 MT**, se seguires as escolhas marcadas com ⚠️.

**Porquê a Oracle:** tem um centro de dados em **Joanesburgo**, muito perto de Moçambique, e uma máquina ARM grátis com mais memória do que o Google.

**Os dois cuidados especiais da Oracle (este guia trata de ambos):**
1. A região que escolhes no registo **nunca mais pode ser mudada**, e as máquinas grátis só existem nessa região.
2. A Oracle pode apagar máquinas grátis que considere "paradas". Um bot usa pouco processador, por isso no passo 3 vamos proteger a máquina.

**Tem à mão:**
- Um email.
- Um cartão **Visa ou Mastercard** que funcione online. A Oracle faz uma verificação de cerca de 1 dólar e devolve-o.
- Um **computador** (Windows, Mac ou Linux) para o passo 5. Também dá no telemóvel, com a app Termius.
- Um bloco de notas para as senhas e os códigos.

---

## Passo 1 — Criar a conta Oracle

1. Entra em **oracle.com/cloud/free** → **Start for free**.
2. Preenche o país (**Mozambique**), o nome e o email. Confirma o email.
3. Na página seguinte:
   - **Cloud Account Name:** um nome simples, ex.: `pacotinhoja`. **Guarda-o**: é preciso para entrar.
   - **Home Region:** ⚠️ escolhe **South Africa Central (Johannesburg)**. Se não aparecer, escolhe **Germany Central (Frankfurt)** ou **UK South (London)**. **Não podes mudar isto depois.**
4. Morada, telefone e cartão. Espera pelo email **"Your Oracle Cloud account is fully provisioned"**. Pode demorar de 5 minutos a algumas horas.

> Se o registo for recusado, normalmente é por causa do cartão. Tenta outro cartão, ou usa o guia do Google Cloud (`docs/GUIA-INSTALACAO.md`).

---

## Passo 2 — Criar a máquina (VPS)

1. Entra em **cloud.oracle.com** com o Cloud Account Name, o email e a senha.
2. Menu ☰ → **Compute** → **Instances** → **Create instance**.
3. Preenche:

| Campo | O que escolher |
|---|---|
| **Name** | `pacotinho` |
| **Image** → Change image | **Ubuntu** → **Canonical Ubuntu 24.04** |
| **Shape** → Change shape | ⚠️ **Ampere** → **VM.Standard.A1.Flex** → **1 OCPU** e **6 GB** de memória. Tem de aparecer a etiqueta **"Always Free-eligible"**. |
| **Networking** | Deixa **"Create new virtual cloud network"** e confirma que está marcado **"Assign a public IPv4 address"** |
| **Add SSH keys** | ⚠️ **Generate a key pair for me** → carrega em **Save private key** e em **Save public key**. **Guarda bem estes ficheiros: sem a chave privada não consegues entrar na máquina.** |
| **Boot volume** | Deixa como está |

4. Carrega em **Create**. Quando o estado mudar para **Running** (verde), copia o **Public IP address**, por exemplo `129.151.x.x`.

> **"Out of capacity for shape VM.Standard.A1.Flex"?** É comum: muita gente quer a máquina ARM. Tens duas opções:
> - Tenta outra vez noutro **Availability Domain** (AD-2, AD-3), ou daqui a umas horas.
> - Ou muda o **Shape** para ⚠️ **Specialty and previous generation → VM.Standard.E2.1.Micro** (AMD, 1 GB, também Always Free). Chega para começar: o instalador acrescenta memória extra.

---

## Passo 3 — Proteger a máquina para não ser apagada (recomendado)

A Oracle apaga máquinas grátis que passem 7 dias com pouco uso de processador. O bot usa muito pouco, por isso estaria em risco. A solução que a Oracle oferece:

1. Menu ☰ → **Billing & Cost Management** → **Upgrade and Manage Payment** → **Upgrade to Pay As You Go**.
2. **Continuas sem pagar nada**: os recursos "Always Free" continuam grátis. A diferença é que a Oracle deixa de apagar máquinas paradas.
3. Para ficares descansado, cria um alerta:
   - **Billing & Cost Management** → **Budgets** → **Create Budget**.
   - Valor: **1 USD**.
   - Recebes um email se algo começar a custar dinheiro.

> Só cobra se criares coisas fora do "Always Free". Seguindo este guia, não crias.

---

## Passo 4 — Abrir as portas 80 e 443 no painel da Oracle

A Oracle bloqueia tudo por omissão. Esta é a primeira das duas firewalls; a segunda, dentro da máquina, o instalador abre sozinho.

1. Na página da instância `pacotinho`, em **Primary VNIC**, carrega no nome da **Subnet**.
2. Abre **Security** (ou **Security Lists**) → **Default Security List for vcn-…**.
3. **Add Ingress Rules** e preenche:
   - **Source CIDR:** `0.0.0.0/0`
   - **IP Protocol:** `TCP`
   - **Destination Port Range:** `80,443`
4. Carrega em **Add Ingress Rules**.

---

## Passo 5 — Entrar na máquina

### No Windows (PowerShell)
1. Muda o nome da chave privada que descarregaste para `pacotinho.key` e deixa-a na pasta **Transferências** (Downloads).
2. Abre o **PowerShell**: Iniciar → escreve "PowerShell".
3. Cola estas linhas, uma de cada vez. Na terceira, troca `O-TEU-IP` pelo IP do passo 2.
```powershell
cd $HOME\Downloads
icacls pacotinho.key /inheritance:r /grant:r "$($env:USERNAME):(R)"
ssh -i pacotinho.key ubuntu@O-TEU-IP
```
4. Se perguntar *"Are you sure you want to continue connecting?"*, escreve `yes` e Enter.

### No Mac ou Linux (Terminal)
```bash
cd ~/Downloads && chmod 600 pacotinho.key
ssh -i pacotinho.key ubuntu@O-TEU-IP
```

### No telemóvel Android (app Termius)
**Keychain** → **Import key** → escolhe o ficheiro da chave. Depois cria um **Host** com o IP, o utilizador `ubuntu` e essa chave.

Quando vires algo como `ubuntu@pacotinho:~$`, estás dentro da máquina. ✅

---

## Passo 6 — Supabase e DuckDNS

Faz os **passos 1 e 2 do guia do Google** (`docs/GUIA-INSTALACAO.md`), com uma diferença:
- **Supabase → Region:** escolhe a região **mais perto de Joanesburgo** que aparecer na lista, normalmente **Central EU (Frankfurt)** ou **West EU (London)**. Se a tua máquina ficou em Frankfurt ou Londres, escolhe essa mesma.

No fim tens de ter guardados: a **DATABASE_URL** (Session pooler), o **subdomínio** e o **token** do DuckDNS.

---

## Passo 7 — Instalar o Pacotinho Já

Na janela da máquina (passo 5), cola um comando de cada vez:

```bash
sudo apt-get update && sudo apt-get install -y git
```

```bash
git clone -b ccr-fc6d0dbd-y03zgb https://github.com/Henriquest-Dev/botwhats-.git pacotinho
```
> Se pedir Username e Password, usa o teu utilizador do GitHub e um **token** em vez da senha. Explicação completa no passo 4 do guia do Google.

```bash
cd pacotinho && sudo bash deploy/install.sh
```

O instalador:
- abre a **segunda firewall** da Oracle sozinho;
- faz-te 5 perguntas: subdomínio DuckDNS, token DuckDNS, palavra-passe do painel, ligação do Supabase e chave da NVIDIA (Enter para deixar sem IA);
- termina com:
```
✅ Pronto!
   Painel:  https://O-TEU-SUBDOMINIO.duckdns.org/admin
```

---

## Passo 8 — Ligar o número do bot e o site

Segue os **passos 5 e 6 do guia do Google**: são iguais.
1. Abre o painel, entra e preenche **Planos e definições → Os teus dados**.
2. **Números do bot** → escreve o número → **Pedir código de ligação** → no telemóvel do bot: **Dispositivos ligados → Ligar com número de telefone**.
3. Site público na Netlify: troca `SEU-SUBDOMINIO` no ficheiro `netlify.toml` e liga a Netlify ao GitHub.

---

## No dia-a-dia

Entra na máquina como no passo 5 e usa:

| Quero… | Comando |
|---|---|
| Ver o bot a trabalhar, em directo | `sudo journalctl -u pacotinho -f` (sai com Ctrl+C) |
| Instalar uma actualização | `cd ~/pacotinho && git pull && sudo bash deploy/update.sh` |
| Reiniciar o bot | `sudo systemctl restart pacotinho` |
| Mudar a palavra-passe ou a chave da IA | `cd ~/pacotinho && sudo bash deploy/install.sh` |

Também podes abrir `https://O-TEU-SUBDOMINIO.duckdns.org/api/health` no browser para ver se está tudo a funcionar.

---

## Problemas típicos da Oracle

| Problema | Solução |
|---|---|
| "Out of capacity" ao criar a máquina | Tenta outro Availability Domain, tenta mais tarde, ou usa a **VM.Standard.E2.1.Micro** (passo 2). |
| `Permission denied (publickey)` no SSH | A chave não é a certa, ou o utilizador não é `ubuntu`. Confirma que usas a **chave privada** (não a `.pub`). |
| `WARNING: UNPROTECTED PRIVATE KEY FILE` | Corre outra vez a linha `icacls` (Windows) ou `chmod 600` (Mac/Linux). |
| O painel não abre ("site can't be reached") | Faltou o **passo 4** (Security List com 80 e 443). |
| O painel abre mas sem cadeado https | Espera 2 minutos depois da instalação. Confirma que o DuckDNS tem o IP certo: o instalador mostra "DuckDNS recusou" se algo falhar. |
| Recebeste um email a dizer que a máquina vai ser apagada por estar parada | Faz o **passo 3** (Pay As You Go). Os dados estão no Supabase e não se perdem. |

## Mudar de servidor no futuro
Os revendedores, os pagamentos e a sessão do WhatsApp ficam no Supabase. Para mudar para outra máquina (Oracle, Google, Hetzner…):
1. Repete o passo 7 na máquina nova, com a **mesma DATABASE_URL** e o **mesmo DuckDNS**.
2. Apaga a máquina antiga.

O bot continua no mesmo número, sem precisares de o voltar a ligar.
