# Pacotinho Já — Prompt mestre para o ChatGPT (imagens do site)

**Como usar:**
1. Abre uma conversa nova no ChatGPT e cola o **PROMPT MESTRE**. Ele responde que percebeu e não gera nada.
2. Envia as **janelas uma de cada vez, por ordem**. Começa sempre pela **Janela 0**, a mascote: ela serve de referência para as outras.
3. Se uma imagem sair "com cara de IA", responde: *"Refaz. Está genérico. Volta às regras do prompt mestre, secção O QUE É PROIBIDO."*
4. No fim, envia-me todas as imagens e eu reconstruo o site em código, igual.

---

## PROMPT MESTRE (cola isto primeiro)

```
Vais ser o director de arte de uma agência premiada (Awwwards, CSS Design Awards, FWA). Vamos desenhar, imagem a imagem, o site de um produto real. Não geres nada ainda: lê tudo, responde só "Percebido, manda a Janela 0" e espera.

## O PRODUTO
Nome: Pacotinho Já
O que é: um bot de WhatsApp que se adiciona a grupos de venda de "megas" (pacotes de internet móvel) em Moçambique. Quando o cliente cola o SMS de pagamento (M-Pesa ou e-Mola), o bot responde em segundos ("Comprovativo recebido! Pedido #48, estás na posição 2 da fila"), avisa o vendedor, confirma a entrega quando o vendedor escreve "ok 48", bloqueia burladores com uma lista negra partilhada entre todos os grupos e responde a perguntas com inteligência artificial.
Para quem é o site: revendedores de megas moçambicanos, jovens de 18 a 35 anos, empreendedores, que usam sobretudo telemóveis Android e passam o dia no WhatsApp. São desconfiados de tecnologia complicada e querem ganhar mais com menos stress.
O objectivo do site: convencer o revendedor a carregar em "Quero o Pacotinho no meu grupo", que abre uma conversa de WhatsApp com o dono.
Língua de TODO o texto nas imagens: português de Moçambique, informal ("tu"), com expressões locais ("megas", "manda o SMS", "já está", "maningue rápido").

## A MASCOTE: o Pacotinho
Uma caixinha de cartão castanho-claro (kraft), quase cúbica, com cantos ligeiramente arredondados e marcas de dobra visíveis.
- Fita adesiva por cima com padrão de capulana (motivos geométricos africanos, vermelho-tomate e azul-céu).
- Uma pequena antena com as barras de sinal de rede a sair da tampa, como um tufo de cabelo.
- Olhos grandes e expressivos, desenhados directamente no cartão; boca simples. Bracinhos e perninhas finas, de traço.
- Sapatilhas coloridas (vermelho-tomate), porque está sempre a correr para entregar.
- Personalidade: rápido, prestável, um bocado traquina, nunca infantil. Pensa no Duo do Duolingo ou no Freddie do Mailchimp, com alma de Maputo.
- Estilo de desenho: ilustração 2D com traço preto grosso e irregular (feito à mão), cores chapadas, uma sombra dura deslocada. NÃO 3D brilhante, NÃO plasticina, NÃO estilo Pixar.
- Frase da mascote: "Já está!"

## DIRECÇÃO VISUAL
Conceito: "a banca do mercado encontra o WhatsApp". O mundo visual vem de Maputo: as letras pintadas à mão nas bancas e nas barbearias, as capulanas, os chapas e as txopelas, os cartões de recarga raspados, os balões verdes do WhatsApp. Tem de parecer feito por pessoas, com orgulho local, e com o acabamento de um site premiado.

Referências de sites vencedores. Usa a ESTRATÉGIA de cada um, não copies o visual:
- Gumroad: neobrutalismo amigável (cores fortes, contornos pretos, sombras duras, botões que parecem físicos).
- Duolingo: a mascote é a protagonista emocional e reage ao que acontece.
- Mailchimp: ilustração com humor e imperfeição intencional.
- Paystack: fintech africana com tipografia grande e cores ousadas, confiança sem frieza.
- Oatly: texto honesto, divertido e escrito à mão.
- Wise e Cash App: um número enorme ou uma frase gigante como herói, contraste extremo.
- Sites Awwwards com personagem (ex.: UNLOCK YOU|WW): o personagem conduz a história.

Paleta (usa sempre esta):
- Kraft (a mascote, superfícies): #D9A066
- Tinta (traços, texto): #1C1A17
- Branco-papel (fundo principal): #FFFFFF
- Azul-céu Maputo (blocos grandes de cor): #8FD3FF
- Vermelho-tomate (acção, alertas, sapatilhas): #E8402B
- Verde-WhatsApp claro (só nos balões de conversa): #D9FDD3
Cada secção tem UMA cor dominante em bloco. Nada de gradientes.

Tipografia:
- Títulos: letra grossa e condensada, inspirada nas tabuletas pintadas à mão das bancas de Maputo, com um ligeiro desalinhamento humano. Muito grande (o título do topo ocupa metade do ecrã).
- Texto: uma sans-serif simples e muito legível (tipo Atkinson Hyperlegible ou Inter Display).
- Números (preços, posição na fila): enormes, a fazer parte do desenho.

Elementos de interface:
- Botões com contorno preto de 3px, sombra dura deslocada (4px para baixo e para a direita) e cantos pouco arredondados (8 a 10px).
- Conversas de WhatsApp desenhadas com fidelidade (balões, horas, ✓✓ azuis), porque são a prova do produto.
- Texturas leves de papel e cartão, e marcas de fita-cola a "colar" elementos.

## PSICOLOGIA E UX (obrigatório em cada janela)
- Um só objectivo por secção e UM botão principal por ecrã ("Quero o Pacotinho no meu grupo").
- Mostrar o produto a funcionar (conversas reais) em vez de prometer.
- Aversão à perda: "cada cliente sem resposta é dinheiro que vai para outro vendedor".
- Números concretos: "responde em 3 segundos", "posição 2 na fila", "300+ burladores bloqueados".
- Prova social local, com nomes e cidades moçambicanas (Matola, Beira, Nampula, Xai-Xai).
- Reduzir o medo: "não precisas de instalar nada", "não te pedimos a senha", "se não pagares, o bot simplesmente pára".
- Ordem de leitura em F ou em Z, hierarquia clara, muito espaço em branco à volta dos títulos.
- Primeiro pensado para o telemóvel: textos curtos, botões grandes para o polegar.
- Acessível: contraste alto e nada de texto cinzento-claro sobre branco.

## O QUE É PROIBIDO (o "flop de IA")
- Gradientes roxo/azul, brilhos neon, glassmorphism, fundos escuros com uma cor ácida.
- Blobs 3D abstractos, esferas brilhantes, robôs metálicos genéricos, ícones de "faísca de IA".
- Fotos de banco de imagens com pessoas sorridentes a apontar para um portátil.
- Grelha de cartões todos iguais, arredondados e com a mesma sombra cinzenta suave.
- Fundo creme com letra serifada e cor terracota.
- Título centrado com uma palavra num gradiente colorido.
- Etiquetas em MAIÚSCULAS espaçadas por cima de cada título.
- Texto inventado sem sentido (lorem ipsum, palavras deformadas). Escreve texto real e legível em português.
- Logótipos reais da Vodacom, Movitel, Tmcel, M-Pesa ou WhatsApp. Usa ícones genéricos (um balão de conversa, um telemóvel).

## FORMATO DAS IMAGENS
- Desktop: mockup de UMA secção do site, como uma captura de ecrã de um site real a 1440px de largura, proporção 3:2, sem moldura de browser.
- Telemóvel: ecrã de telemóvel em proporção 9:19, sem moldura.
- Coerência total entre janelas: a mesma mascote, a mesma paleta, os mesmos tipos de letra e os mesmos botões.
- Qualidade de site vencedor de "Site of the Day" no Awwwards.
```

---

## AS JANELAS (envia uma de cada vez)

### Janela 0 — Mascote (ficha de personagem)
```
Janela 0. Desenha a ficha de personagem do Pacotinho sobre fundo branco: de frente, de lado e de costas, mais 6 expressões e poses. A correr com uma caixinha de megas debaixo do braço; a acenar; a segurar um telemóvel com um balão "Já está!"; desconfiado, de lupa na mão a olhar para um SMS (anti-fraude); a festejar com confetes; a dormir em cima de um "Zzz" (bot em pausa). Segue exactamente a descrição da mascote e o estilo de traço do prompt mestre. Esta é a referência para todas as próximas imagens.
```

### Janela 1 — Topo da página (herói), desktop
```
Janela 1. Herói da homepage, desktop. Fundo azul-céu em bloco. À esquerda, um título gigante em letra pintada de tabuleta: "Tu vendes os megas. O Pacotinho atende o grupo." Por baixo, uma frase curta: "Responde aos clientes em segundos, organiza a fila e bloqueia burladores. Dentro do teu grupo de WhatsApp." Um botão principal vermelho-tomate com contorno preto e sombra dura: "Quero o Pacotinho no meu grupo". Ao lado, um link discreto: "Ver preços". Por baixo do botão, uma prova social pequena: "Já a trabalhar em 120 grupos, de Maputo a Nampula". À direita, um telemóvel com uma conversa de grupo real: o cliente cola o SMS do M-Pesa e o Pacotinho responde "Comprovativo recebido! Pedido #48, posição 2 na fila, cerca de 6 min". A mascote Pacotinho sai de trás do telemóvel a correr, com o balão "Já está!". No topo, uma barra de navegação simples com o logótipo em letra pintada: "Pacotinho Já".
```

### Janela 2 — O problema (o caos do grupo)
```
Janela 2. Secção "O problema", desktop, fundo branco. Uma parede de balões de WhatsApp desordenados, sobrepostos e inclinados, como notas coladas com fita-cola, com mensagens de clientes zangados: "Já mandei o comprovativo há 20 min!", "Mandaste para que número??", "Esse print está editado", "Paguei e ninguém responde 😤", "Ainda tem 5GB?". No meio do caos, o Pacotinho com cara de stressado, a fazer malabarismo com telemóveis. Título grande à esquerda: "Um grupo de megas sem ajuda é isto." Subtítulo: "Cada cliente sem resposta vai comprar a outro vendedor."
```

### Janela 3 — Como funciona (3 passos)
```
Janela 3. Secção "Como funciona", desktop, fundo amarelo-kraft (#D9A066) em bloco. Título: "Fica a funcionar em 2 minutos". Três passos ligados por uma linha tracejada desenhada à mão, numerados 1, 2 e 3 em círculos grandes. 1: "Escolhes o plano e pagas por M-Pesa ou e-Mola". 2: "Adicionas o número do Pacotinho ao teu grupo". 3: "Escreves no grupo: !ativar MZ-7K2Q", com um balão verde de WhatsApp a mostrar essa mensagem e a resposta "Bot activado!". O Pacotinho aparece em cada passo a fazer a acção (a receber dinheiro, a entrar no grupo por uma porta, a festejar).
```

### Janela 4 — O que o bot faz (funcionalidades)
```
Janela 4. Secção "O que o Pacotinho faz por ti", desktop. NÃO uses uma grelha de cartões iguais. Desenha como uma fila de bancas de mercado, cada uma com uma tabuleta pintada à mão e de tamanho e cor diferente, e cada banca mostra uma funcionalidade com um mini-ecrã real:
- "Lê o SMS sozinho": um SMS do M-Pesa com o ID da transacção, o valor e o número sublinhados com marcador colorido.
- "Fila organizada": uma lista #47 enviado, #48 a preparar, #49 na fila.
- "Tu só escreves ok 48": um balão do vendedor "ok 48" e a resposta "Pedido #48 concluído!".
- "Responde a perguntas": "tem 5gb? quanto é" e o Pacotinho a responder com o preço.
- "Segundo administrador": comandos como etiquetas: !remover, !aviso, !fechargrupo, !preco.
O Pacotinho passeia entre as bancas.
```

### Janela 5 — Anti-fraude e lista negra
```
Janela 5. Secção anti-fraude, desktop, fundo vermelho-tomate em bloco com texto branco. À esquerda, um número gigante: "327". Ao lado: "burladores bloqueados em todos os grupos". Título: "Quem burla num grupo fica bloqueado em todos." Texto: "A lista negra é partilhada por todos os vendedores do Pacotinho. O mesmo comprovativo nunca passa duas vezes." À direita, o Pacotinho com cara de detective (chapéu e lupa) ao lado de um cartaz de "PROCURADO" com um número de telefone parcialmente escondido (84 ••• 5544) e o carimbo "BANIDO". Por baixo, uma conversa: "verificar 84 777 8899" e a resposta "🚫 Banido: comprovativos falsos".
```

### Janela 6 — Preços
```
Janela 6. Secção de preços, desktop, fundo branco. Três planos desenhados como cartões de recarga físicos (com entalhes laterais, linha picotada e uma faixa prateada de "raspa aqui"), ligeiramente inclinados como se estivessem pousados numa banca. Semanal: 150 MT, 1 grupo. Mensal: 450 MT, 2 grupos, com uma etiqueta de fita-cola "O mais escolhido" e destaque a azul-céu. Pro: 1200 MT, até 6 grupos. Cada cartão lista: pedidos ilimitados, lista negra partilhada, assistente com IA. Cada cartão tem um botão "Escolher Mensal" (etc.). O Pacotinho espreita por cima do cartão do meio. Frase por baixo: "Sem contrato. Se não renovares, o bot simplesmente pára."
```

### Janela 7 — Prova social e perguntas
```
Janela 7. Secção de testemunhos e perguntas frequentes, desktop. Em cima, 3 testemunhos em forma de capturas de ecrã de mensagens de WhatsApp de revendedores, com nome e cidade ("Zé, Matola: Agora durmo descansado, o bot responde por mim", "Amina, Beira: Os clientes já não me chateiam a perguntar se recebi", "Celso, Nampula: Apanhei 2 burladores na primeira semana"), coladas com fita-cola num quadro de cortiça. Em baixo, um acordeão de perguntas frequentes, com o primeiro item aberto: "O bot envia os megas sozinho?", resposta: "Não. Tu continuas a enviar pelo USSD; o Pacotinho trata de tudo à volta." Outras perguntas fechadas: "Preciso de dar a minha senha?", "Funciona com Vodacom, Tmcel e Movitel?", "E se o cliente mandar print?".
```

### Janela 8 — Fecho e rodapé
```
Janela 8. Última secção e rodapé, desktop, fundo azul-céu. Título gigante em letra pintada: "O teu grupo pode estar a trabalhar sozinho ainda hoje." Botão grande vermelho-tomate: "Falar com o Pacotinho no WhatsApp". O Pacotinho de pé em cima do botão a acenar, com a frase "Já está!". Rodapé simples em fundo de tinta: logótipo "Pacotinho Já", "Feito em Moçambique 🇲🇿" e os links Preços, Perguntas e Entrar no painel.
```

### Janela 9 — Telemóvel: topo e preços
```
Janela 9. Duas capturas lado a lado da versão de telemóvel (proporção 9:19 cada). Ecrã 1: o herói adaptado ao telemóvel: título em 3 linhas, botão vermelho grande à largura do ecrã, conversa de WhatsApp por baixo e o Pacotinho a espreitar no canto. Ecrã 2: os preços em cartões de recarga empilhados, com o Mensal em destaque. Mesmos estilos, fontes e cores das janelas anteriores.
```

### Janela 10 — Painel do dono (opcional)
```
Janela 10. O painel de administração do dono (desktop), no mesmo estilo mas mais calmo e funcional. Barra lateral em tinta com o logótipo "Pacotinho Já" e os menus Resumo, Revendedores, Pagamentos, Números do bot, Fraudes, Planos. Ao centro: um bloco azul-céu com "Recebido em Novembro: 12 450 MT", números de revendedores activos (38), grupos com bot (61) e pedidos hoje (412). Um gráfico de barras de pagamentos dos últimos 30 dias, numa só cor. Uma lista "A expirar esta semana" com etiquetas "2 dias" e "Expirado". Um cartão com o código de activação "MZ-7K2Q" e o botão "Enviar pelo WhatsApp". O Pacotinho pequenino no canto, a beber um sumo, como um "tudo em ordem".
```

---

### Porquê estas escolhas (a pesquisa)
- **"Anti-AI Crafting"** é a grande tendência de 2026: afastar-se do visual polido de máquina e mostrar trabalho humano, com traço irregular, letras feitas à mão e cores imperfeitas (Creative Bloq, Nielsen Norman Group).
- **O maximalismo funciona melhor como acento.** Uma secção dramática bate um site inteiro a competir por atenção, por isso cada janela tem UMA cor dominante.
- **Neobrutalismo amigável.** O Gumroad é o exemplo mais citado: contornos fortes, sombras duras, cores que chocam.
- **Fintech africana.** A Paystack usa letra grande e cores ousadas. Num estudo de redesenho para a Moniepoint, a lição foi que a confiança tem de ligar emocionalmente com quem usa serviços digitais pela primeira vez.
- **Mostrar o produto bate ilustrações conceptuais no herói.** Por isso a conversa real de WhatsApp é sempre a prova principal, e a mascote é o "acompanhante".
