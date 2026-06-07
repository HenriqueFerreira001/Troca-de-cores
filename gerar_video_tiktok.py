"""
=============================================================
  GERADOR AUTOMÁTICO DE VÍDEOS PARA TIKTOK SHOP COM IA
=============================================================

O QUE ESTE SCRIPT FAZ:
  1. Abre o site Kalodata e busca os produtos mais vendidos
     da categoria "Roupas Femininas" nos últimos 7 dias
  2. Escolhe automaticamente o melhor produto da lista
  3. Abre o Gemini (IA do Google) em uma nova aba
  4. Envia um prompt detalhado pedindo a geração de um vídeo
     vertical no estilo UGC/TikTok com o produto escolhido
  5. Aguarda o vídeo ser gerado e tira um print da tela

REQUISITOS ANTES DE RODAR:
  - Python 3.8 ou superior instalado
  - Conta Google logada no Chrome (para acessar o Gemini)
  - Conta no Kalodata (para ver os produtos)
  - Rodar os comandos de instalação abaixo UMA VEZ:

      pip install playwright
      playwright install chromium

COMO RODAR:
  No terminal, dentro da pasta do projeto:
      python gerar_video_tiktok.py

=============================================================
"""

import asyncio
import time
from playwright.async_api import async_playwright


# ============================================================
# CONFIGURAÇÕES — edite aqui se necessário
# ============================================================

# Tempo máximo (em segundos) para aguardar o vídeo ser gerado pelo Gemini
TEMPO_MAXIMO_GERACAO_VIDEO = 180  # 3 minutos

# Se True, o navegador abre visível na tela (recomendado para ver o que acontece)
# Se False, roda em modo invisível (headless)
MOSTRAR_NAVEGADOR = True


# ============================================================
# ETAPA 1: Buscar produto no Kalodata
# ============================================================

async def buscar_produto_kalodata(pagina):
    """
    Acessa o Kalodata, aplica filtros de categoria e data,
    e retorna o nome e descrição do produto mais relevante.
    """
    print("\n📦 ETAPA 1: Acessando o Kalodata para buscar produtos...")

    # Navega até a página de produtos do Kalodata
    await pagina.goto("https://www.kalodata.com/product", wait_until="networkidle")
    print("   ✅ Página do Kalodata carregada.")

    # Aguarda a página estabilizar completamente
    await pagina.wait_for_timeout(3000)

    # ---- Filtro de DATA ----
    print("   🗓️  Aplicando filtro de data: Últimos 7 dias...")
    try:
        # Tenta localizar o filtro de datas no painel lateral
        filtro_data = pagina.locator("text=Últimos 7 dias, text=Last 7 days").first
        await filtro_data.click(timeout=8000)
        print("   ✅ Filtro de data aplicado.")
    except Exception:
        print("   ⚠️  Não encontrou filtro de data automaticamente — continuando sem ele.")

    await pagina.wait_for_timeout(2000)

    # ---- Filtro de CATEGORIA ----
    print("   👗 Aplicando filtro de categoria: Roupas Femininas...")
    try:
        # Abre o painel de categorias
        botao_categoria = pagina.locator("text=Categoria, text=Category").first
        await botao_categoria.click(timeout=8000)
        await pagina.wait_for_timeout(1500)

        # Marca a categoria de roupas femininas
        opcao_roupas = pagina.locator(
            "text=Roupas femininas, text=Womenswear, text=Women's Clothing"
        ).first
        await opcao_roupas.click(timeout=8000)
        print("   ✅ Categoria de roupas femininas selecionada.")

        # Clica em "Aplicar" para confirmar a categoria
        botao_aplicar = pagina.locator("text=Aplicar, text=Apply").first
        await botao_aplicar.click(timeout=8000)
        await pagina.wait_for_timeout(2000)

    except Exception as e:
        print(f"   ⚠️  Filtro de categoria não aplicado automaticamente: {e}")
        print("   ℹ️  Continuando com a listagem geral...")

    # ---- Clica em ENVIAR para confirmar todos os filtros ----
    try:
        botao_enviar = pagina.locator("text=Enviar, text=Submit, text=Search").first
        await botao_enviar.click(timeout=8000)
        print("   ✅ Filtros confirmados. Aguardando lista de produtos...")
        await pagina.wait_for_timeout(4000)
    except Exception:
        print("   ℹ️  Botão de envio não encontrado — a lista pode já ter atualizado.")
        await pagina.wait_for_timeout(3000)

    # ---- Captura o PRIMEIRO produto da lista ----
    print("   🔍 Buscando o primeiro produto da lista...")
    try:
        # Tenta capturar o título do primeiro produto listado
        primeiro_produto = pagina.locator(
            "[class*='product-name'], [class*='title'], .product-title, h3, h2"
        ).first
        nome_produto = await primeiro_produto.inner_text(timeout=8000)
        nome_produto = nome_produto.strip()
        print(f"   ✅ Produto encontrado: {nome_produto}")
    except Exception:
        # Fallback: usa JavaScript para buscar qualquer título visível
        print("   ⚠️  Tentando capturar nome via JavaScript...")
        nome_produto = await pagina.evaluate("""
            () => {
                const el = document.querySelector('h1, h2, h3, [class*="title"], [class*="name"]');
                return el ? el.textContent.trim() : 'Vestido feminino elegante';
            }
        """)
        print(f"   ✅ Nome capturado via JS: {nome_produto}")

    # ---- Abre a página de detalhes do produto ----
    print("   🖱️  Abrindo página de detalhes do produto...")
    try:
        await primeiro_produto.click(timeout=8000)
        await pagina.wait_for_timeout(3000)

        # Tenta pegar a descrição detalhada na página do produto
        descricao = await pagina.evaluate("""
            () => {
                const el = document.querySelector('h1, [class*="product-detail-title"], [class*="description"]');
                return el ? el.textContent.trim() : null;
            }
        """)
        if descricao:
            nome_produto = descricao
            print(f"   ✅ Descrição detalhada capturada: {nome_produto}")

    except Exception as e:
        print(f"   ⚠️  Não foi possível abrir detalhes: {e}")
        print(f"   ℹ️  Usando nome da lista: {nome_produto}")

    return nome_produto


# ============================================================
# ETAPA 2 e 3: Abrir o Gemini e digitar o prompt
# ============================================================

async def abrir_gemini_e_digitar_prompt(contexto_navegador, descricao_produto):
    """
    Abre uma nova aba com o Gemini e digita o prompt
    pedindo a geração do vídeo com o produto informado.
    """
    print("\n🤖 ETAPA 2: Abrindo o Gemini...")

    # Abre uma nova aba no mesmo navegador (mantém a sessão logada)
    pagina_gemini = await contexto_navegador.new_page()
    await pagina_gemini.goto("https://gemini.google.com", wait_until="networkidle")
    await pagina_gemini.wait_for_timeout(4000)
    print("   ✅ Gemini carregado.")

    # Verifica se está logado (procura o avatar do usuário)
    try:
        await pagina_gemini.wait_for_selector(
            "img[aria-label*='Google Account'], [data-ogsr-up]",
            timeout=10000
        )
        print("   ✅ Usuário autenticado no Gemini.")
    except Exception:
        print("   ⚠️  Não foi possível confirmar autenticação.")
        print("   ℹ️  Se o Gemini pedir login, faça manualmente e pressione Enter aqui.")
        input("      Pressione ENTER quando estiver logado no Gemini...")

    # ---- Monta o PROMPT com a descrição do produto ----
    print(f"\n✍️  ETAPA 3: Digitando prompt com o produto: {descricao_produto}")

    prompt = f"""Generate a vertical 9:16 video for TikTok: Vertical mirror selfie in a bedroom with soft natural lighting. A young woman wearing {descricao_produto} holds her phone in front of her face, filming her reflection in a full-length mirror. Full body frontal pose, slight weight shift, small clothing adjustment. She takes a small step toward the mirror with a light body sway to show how the clothing drapes and moves, then slowly turns to a side profile showing the silhouette of the outfit in the mirror. Relaxed, natural posture. Authentic TikTok fitting room style, UGC handheld creator style, natural lighting. Audio: soft bedroom ambient sound, light breathing, soft footsteps on floor, no speech, no music."""

    print(f"\n   📝 Prompt que será enviado:\n")
    print(f"   {prompt[:200]}...\n")  # Mostra só os primeiros 200 caracteres

    # ---- Encontra o campo de texto do Gemini ----
    # O campo do Gemini é um <div contenteditable>, não um <input> comum
    try:
        campo_texto = pagina_gemini.locator(
            "[contenteditable='true'], textarea, [role='textbox']"
        ).first
        await campo_texto.click(timeout=10000)
        await pagina_gemini.wait_for_timeout(1000)

        # Digita o prompt no campo (o Gemini aceita tipo "type")
        await campo_texto.type(prompt, delay=20)  # delay=20ms entre caracteres
        print("   ✅ Prompt digitado com sucesso.")

    except Exception as e:
        print(f"   ❌ Erro ao digitar no campo: {e}")
        print("   ℹ️  Tente digitar manualmente no Gemini e pressione Enter aqui.")
        input("      Pressione ENTER quando o prompt estiver digitado...")

    return pagina_gemini


# ============================================================
# ETAPA 4: Enviar o prompt e aguardar o vídeo
# ============================================================

async def enviar_prompt_e_aguardar_video(pagina_gemini):
    """
    Clica no botão de enviar e aguarda o Gemini gerar o vídeo.
    Tira um print assim que o vídeo aparecer.
    """
    print("\n🚀 ETAPA 4: Enviando prompt para o Gemini...")

    # ---- Clica no botão de ENVIAR ----
    try:
        # O botão de envio do Gemini costuma ser um ícone de seta
        botao_enviar = pagina_gemini.locator(
            "button[aria-label*='Send'], button[aria-label*='Enviar'], "
            "[data-testid='send-button'], button[type='submit']"
        ).first
        await botao_enviar.click(timeout=10000)
        print("   ✅ Prompt enviado! Aguardando geração do vídeo...")

    except Exception:
        # Fallback: tenta pressionar Enter
        print("   ⚠️  Botão de envio não encontrado. Tentando pressionar Enter...")
        await pagina_gemini.keyboard.press("Enter")
        print("   ✅ Enter pressionado.")

    # ---- Aguarda o vídeo ser gerado ----
    print(f"\n⏳ Aguardando geração do vídeo (pode levar até {TEMPO_MAXIMO_GERACAO_VIDEO // 60} minutos)...")
    print("   O Gemini irá mostrar: 'Criando o vídeo... Isso pode levar 1 a 2 minutos'")

    inicio = time.time()
    video_gerado = False

    while time.time() - inicio < TEMPO_MAXIMO_GERACAO_VIDEO:
        tempo_decorrido = int(time.time() - inicio)
        print(f"   ⏱️  Aguardando... {tempo_decorrido}s", end="\r")

        # Verifica se o vídeo apareceu na página
        try:
            # Tenta encontrar elementos que indicam que o vídeo foi gerado
            video_pronto = await pagina_gemini.evaluate("""
                () => {
                    const texto = document.body.innerText.toLowerCase();
                    return (
                        texto.includes('your video is ready') ||
                        texto.includes('vídeo está pronto') ||
                        texto.includes('video is ready') ||
                        document.querySelector('video') !== null
                    );
                }
            """)

            if video_pronto:
                print(f"\n   🎉 VÍDEO GERADO com sucesso após {tempo_decorrido} segundos!")
                video_gerado = True
                break

        except Exception:
            pass  # Continua aguardando

        await asyncio.sleep(5)  # Verifica a cada 5 segundos

    if not video_gerado:
        print(f"\n   ⚠️  Tempo máximo atingido ({TEMPO_MAXIMO_GERACAO_VIDEO}s).")
        print("   ℹ️  O vídeo pode ainda estar sendo gerado — verifique o navegador.")

    return video_gerado


# ============================================================
# ETAPA 5: Validar e salvar o resultado
# ============================================================

async def validar_e_salvar_resultado(pagina_gemini, nome_produto):
    """
    Tira um print da tela com o resultado e exibe instruções
    para o usuário validar o vídeo gerado.
    """
    print("\n📸 ETAPA 5: Salvando print do resultado...")

    # Define o nome do arquivo com base no produto e timestamp
    timestamp = int(time.time())
    nome_arquivo = f"resultado_video_{timestamp}.png"

    # Tira o screenshot da página inteira
    await pagina_gemini.screenshot(path=nome_arquivo, full_page=True)
    print(f"   ✅ Print salvo como: {nome_arquivo}")

    # ---- Instruções de validação manual ----
    print("\n" + "="*60)
    print("  CHECKLIST DE VALIDAÇÃO — verifique no navegador:")
    print("="*60)
    print("  [ ] O vídeo mostra uma mulher fazendo mirror selfie?")
    print(f"  [ ] A roupa exibida corresponde ao produto: {nome_produto[:50]}?")
    print("  [ ] O formato é vertical (9:16), ideal para TikTok?")
    print("  [ ] A iluminação é natural e o estilo é autêntico (UGC)?")
    print("  [ ] Não há fala nem música — apenas sons ambiente?")
    print("="*60)
    print("\n  Se não estiver satisfatório, você pode pedir ao Gemini:")
    print("  'Please regenerate the video with better lighting'")
    print("  ou 'Make the clothing more visible in the video'")
    print("="*60)


# ============================================================
# FUNÇÃO PRINCIPAL — orquestra todas as etapas
# ============================================================

async def main():
    print("="*60)
    print("  GERADOR DE VÍDEOS TIKTOK SHOP COM IA — INICIANDO")
    print("="*60)
    print("\n⚙️  Iniciando o navegador...")

    async with async_playwright() as playwright:
        # Inicia o navegador Chromium
        # use_data_dir mantém sua sessão do Google salva entre execuções
        navegador = await playwright.chromium.launch_persistent_context(
            user_data_dir="./perfil_navegador",  # Salva cookies/login localmente
            headless=not MOSTRAR_NAVEGADOR,       # True = invisível, False = visível
            args=["--start-maximized"],
            no_viewport=True
        )

        print("   ✅ Navegador aberto.")
        print("\n   ℹ️  IMPORTANTE: Na primeira execução, você precisará fazer")
        print("   login no Google quando o navegador abrir.")
        print("   Depois disso, o login fica salvo automaticamente.\n")

        # Abre uma aba para o Kalodata
        pagina_kalodata = await navegador.new_page()

        try:
            # ---- Etapa 1: Busca o produto no Kalodata ----
            descricao_produto = await buscar_produto_kalodata(pagina_kalodata)

            # ---- Etapas 2 e 3: Abre Gemini e digita o prompt ----
            pagina_gemini = await abrir_gemini_e_digitar_prompt(
                navegador, descricao_produto
            )

            # ---- Etapa 4: Envia e aguarda o vídeo ----
            video_gerado = await enviar_prompt_e_aguardar_video(pagina_gemini)

            # ---- Etapa 5: Valida e salva o resultado ----
            await validar_e_salvar_resultado(pagina_gemini, descricao_produto)

            # Mantém o navegador aberto para o usuário interagir
            print("\n🌐 Navegador permanece aberto. Feche quando terminar.")
            print("   (Pressione CTRL+C no terminal para encerrar o script)\n")
            await asyncio.sleep(999999)  # Mantém rodando indefinidamente

        except KeyboardInterrupt:
            print("\n\n👋 Script encerrado pelo usuário.")

        except Exception as erro:
            print(f"\n❌ Erro inesperado: {erro}")
            print("   Verifique se:")
            print("   - Você está logado no Kalodata")
            print("   - Você está logado no Google (Gemini)")
            print("   - Sua internet está funcionando")
            await asyncio.sleep(30)  # Mantém o navegador aberto por 30s para ver o erro

        finally:
            await navegador.close()
            print("   🔒 Navegador fechado.")


# ============================================================
# PONTO DE ENTRADA DO SCRIPT
# ============================================================

if __name__ == "__main__":
    # Roda a função principal de forma assíncrona (necessário para o Playwright)
    asyncio.run(main())
