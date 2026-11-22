# BotMegas

Bot de WhatsApp que **vendes por assinatura** a revendedores de megas em Moçambique.

- **Tu** tens um ou mais números de bot, um **site** para convencer revendedores e um **painel** (`/admin`) para gerir assinaturas, pagamentos e fraudes. Os dados ficam no **Supabase**.
- **O revendedor** não precisa de site nem de instalar nada. Recebe de ti um código, adiciona o número do bot ao grupo dele e escreve `!ativar MZ-7K2Q`. A partir daí, o bot atende o grupo enquanto a assinatura estiver paga.

## Como funciona o negócio

1. **Painel → Revendedores → Novo revendedor.** Escolhes o plano e registas o primeiro pagamento.
2. O painel gera o **código de activação** e uma mensagem pronta. Tocas em **Enviar pelo WhatsApp**.
3. O revendedor adiciona o número do bot ao grupo, torna-o administrador e escreve `!ativar MZ-XXXX`.
4. **Três dias antes de acabar**, o bot avisa o revendedor (e a ti) com os teus dados de pagamento.
5. Quando ele te paga, abres o revendedor e carregas em **Registar pagamento**. Os dias somam-se à data de fim e ele recebe a confirmação no WhatsApp.
6. Se não pagar, o bot **pára nos grupos dele** e avisa-o uma vez. Quando pagar, volta logo, com os pedidos e preços como estavam.

Cada plano define quantos grupos o revendedor pode activar. Para mudar de grupo, ele escreve `!desativar` no antigo.

## O que o bot faz nos grupos

- Lê o SMS do **M-Pesa, e-Mola e mKesh**, responde "✅ recebido, estás na posição 2", avisa o revendedor no privado e, quando ele escreve `ok 48`, avisa o cliente.
- **Anti-fraude:** bloqueia comprovativos repetidos e aceita denúncias (`denunciar 84… motivo`) e verificações (`verificar 84…`). A **lista negra é partilhada** por todos os grupos, e quem está banido é expulso automaticamente.
- **Segundo administrador:** `!remover`, `!adicionar`, `!advertir` (3 advertências = removido), `!fechargrupo`, `!aviso`, `!antilink`, `!boasvindas` e `!preco`. São comandos só para o revendedor.
- **IA (NVIDIA Nemotron):** responde a perguntas com os preços reais. O revendedor pode dar ordens como "bot, põe o 2GB a 85".

Os comandos que o revendedor pode usar no privado do bot: `ajuda`, `assinatura`, `fila`, `vendas`, `ok 12`, `rejeitar 12 motivo`, `!preco …`.

## Experimentar já (sem WhatsApp nem Supabase)

```bash
npm install
npm run demo
```
- Site: http://localhost:3000
- Painel: http://localhost:3000/admin (palavra-passe `demo`)

Na demonstração, o WhatsApp é simulado e há 5 revendedores de exemplo com grupos, pedidos e pagamentos.

## Pôr a funcionar a sério

### 1. Supabase
1. Cria um projecto em [supabase.com](https://supabase.com) (o plano grátis chega para começar).
2. Em **SQL Editor**, cola o conteúdo de `supabase/schema.sql` e carrega em **Run**. O servidor também cria as tabelas sozinho ao arrancar.
3. Em **Project Settings → Database → Connection string**, copia o URI do **Session pooler** e põe-no em `DATABASE_URL`.

As tabelas ficam com RLS ligado e sem políticas, por isso a chave pública do Supabase não consegue ler nada. Podes consultar tudo no **Table Editor** do Supabase: `resellers`, `payments`, `groups`, `orders`, `fraud_reports`, `banned_numbers`…

### 2. Servidor (sempre ligado)
```bash
cp .env.example .env     # preenche ADMIN_PASSWORD, DATABASE_URL e, se quiseres, NVIDIA_API_KEY
npm install
node --env-file=.env src/index.js
```
Ou com Docker:
```bash
docker build -t botmegas .
docker run -d --restart=always -p 3000:3000 -v botmegas-data:/data --env-file .env --name botmegas botmegas
```
A pasta `data/bots/` guarda as **sessões do WhatsApp** dos teus números. Faz backup dela: se se perder, tens de voltar a ligar os números (mais nada se perde, porque o resto está no Supabase).

### 3. Ligar o número do bot
Painel → **Números do bot** → escreve o número → aparece um código. No telemóvel desse número: **WhatsApp → Dispositivos ligados → Ligar um dispositivo → Ligar com número de telefone** e escreve o código.

> Usa números **só para o bot** (de preferência WhatsApp Business). Se um número for bloqueado, liga outro. Os revendedores só precisam de adicionar o novo número ao grupo.

### 4. Endereço sem comprar domínio
- **VPS:** Oracle Cloud "Always Free" (grátis) ou Hetzner/Contabo (~5 €/mês).
- **https sem domínio:** `cloudflared tunnel --url http://localhost:3000` dá-te um endereço `https://….trycloudflare.com`. Põe `HTTPS=1` no `.env`.
- Não uses Render/Heroku grátis: "adormecem" e o bot desliga.

## Estrutura

```
src/
  index.js        arranque
  platform.js     revendedores, assinaturas, activação por código, encaminhamento
  connection.js   ligação de cada número de bot ao WhatsApp (Baileys)
  bot.js          lógica de cada grupo: pedidos, moderação, fraudes, IA
  repo.js         Supabase/PostgreSQL (PgRepo) ou ficheiro local (JsonRepo)
  server.js       site público + API do painel
  parser.js       leitura de comprovativos
  fraud.js        denúncias + lista negra
  ai.js           cliente da IA (Nemotron / compatível com OpenAI)
  messages.js     textos do bot (edita à vontade)
  demo.js, fake-socket.js   demonstração
public/
  index.html, site.css, site.js      site público
  admin.html, admin.css, admin.js    painel do dono
supabase/schema.sql
```

## ⚠️ Importante
- O bot usa o **WhatsApp Web** (biblioteca Baileys), não a API oficial. É o que permite funcionar em grupos e sem custos por mensagem. O risco é o WhatsApp bloquear um número, por isso tem números de reserva.
- O bot **não envia os megas**. O revendedor continua a enviar pelo USSD.
- Um SMS de comprovativo pode ser falsificado. O revendedor deve confirmar sempre que o dinheiro entrou.

## Testes
```bash
npm test     # 39 testes, incluindo PostgreSQL real (PGlite) com o esquema do Supabase
```
