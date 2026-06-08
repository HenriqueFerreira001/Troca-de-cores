# =============================================================
# PROMPT PARA CRIAR AGENTE DE VENDAS TIKTOK SHOP COM IA
# =============================================================
# Cole este prompt inteiro em um novo chat do Claude
# =============================================================

Você é um especialista em automação e agentes de IA. Preciso que você construa 
um AGENTE AUTÔNOMO completo para gerar vídeos de vendas para o TikTok Shop Brasil.

## CONTEXTO DO PROJETO

Já tenho um script de automação em JavaScript/Node.js com Playwright que:
- Abre o Kalodata (site de dados do TikTok Shop)
- Busca os produtos mais vendidos em Roupas Femininas
- Abre o Gemini e gera vídeos verticais 9:16 estilo TikTok UGC
- Salva histórico, relatórios e screenshots

O problema atual é que isso é uma AUTOMAÇÃO, não um AGENTE. Quero evoluir para 
um agente de verdade que tome decisões sozinho, resolva erros e opere de forma 
totalmente autônoma.

## O QUE O AGENTE PRECISA FAZER (fluxo completo)

1. Todo dia no horário configurado, o agente acorda sozinho
2. Acessa o Kalodata e busca os 7 produtos mais vendidos em Roupas Femininas
3. Analisa cada produto e decide se é adequado para gerar vídeo (tem foto? é roupa feminina? não foi usado nos últimos 30 dias?)
4. Para cada produto aprovado, gera um prompt otimizado para vídeo TikTok UGC
5. Envia o prompt para o Gemini (Veo3) e aguarda a geração do vídeo
6. Verifica se o vídeo foi gerado com sucesso
7. Se falhou, tenta novamente com prompt diferente (até 3 tentativas)
8. Salva o vídeo, gera relatório do dia
9. Envia notificação no Telegram com resumo do dia
10. Registra tudo em histórico para não repetir produtos

## STACK TÉCNICA

- Node.js + JavaScript
- Playwright (automação do navegador)
- Microsoft Edge (navegador do usuário — não tem Chrome)
- Sistema operacional: Windows 11
- Pasta do projeto: C:\PROJETOS\troca de cores\Troca-de-cores-main

## PROBLEMA DO CLOUDFLARE

O Kalodata usa Cloudflare que bloqueia robôs. A solução atual é:
- O agente abre o navegador
- Pausa e pede para o usuário clicar em "Confirme que é humano" (1 clique)
- Depois continua tudo sozinho

Isso é aceitável por enquanto. No futuro, pode evoluir para resolver sozinho.

## PROBLEMA DO GEMINI

O Gemini exige plano pago (Gemini Advanced/Pro) para gerar vídeos com Veo3.
O usuário tem o plano Pro.

O agente precisa:
- Fazer login no Gemini (sessão salva no perfil do navegador)
- Digitar o prompt de geração de vídeo
- Aguardar até 3 minutos por vídeo
- Detectar quando o vídeo ficou pronto
- Salvar screenshot como comprovante

## ESTRUTURA DO PROMPT DE VÍDEO

O prompt padrão que funciona bem é:
"Generate a vertical 9:16 video for TikTok: Vertical mirror selfie in a bedroom 
with soft natural lighting. A young woman wearing [DESCRIÇÃO DO PRODUTO] holds 
her phone in front of her face, filming her reflection in a full-length mirror. 
Full body frontal pose, slight weight shift, small clothing adjustment. She takes 
a small step toward the mirror with a light body sway to show how the clothing 
drapes and moves, then slowly turns to a side profile showing the silhouette of 
the outfit in the mirror. Relaxed, natural posture. Authentic TikTok fitting room 
style, UGC handheld creator style, natural lighting. Audio: soft bedroom ambient 
sound, light breathing, soft footsteps on floor, no speech, no music."

## O QUE QUERO QUE VOCÊ CONSTRUA

Quero um agente completo em Node.js com estas características:

### 1. TOMADA DE DECISÃO INTELIGENTE
- Avaliar se um produto é adequado para vídeo (não apenas pegar o primeiro da lista)
- Priorizar produtos com maior potencial de vendas
- Adaptar o prompt conforme o tipo de roupa (vestido, calça, blusa, etc.)

### 2. RECUPERAÇÃO DE ERROS AUTOMÁTICA
- Se o Gemini falhar, tentar novamente com prompt ajustado
- Se o Kalodata não carregar, aguardar e tentar de novo
- Se o login expirar, detectar e pausar para o usuário logar

### 3. MEMÓRIA E HISTÓRICO
- Nunca repetir produto nos últimos 30 dias
- Lembrar quais produtos geraram bons vídeos
- Registrar erros para evitar repetir falhas

### 4. RELATÓRIO DIÁRIO
- Arquivo .txt com resumo do dia
- Lista de produtos processados e status de cada um
- Screenshots de cada vídeo gerado

### 5. NOTIFICAÇÃO NO TELEGRAM
- Avisar quando terminar
- Mostrar quantos vídeos foram gerados
- Alertar se algo deu errado

### 6. AGENDAMENTO AUTOMÁTICO
- Rodar todo dia no horário configurado
- Não precisar de intervenção manual (exceto o 1 clique do Cloudflare)

## CONFIGURAÇÕES QUE O USUÁRIO PODE EDITAR

No topo do arquivo, deixe um bloco de configurações claro onde o usuário pode:
- Definir quantos vídeos gerar por dia (padrão: 7)
- Definir o horário de execução automática (padrão: 09:00)
- Configurar o token do Telegram
- Ajustar o tempo máximo de espera por vídeo

## COMO RODAR

- Uma vez agora: node agente_tiktok.js
- Todo dia automaticamente: node agente_tiktok.js --agendar

## DEPENDÊNCIAS

Apenas o Playwright (já instalado):
- npm install playwright
- npx playwright install chromium

## OBSERVAÇÕES IMPORTANTES

1. Todos os comentários e mensagens do terminal devem ser em PORTUGUÊS
2. O código deve ser bem comentado e explicativo
3. Cada função deve ter um comentário explicando o que faz
4. As mensagens no terminal devem ser claras e amigáveis
5. O agente deve ser robusto — não pode quebrar fácil
6. Usar Microsoft Edge como navegador (não Chrome)
7. Manter perfil do navegador salvo para não precisar logar toda vez

## RESULTADO ESPERADO

Um único arquivo agente_tiktok.js que quando rodado:
1. Abre o Edge automaticamente
2. Navega para o Kalodata
3. Aguarda o usuário passar o Cloudflare (1 clique)
4. Coleta os 7 melhores produtos de roupas femininas
5. Para cada produto, abre o Gemini e gera um vídeo
6. Salva tudo e notifica no Telegram
7. Fecha e aguarda o próximo horário agendado

Por favor, construa este agente completo, bem comentado, robusto e fácil de usar.
