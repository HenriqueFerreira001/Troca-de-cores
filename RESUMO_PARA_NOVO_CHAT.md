# RESUMO COMPLETO — AGENTE TIKTOK SHOP COM IA
# Cole este arquivo inteiro em um novo chat do Claude

---

## O QUE JÁ EXISTE E FUNCIONA

Tenho um agente em JavaScript/Node.js com interface de comandos no terminal.
O arquivo se chama `agente_tiktok.js` e já está funcionando com estes comandos:

```
> analisar       — Abre o Kalodata e busca os 7 melhores produtos
> continuar      — Digito após passar o Cloudflare no navegador
> gerar          — Gera vídeos no Gemini para cada produto encontrado
> gerar 3        — Gera apenas 3 vídeos
> status         — Mostra produtos na memória
> historico      — Mostra produtos já usados (não repete em 30 dias)
> relatorio      — Relatório do dia
> agendar 09:00  — Agenda para rodar todo dia às 9h
> ajuda          — Lista todos os comandos
> sair           — Encerra o agente
```

---

## STACK TÉCNICA

- Node.js + JavaScript
- Playwright (automação do navegador)
- Microsoft Edge (único navegador do usuário — não tem Chrome)
- Windows 11
- Pasta: C:\PROJETOS\troca de cores\Troca-de-cores-main

---

## FLUXO ATUAL (o que já funciona)

1. Usuário digita `analisar`
2. Agente abre o Edge no Kalodata automaticamente
3. Cloudflare aparece — usuário clica em "Confirme que é humano" (1 clique)
4. Usuário digita `continuar` — terminal nunca trava
5. Agente analisa a página, filtra roupas femininas, pega os 7 melhores produtos
6. Usuário digita `gerar`
7. Agente abre o Gemini e gera um vídeo para cada produto
8. Salva screenshots, relatório e notifica no Telegram

---

## PROBLEMAS JÁ RESOLVIDOS

✅ Terminal não trava mais (usa comando "continuar" em vez de ENTER)
✅ Filtra textos de interface do Kalodata ("Product Info", etc)
✅ Prioriza roupas femininas automaticamente
✅ Histórico de 30 dias (nunca repete produto)
✅ Usa Microsoft Edge em vez de Chrome

---

## PROBLEMA ATUAL — GEMINI PRECISA DE PLANO PAGO

O Gemini exige plano pago (Gemini Advanced/Pro) para gerar vídeos com Veo3.
O usuário tem o plano Pro mas o agente está dando timeout na geração do vídeo.

Possíveis causas:
- O Gemini não está logado no navegador do agente
- O plano Pro não inclui Veo3 (só o Advanced inclui)
- O seletor do campo de texto do Gemini pode ter mudado

---

## O QUE PRECISA SER FEITO

### 1. RESOLVER A GERAÇÃO DE VÍDEO NO GEMINI
O agente já abre o Gemini, digita o prompt e envia.
Mas o vídeo nunca é gerado (timeout de 3 minutos).
Precisa verificar:
- Se o login está sendo mantido corretamente
- Se o prompt está sendo digitado no campo certo
- Se o Gemini está respondendo com erro ou só carregando

### 2. TORNAR O AGENTE 100% AUTOMÁTICO
O único passo manual ainda é o Cloudflare (1 clique).
Idealmente o agente detectaria quando o Cloudflare passou e continuaria sozinho,
sem precisar do comando "continuar".

### 3. MELHORAR A SELEÇÃO DE PRODUTOS
O Kalodata às vezes retorna produtos que não são roupas femininas
(bicicleta, camiseta masculina, etc).
Precisa aplicar o filtro de categoria automaticamente ou ser mais inteligente
na seleção.

---

## PROMPT DE VÍDEO QUE FUNCIONA BEM

```
Generate a vertical 9:16 video for TikTok: Vertical mirror selfie in a bedroom 
with soft natural lighting. A young woman wearing [PRODUTO] holds her phone in 
front of her face, filming her reflection in a full-length mirror. Full body 
frontal pose, slight weight shift, small clothing adjustment. She takes a small 
step toward the mirror with a light body sway to show how the clothing drapes 
and moves, then slowly turns to a side profile showing the silhouette of the 
outfit in the mirror. Relaxed, natural posture. Authentic TikTok fitting room 
style, UGC handheld creator style, natural lighting. Audio: soft bedroom ambient 
sound, light breathing, soft footsteps on floor, no speech, no music.
```

O prompt é adaptado automaticamente conforme o tipo de roupa:
- Vestido → "twirling slightly to show the dress flow"
- Calça/Legging → "emphasizing the fit of the pants"
- Blusa/Camiseta → "showing upper body and tucking the top"
- Jaqueta/Casaco → "opening and closing the jacket to show the full look"

---

## COMO RODAR

```powershell
# Na pasta do projeto:
node agente_tiktok.js
```

---

## DEPENDÊNCIAS (já instaladas)

```
npm install playwright
npx playwright install chromium
```

---

## OBJETIVO FINAL

Um agente 100% autônomo que:
1. Acorda todo dia no horário configurado
2. Abre o Kalodata e pega os 7 produtos de roupas femininas mais vendidos
3. Gera um vídeo TikTok vertical 9:16 para cada produto no Gemini
4. Salva tudo e notifica no Telegram
5. O único passo manual é o Cloudflare (1 clique)

---

## PERGUNTA PARA O NOVO CHAT

Com base em tudo acima, preciso que você:

1. Me ajude a resolver o problema do Gemini não gerar o vídeo
   (timeout de 3 minutos sem resultado)

2. Me mostre como verificar se o login do Gemini está funcionando
   dentro do Playwright com Edge

3. Se o Gemini Pro não suportar Veo3, me indique a melhor alternativa
   gratuita ou barata para geração de vídeos TikTok com IA que funcione
   via automação com Playwright

4. Se possível, faça o agente detectar automaticamente quando o Cloudflare
   passou, sem precisar do comando "continuar"
