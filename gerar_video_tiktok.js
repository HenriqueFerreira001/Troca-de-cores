/**
 * =============================================================
 *   GERADOR AUTOMÁTICO DE VÍDEOS PARA TIKTOK SHOP COM IA
 *   Versão: JavaScript / Node.js + Playwright
 * =============================================================
 *
 * O QUE ESTE SCRIPT FAZ:
 *   1. Abre o Kalodata e busca produtos de Roupas Femininas
 *      mais vendidos nos últimos 7 dias
 *   2. Captura o nome do melhor produto da lista
 *   3. Abre o Gemini em uma nova aba (com seu login salvo)
 *   4. Digita um prompt para gerar um vídeo estilo TikTok UGC
 *   5. Aguarda o vídeo ser gerado e salva um print da tela
 *
 * INSTALAÇÃO (faça apenas uma vez):
 *   1. Instale o Node.js em: https://nodejs.org  (botão LTS)
 *   2. Abra o PowerShell na pasta do projeto e rode:
 *        npm install playwright
 *        npx playwright install chromium
 *
 * COMO RODAR:
 *   No PowerShell, dentro da pasta do projeto:
 *        node gerar_video_tiktok.js
 * =============================================================
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// ============================================================
// CONFIGURAÇÕES — edite aqui se necessário
// ============================================================

// Tempo máximo em milissegundos para aguardar o vídeo (3 minutos)
const TEMPO_MAXIMO_MS = 3 * 60 * 1000;

// Pasta onde ficam salvos os cookies/login do navegador
const PASTA_PERFIL = path.join(__dirname, 'perfil_navegador');


// ============================================================
// ETAPA 1: Buscar produto no Kalodata
// ============================================================

async function buscarProdutoKalodata(pagina) {
  console.log('\n📦 ETAPA 1: Acessando o Kalodata para buscar produtos...');

  // Navega até a página de produtos
  await pagina.goto('https://www.kalodata.com/product', { waitUntil: 'networkidle' });
  console.log('   ✅ Página do Kalodata carregada.');

  // Aguarda a página estabilizar
  await pagina.waitForTimeout(3000);

  // ---- Filtro de DATA ----
  console.log('   🗓️  Aplicando filtro: Últimos 7 dias...');
  try {
    // Tenta localizar e clicar no filtro de 7 dias
    const filtroData = pagina.locator('text=Last 7 days, text=Últimos 7 dias').first();
    await filtroData.click({ timeout: 8000 });
    console.log('   ✅ Filtro de data aplicado.');
  } catch {
    console.log('   ⚠️  Filtro de data não encontrado — continuando sem ele.');
  }

  await pagina.waitForTimeout(2000);

  // ---- Filtro de CATEGORIA ----
  console.log('   👗 Aplicando filtro: Roupas Femininas...');
  try {
    // Abre o painel de categorias
    const botaoCategoria = pagina.locator('text=Category, text=Categoria').first();
    await botaoCategoria.click({ timeout: 8000 });
    await pagina.waitForTimeout(1500);

    // Seleciona a categoria de roupas femininas
    const opcaoRoupas = pagina.locator(
      'text=Womenswear, text=Roupas femininas, text=Women'
    ).first();
    await opcaoRoupas.click({ timeout: 8000 });
    console.log('   ✅ Categoria selecionada.');

    // Clica em Aplicar
    const botaoAplicar = pagina.locator('text=Apply, text=Aplicar').first();
    await botaoAplicar.click({ timeout: 8000 });
    await pagina.waitForTimeout(2000);

  } catch (e) {
    console.log(`   ⚠️  Filtro de categoria não aplicado: ${e.message}`);
    console.log('   ℹ️  Aplique manualmente no navegador e pressione Enter aqui.');
    await esperarEnter();
  }

  // ---- Confirma todos os filtros ----
  try {
    const botaoEnviar = pagina.locator('text=Submit, text=Enviar, text=Search').first();
    await botaoEnviar.click({ timeout: 8000 });
    console.log('   ✅ Filtros confirmados. Aguardando lista de produtos...');
    await pagina.waitForTimeout(4000);
  } catch {
    console.log('   ℹ️  Botão de confirmação não encontrado — lista pode já ter atualizado.');
    await pagina.waitForTimeout(3000);
  }

  // ---- Captura o PRIMEIRO produto da lista ----
  console.log('   🔍 Capturando o primeiro produto...');
  let nomeProduto = '';

  try {
    // Tenta pegar o título do primeiro produto
    const primeiroProduto = pagina.locator(
      '[class*="product-name"], [class*="title"], .product-title, h3, h2'
    ).first();
    nomeProduto = await primeiroProduto.innerText({ timeout: 8000 });
    nomeProduto = nomeProduto.trim();
    console.log(`   ✅ Produto encontrado: ${nomeProduto}`);

    // Tenta abrir a página de detalhes
    await primeiroProduto.click({ timeout: 8000 });
    await pagina.waitForTimeout(3000);

    // Tenta pegar descrição mais detalhada na página do produto
    const descricao = await pagina.evaluate(() => {
      const el = document.querySelector('h1, [class*="product-detail-title"]');
      return el ? el.textContent.trim() : null;
    });
    if (descricao) {
      nomeProduto = descricao;
      console.log(`   ✅ Descrição detalhada: ${nomeProduto}`);
    }

  } catch {
    // Fallback via JavaScript caso os seletores não funcionem
    console.log('   ⚠️  Tentando capturar via JavaScript...');
    nomeProduto = await pagina.evaluate(() => {
      const el = document.querySelector('h1, h2, h3, [class*="title"], [class*="name"]');
      return el ? el.textContent.trim() : 'Vestido feminino elegante floral';
    });
    console.log(`   ✅ Nome capturado: ${nomeProduto}`);
  }

  return nomeProduto;
}


// ============================================================
// ETAPAS 2 e 3: Abrir o Gemini e digitar o prompt
// ============================================================

async function abrirGeminiEDigitarPrompt(contexto, descricaoProduto) {
  console.log('\n🤖 ETAPA 2: Abrindo o Gemini em nova aba...');

  // Abre uma nova aba no mesmo navegador (mantém o login do Google)
  const paginaGemini = await contexto.newPage();
  await paginaGemini.goto('https://gemini.google.com', { waitUntil: 'networkidle' });
  await paginaGemini.waitForTimeout(4000);
  console.log('   ✅ Gemini carregado.');

  // Verifica se está logado (procura o avatar do Google)
  try {
    await paginaGemini.waitForSelector(
      'img[aria-label*="Google Account"], [data-ogsr-up], [aria-label*="Account"]',
      { timeout: 10000 }
    );
    console.log('   ✅ Usuário autenticado no Google.');
  } catch {
    console.log('   ⚠️  Login não detectado automaticamente.');
    console.log('   ℹ️  Faça login no Google no navegador que abriu.');
    console.log('   ℹ️  Depois volte aqui e pressione ENTER para continuar...');
    await esperarEnter();
  }

  // ---- Monta o PROMPT com o produto encontrado ----
  console.log(`\n✍️  ETAPA 3: Digitando prompt com o produto...`);
  console.log(`   Produto: ${descricaoProduto.substring(0, 80)}...`);

  const prompt = `Generate a vertical 9:16 video for TikTok: Vertical mirror selfie in a bedroom with soft natural lighting. A young woman wearing ${descricaoProduto} holds her phone in front of her face, filming her reflection in a full-length mirror. Full body frontal pose, slight weight shift, small clothing adjustment. She takes a small step toward the mirror with a light body sway to show how the clothing drapes and moves, then slowly turns to a side profile showing the silhouette of the outfit in the mirror. Relaxed, natural posture. Authentic TikTok fitting room style, UGC handheld creator style, natural lighting. Audio: soft bedroom ambient sound, light breathing, soft footsteps on floor, no speech, no music.`;

  // ---- Encontra o campo de texto e digita o prompt ----
  // O Gemini usa um <div contenteditable>, não um <input> comum
  try {
    const campoTexto = paginaGemini.locator(
      '[contenteditable="true"], textarea, [role="textbox"]'
    ).first();

    await campoTexto.click({ timeout: 10000 });
    await paginaGemini.waitForTimeout(1000);

    // Digita o prompt com um pequeno delay entre caracteres (mais natural)
    await campoTexto.type(prompt, { delay: 15 });
    console.log('   ✅ Prompt digitado com sucesso.');

  } catch (e) {
    console.log(`   ❌ Erro ao digitar: ${e.message}`);
    console.log('   ℹ️  Digite o prompt manualmente no Gemini e pressione ENTER aqui.');
    await esperarEnter();
  }

  return paginaGemini;
}


// ============================================================
// ETAPA 4: Enviar o prompt e aguardar o vídeo
// ============================================================

async function enviarEAguardarVideo(paginaGemini) {
  console.log('\n🚀 ETAPA 4: Enviando prompt para o Gemini...');

  // ---- Clica no botão de ENVIAR ----
  try {
    const botaoEnviar = paginaGemini.locator(
      'button[aria-label*="Send"], button[aria-label*="Enviar"], [data-testid="send-button"]'
    ).first();
    await botaoEnviar.click({ timeout: 10000 });
    console.log('   ✅ Prompt enviado!');
  } catch {
    // Fallback: pressiona Enter
    console.log('   ⚠️  Botão não encontrado — pressionando Enter...');
    await paginaGemini.keyboard.press('Enter');
  }

  // ---- Aguarda o vídeo ser gerado ----
  console.log(`\n⏳ Aguardando geração do vídeo (até 3 minutos)...`);
  console.log('   O Gemini mostrará: "Criando o vídeo... isso pode levar 1 a 2 minutos"');

  const inicio = Date.now();
  let videoGerado = false;

  while (Date.now() - inicio < TEMPO_MAXIMO_MS) {
    const segundos = Math.floor((Date.now() - inicio) / 1000);
    process.stdout.write(`   ⏱️  Aguardando... ${segundos}s\r`);

    // Verifica se o vídeo apareceu na página
    try {
      videoGerado = await paginaGemini.evaluate(() => {
        const texto = document.body.innerText.toLowerCase();
        return (
          texto.includes('your video is ready') ||
          texto.includes('vídeo está pronto') ||
          texto.includes('video is ready') ||
          document.querySelector('video') !== null
        );
      });

      if (videoGerado) {
        const segundosFinal = Math.floor((Date.now() - inicio) / 1000);
        console.log(`\n   🎉 VÍDEO GERADO com sucesso após ${segundosFinal} segundos!`);
        break;
      }
    } catch {
      // Continua aguardando
    }

    // Aguarda 5 segundos antes de verificar novamente
    await paginaGemini.waitForTimeout(5000);
  }

  if (!videoGerado) {
    console.log(`\n   ⚠️  Tempo máximo atingido.`);
    console.log('   ℹ️  Verifique o navegador — o vídeo pode ainda estar sendo gerado.');
  }

  return videoGerado;
}


// ============================================================
// ETAPA 5: Validar e salvar o resultado
// ============================================================

async function validarESalvarResultado(paginaGemini, nomeProduto) {
  console.log('\n📸 ETAPA 5: Salvando print do resultado...');

  // Salva o screenshot com timestamp no nome
  const timestamp = Date.now();
  const nomeArquivo = `resultado_video_${timestamp}.png`;
  await paginaGemini.screenshot({ path: nomeArquivo, fullPage: true });
  console.log(`   ✅ Print salvo como: ${nomeArquivo}`);

  // ---- Checklist de validação ----
  console.log('\n' + '='.repeat(60));
  console.log('  CHECKLIST DE VALIDAÇÃO — verifique no navegador:');
  console.log('='.repeat(60));
  console.log('  [ ] O vídeo mostra uma mulher fazendo mirror selfie?');
  console.log(`  [ ] A roupa corresponde ao produto: ${nomeProduto.substring(0, 40)}...?`);
  console.log('  [ ] O formato é vertical (9:16), ideal para TikTok?');
  console.log('  [ ] A iluminação é natural e o estilo é autêntico (UGC)?');
  console.log('  [ ] Não há fala nem música — apenas sons ambiente?');
  console.log('='.repeat(60));
  console.log('\n  Se não estiver bom, peça ao Gemini:');
  console.log('  "Please regenerate the video with better lighting"');
  console.log('='.repeat(60));
}


// ============================================================
// UTILITÁRIO: Aguarda o usuário pressionar Enter no terminal
// ============================================================

function esperarEnter() {
  return new Promise(resolve => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}


// ============================================================
// FUNÇÃO PRINCIPAL — orquestra todas as etapas
// ============================================================

async function main() {
  console.log('='.repeat(60));
  console.log('  GERADOR DE VÍDEOS TIKTOK SHOP COM IA — INICIANDO');
  console.log('='.repeat(60));
  console.log('\n⚙️  Iniciando o navegador...');

  // Cria a pasta de perfil se não existir (guarda os logins)
  if (!fs.existsSync(PASTA_PERFIL)) {
    fs.mkdirSync(PASTA_PERFIL, { recursive: true });
  }

  // Inicia o navegador com perfil persistente (mantém logins entre execuções)
  const contexto = await chromium.launchPersistentContext(PASTA_PERFIL, {
    headless: false,          // false = navegador visível na tela
    args: ['--start-maximized'],
    viewport: null            // usa o tamanho real da janela
  });

  console.log('   ✅ Navegador aberto.');
  console.log('\n   ℹ️  Na PRIMEIRA vez, faça login no Kalodata e no Google.');
  console.log('   ℹ️  Depois, os logins ficam salvos automaticamente.\n');

  // Abre uma aba inicial
  const paginaKalodata = await contexto.newPage();

  try {
    // Etapa 1: Busca o produto
    const descricaoProduto = await buscarProdutoKalodata(paginaKalodata);

    // Etapas 2 e 3: Abre o Gemini e digita o prompt
    const paginaGemini = await abrirGeminiEDigitarPrompt(contexto, descricaoProduto);

    // Etapa 4: Envia e aguarda o vídeo
    await enviarEAguardarVideo(paginaGemini);

    // Etapa 5: Valida e salva o resultado
    await validarESalvarResultado(paginaGemini, descricaoProduto);

    // Mantém o navegador aberto para o usuário interagir
    console.log('\n🌐 Navegador aberto. Feche quando terminar.');
    console.log('   (Pressione CTRL+C no terminal para encerrar)\n');

    // Aguarda indefinidamente até o usuário fechar
    await new Promise(() => {});

  } catch (erro) {
    console.error(`\n❌ Erro inesperado: ${erro.message}`);
    console.log('   Verifique se está logado no Kalodata e no Google.');
    await paginaKalodata.waitForTimeout(15000);

  } finally {
    await contexto.close();
    console.log('   🔒 Navegador fechado.');
  }
}

// Inicia o script
main().catch(console.error);
