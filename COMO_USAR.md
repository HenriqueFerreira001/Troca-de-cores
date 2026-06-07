# Como usar o Gerador de Vídeos TikTok com IA

## O que esse script faz?

Ele automatiza 5 etapas em sequência:

1. Abre o **Kalodata** e busca os produtos mais vendidos em "Roupas Femininas" nos últimos 7 dias
2. Captura o nome/descrição do produto mais relevante
3. Abre o **Gemini** em uma nova aba
4. Digita um prompt profissional pedindo a geração de um vídeo vertical (9:16) estilo TikTok
5. Aguarda o vídeo ser gerado e salva um print da tela

---

## Instalação (faça apenas uma vez)

Abra o terminal e rode:

```bash
pip install playwright
playwright install chromium
```

---

## Como rodar

No terminal, entre na pasta do projeto e rode:

```bash
python gerar_video_tiktok.py
```

---

## Primeira vez rodando

Na primeira execução, o navegador vai abrir e pedir que você:

1. **Faça login no Kalodata** (sua conta)
2. **Faça login no Google** (para acessar o Gemini)

Depois disso, os logins ficam salvos automaticamente na pasta `perfil_navegador/`.

---

## O que aparece no terminal

Você verá mensagens assim:

```
📦 ETAPA 1: Acessando o Kalodata para buscar produtos...
   ✅ Página do Kalodata carregada.
   ✅ Produto encontrado: Vestido Midi Floral com Decote V...
🤖 ETAPA 2: Abrindo o Gemini...
   ✅ Usuário autenticado no Gemini.
✍️  ETAPA 3: Digitando prompt...
🚀 ETAPA 4: Enviando prompt para o Gemini...
⏳ Aguardando geração do vídeo (pode levar até 3 minutos)...
🎉 VÍDEO GERADO com sucesso após 87 segundos!
📸 ETAPA 5: Salvando print do resultado...
```

---

## Dúvidas comuns

**O script travou no filtro de categoria?**
O Kalodata pode ter mudado o layout. Aplique o filtro manualmente no navegador quando ele abrir.

**O Gemini pediu login?**
O script vai pausar e pedir para você fazer login manualmente. Faça login e pressione Enter no terminal.

**O vídeo não foi gerado em 3 minutos?**
Aumente o valor de `TEMPO_MAXIMO_GERACAO_VIDEO` no início do script (ex: 300 para 5 minutos).

**Quero rodar sem abrir o navegador?**
Mude `MOSTRAR_NAVEGADOR = True` para `MOSTRAR_NAVEGADOR = False` no início do script.
