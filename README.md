# 🤖 BotMegas: bot de WhatsApp para revendedores de megas

Sistema completo para quem **revende megas** (Vodacom, Tmcel, Movitel) em grupos de WhatsApp:

- 🌐 **Site com login pelo número.** O vendedor escreve o número, recebe um código, liga o WhatsApp e escolhe os grupos. Não precisa de instalar nada.
- 🧾 **Gestão de pedidos.** Lê o SMS do M-Pesa/e-Mola/mKesh, responde "✅ recebido, estás na posição 3, ~9 min", avisa o vendedor e, quando ele responde `ok 12`, avisa o cliente.
- 🛡️ **Anti-fraude.** Denúncias de clientes, verificação de números, **lista negra partilhada entre todos os vendedores**, bloqueio de comprovativos repetidos e expulsão automática de burladores.
- 👮 **Segundo administrador.** Remove, adiciona, adverte (3 advertências = removido), fecha e abre o grupo, faz anúncios a todos, tem anti-link e dá boas-vindas.
- 🤖 **IA (NVIDIA Nemotron).** Responde a perguntas no grupo ("quanto custa 5GB?") com a tabela real. O dono pode dar ordens em linguagem natural: *"bot, põe o 2GB a 85"*.

## Experimentar já (sem WhatsApp)

```bash
npm install
DEMO=1 npm start
```
Abre http://localhost:3000 e entra com qualquer número. O WhatsApp é simulado, por isso a ligação acontece sozinha após 8 segundos e aparecem 3 clientes de exemplo.

## Pôr a funcionar a sério

Precisas de um servidor **sempre ligado** com Node.js 20+ (ver *Alojamento* abaixo).

```bash
git clone <este repositório> botmegas && cd botmegas
npm install
cp .env.example .env        # põe a tua NVIDIA_API_KEY
node --env-file=.env src/index.js
```

Ou com Docker:
```bash
docker build -t botmegas .
docker run -d --restart=always -p 3000:3000 -v botmegas-data:/data --env-file .env --name botmegas botmegas
```

### Como o vendedor instala o bot (1 minuto)
1. Abre o site e escreve o número do WhatsApp.
2. Aparece um código (ex: `K7QD-2M9X`). No telemóvel: **WhatsApp → Dispositivos ligados → Ligar um dispositivo → Ligar com número de telefone** e escreve o código.
3. O painel abre sozinho. No separador **Grupos**, activa os grupos onde vende.
4. Pronto. Nas próximas vezes, o login é feito com um código de 6 dígitos que o bot envia para o próprio WhatsApp do vendedor.

## Alojamento sem comprar domínio

| Opção | Custo | Notas |
|---|---|---|
| **Oracle Cloud "Always Free"** | grátis | VPS que fica sempre ligado. Bom para começar. |
| VPS barato (Hetzner, Contabo…) | ~4–6 €/mês | Mais estável. |
| PC em casa sempre ligado | luz + internet | Funciona, mas cai se faltar a corrente. |

Para ter um endereço **https** sem domínio, usa o **Cloudflare Tunnel** (grátis):
```bash
cloudflared tunnel --url http://localhost:3000
# dá um endereço tipo https://palavras-aleatorias.trycloudflare.com
```
Depois põe `HTTPS=1` no `.env`. ⚠️ Não uses Render/Heroku grátis: "adormecem" e o bot desliga.

## Comandos no WhatsApp

**Clientes:** `menu` · `estado` · `denunciar 84XXXXXXX motivo` (ou responder à mensagem da pessoa) · `verificar 84XXXXXXX`

**Administrador** (o próprio número do bot ou os números em "Administradores"). Se um cliente tentar usar estes comandos, recebe "⛔ só para o administrador".

| Comando | O que faz |
|---|---|
| `ok 12` / `ok 12 13 14` | Pedido enviado: avisa o cliente |
| `rejeitar 12 motivo` | Rejeita e avisa o cliente |
| `fila` · `pedido 12` · `vendas` | Fila, detalhes, resumo do dia |
| `pausar` / `retomar` | Pausa as vendas |
| `!preco 1GB Vodacom 50 \| 24h` | Cria/muda pacote na tabela |
| `!removerpacote 1GB Vodacom` | Remove pacote |
| `!remover @pessoa` | Remove do grupo (ou responde à mensagem) |
| `!adicionar 84XXXXXXX` | Adiciona (recusa se estiver banido) |
| `!advertir @pessoa motivo` | Advertência; ao fim de 3 é removido |
| `!fechargrupo` / `!abrirgrupo` | Só admins escrevem / todos escrevem |
| `!aviso texto` | Anúncio que menciona todos |
| `!antilink on\|todos\|off` | Apaga links de grupos (ou todos os links) |
| `!boasvindas Olá {nome}! {menu}` | Mensagem para quem entra (`off` desliga) |
| `!banir 84XXXXXXX motivo` | Lista negra + remove dos grupos + alerta |
| `!desbanir 84XXXXXXX` · `!denuncias` | |
| `!ia on\|off` | Liga/desliga a IA neste grupo |
| `bot, …` | Fala com a IA (ex: "bot, põe o 5GB a 190") |

## A IA

Usa a API da NVIDIA (`NVIDIA_API_KEY`, gratuita para começar em [build.nvidia.com](https://build.nvidia.com)). Confirma lá o nome exacto do modelo Nemotron e põe-no em `AI_MODEL`. Também funciona com qualquer serviço compatível com a API da OpenAI (muda `AI_BASE_URL`).

No grupo, a IA só responde quando é **mencionada**, quando alguém **responde a uma mensagem do bot** ou a **perguntas sobre compras** ("quanto custa", "tem 5GB?"). A conversa normal é ignorada. Os clientes só podem fazer perguntas. As ferramentas que mudam preços, banem ou fazem anúncios só funcionam para o administrador, mesmo que alguém tente enganar a IA.

Sem chave, tudo o resto funciona normalmente.

## Estrutura

```
src/
  index.js      arranque (site + bots)
  server.js     API do painel
  manager.js    vendedores, login por código
  tenant.js     ligação WhatsApp de cada vendedor (Baileys)
  bot.js        lógica: pedidos, moderação, fraudes, IA
  parser.js     leitura de comprovativos
  fraud.js      denúncias + lista negra global
  ai.js         cliente da IA (Nemotron/OpenAI)
  messages.js   textos (edita à vontade)
public/         site (login + painel)
data/           dados (criado automaticamente — faz backup!)
```

## ⚠️ Importante
- Usa o **WhatsApp Web** (biblioteca Baileys), que não é a API oficial. É o que permite funcionar em grupos e sem custos, mas o WhatsApp pode bloquear números que façam spam. O bot só responde a quem lhe escreve. Recomenda aos vendedores um número dedicado ao negócio.
- O bot **não envia os megas sozinho**. Isso continua a ser feito pelo vendedor (USSD).
- Um SMS de comprovativo pode ser falsificado. O vendedor deve confirmar sempre que o dinheiro entrou.
- Faz **backup da pasta `data/`**: tem as sessões, os pedidos e a lista negra.

## Testes
```bash
npm test
```
