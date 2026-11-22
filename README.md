# 🤖 Bot de Megas — WhatsApp

Bot para quem **revende megas** (Vodacom, Tmcel, Movitel) em grupos ou no privado do WhatsApp.

Quando o cliente envia o comprovativo (SMS do M-Pesa / e-Mola / mKesh) e o número, o bot:

1. **Responde na hora:** "✅ Comprovativo recebido! Pedido #12 — estás na posição 3 da fila, tempo estimado ~9 min. Aguarda."
2. **Avisa-te no privado** com o pacote, o valor, o ID da transacção e o número para onde mandar os megas.
3. Envias os megas como sempre e respondes **`ok 12`**. O bot avisa o cliente: "🎉 Pedido #12 concluído!"

### O que o bot faz
- Lê SMS de **M-Pesa, e-Mola e mKesh** (valor, ID da transacção, para quem foi pago)
- **Bloqueia comprovativos repetidos** (o mesmo ID usado duas vezes)
- Alerta quando o pagamento foi feito **para um número que não é teu**
- Reconhece o **pacote pelo valor** pago
- Se faltar o número, **pergunta** ("responde SIM para enviar para o teu número")
- Aceita **prints** (imagens): reencaminha-os para ti, para verificares
- **Fila com posição e tempo estimado**
- **Lembra-te** de pedidos parados há mais de 10 min
- Horário de funcionamento e comando para **pausar** as vendas
- **Resumo de vendas** do dia
- Em grupos, **ignora a conversa normal** e só reage a comprovativos e comandos

## Comandos

**Clientes:** `menu` (pacotes e preços) · `estado` (os seus pedidos)

**Vendedor** (a partir do número do bot ou de um número em `admins`):

| Comando | O que faz |
|---|---|
| `ok 12` | Marca como enviado e avisa o cliente |
| `ok 12 13 14` | Vários pedidos de uma vez |
| `rejeitar 12 o pagamento não caiu` | Rejeita e avisa o cliente com o motivo |
| `fila` | Lista os pedidos pendentes |
| `pedido 12` | Detalhes de um pedido |
| `vendas` | Resumo de hoje |
| `pausar` / `retomar` | Pausa/retoma as vendas |
| `ajuda` | Lista os comandos |

## Instalação

Precisas de um computador ou servidor (VPS) **sempre ligado**, com **Node.js 20+**.

```bash
git clone <este repositório> botwhats && cd botwhats
npm install
cp config.example.json config.json   # edita: nome, os teus números, pacotes e preços
npm start
```

Na primeira vez aparece um **QR code**. No telemóvel: **WhatsApp → Dispositivos ligados → Ligar dispositivo** e lê o código. A sessão fica guardada na pasta `auth/`, por isso não precisas de ler o QR outra vez.

> 💡 O mais prático é usar um **número só para o bot** (por exemplo, um WhatsApp Business num segundo chip) e pôr o teu número pessoal em `admins`.

### Manter o bot sempre ligado (VPS)
```bash
npm install -g pm2
pm2 start src/index.js --name botmegas
pm2 save && pm2 startup
pm2 logs botmegas      # ver o que está a acontecer
```

## Configuração (`config.json`)

| Campo | Para que serve |
|---|---|
| `businessName` | Nome que aparece no menu |
| `admins` | Números que recebem os avisos e podem dar comandos (sem 258). Vazio = o próprio número do bot |
| `groups` | IDs dos grupos onde o bot actua. Vazio = todos. Para ver os IDs: `node src/index.js --grupos` |
| `paymentAccounts` | Os teus números de M-Pesa/e-Mola/mKesh (usados no menu e para detectar pagamentos para o número errado) |
| `packages` | Pacotes e preços. O bot descobre o pacote pelo valor pago, por isso **cada preço deve ser único** |
| `minutesPerOrder` | Minutos por pedido, para calcular o tempo estimado |
| `reminderMinutes` | Ao fim de quantos minutos te lembra de um pedido parado |
| `hours` | Horário de funcionamento (`null` = 24h) |
| `acceptImageProofs` | Aceitar prints como comprovativo |
| `replyUnknownInPrivate` | No privado, responder com o menu a mensagens que não percebe |

Os textos das mensagens estão em `src/messages.js`. Podes mudá-los à vontade.

## ⚠️ Importante
- O bot usa o **WhatsApp Web** (biblioteca Baileys), que não é a API oficial. Funciona em grupos e não tem custos, mas o WhatsApp pode bloquear números que enviem spam. O bot só responde a quem lhe escreve, o que é seguro. Mesmo assim, não o uses para enviar mensagens em massa.
- O bot **não envia os megas sozinho**. O envio continua a ser feito por ti (USSD), mas toda a gestão de clientes, fila e confirmações fica automática.
- Confirma sempre no teu telemóvel que o dinheiro **entrou de facto**. Um SMS de comprovativo pode ser falsificado.

## Testes
```bash
npm test
```
