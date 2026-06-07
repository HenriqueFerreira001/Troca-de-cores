/**
 * =============================================================
 *   GERADOR AUTOMÁTICO DE VÍDEOS PARA TIKTOK SHOP COM IA
 *   Versão: JavaScript / Node.js + Playwright
 * =============================================================
 *
 * ❓ O QUE É ESSE ARQUIVO?
 *   É um script (programa) que roda no seu computador e controla
 *   o navegador automaticamente — como se fosse um robô clicando
 *   e digitando por você.
 *
 * 🎯 O QUE ELE FAZ PASSO A PASSO:
 *   1. Abre o site Kalodata e busca os produtos de roupas femininas
 *      mais vendidos nos últimos 7 dias no TikTok Shop Brasil
 *   2. Lê o nome e descrição do melhor produto encontrado
 *   3. Abre o Gemini (a IA do Google) em uma nova aba do navegador
 *   4. Digita automaticamente um prompt (instrução) pedindo ao Gemini
 *      que crie um vídeo vertical 9:16 no estilo TikTok UGC com o produto
 *   5. Aguarda o Gemini gerar o vídeo (leva 1 a 3 minutos)
 *   6. Tira um print da tela com o resultado e mostra um checklist
 *
 * 💻 ANTES DE RODAR PELA PRIMEIRA VEZ:
 *   Você precisa instalar 2 coisas no seu computador:
 *
 *   PASSO A — Instalar o Node.js (o programa que roda JavaScript):
 *     → Acesse: https://nodejs.org
 *     → Clique no botão verde "LTS" para baixar
 *     → Instale normalmente (next, next, finish)
 *     → Feche e reabra o PowerShell depois de instalar
 *
 *   PASSO B — Dentro da pasta do projeto, rode no PowerShell:
 *     npm install
 *     npx playwright install chromium
 *
 * ▶️  COMO RODAR O SCRIPT:
 *   No PowerShell, dentro da pasta do projeto, rode:
 *     node gerar_video_tiktok.js
 *
 * 🔑 LOGINS NECESSÁRIOS:
 *   Na primeira vez que rodar, o navegador vai abrir e você
 *   precisará fazer login manualmente em:
 *     - Kalodata (sua conta do site)
 *     - Google (para acessar o Gemini)
 *   Depois disso, os logins ficam salvos automaticamente!
 * =============================================================
 */


// ============================================================
// IMPORTAÇÕES — são as "ferramentas" que o script usa
// ============================================================

// 'chromium' é o navegador que vamos controlar automaticamente
const { chromium } = require('playwright');

// 'path' serve para montar caminhos de pastas no computador
const path = require('path');

// 'fs' serve para criar pastas e arquivos no computador
const fs = require('fs');


// ============================================================
// CONFIGURAÇÕES GERAIS
// Você pode alterar esses valores se quiser
// ============================================================

// Tempo máximo que vamos esperar o Gemini gerar o vídeo
// 180000 milissegundos = 3 minutos
// Se quiser esperar mais, aumente esse número (ex: 300000 = 5 minutos)
const TEMPO_MAXIMO_MS = 180000;

// Pasta onde ficam salvos os cookies e logins do navegador
// Assim você não precisa fazer login toda vez que rodar o script
const PASTA_PERFIL = path.join(__dirname, 'perfil_navegador');


// ============================================================
// ETAPA 1: BUSCAR PRODUTO NO KALODATA
// ============================================================
// O Kalodata é um site que mostra dados de produtos do TikTok Shop.
// Vamos entrar nele, aplicar filtros e pegar o produto mais relevante.

async function buscarProdutoKalodata(pagina) {
  console.log('\n📦 ETAPA 1: Acessando o Kalodata para buscar produtos...');
  console.log('   (O navegador vai abrir o site automaticamente)');

  // Navega até a página de produtos do Kalodata
  // 'networkidle' significa: esperar até a página parar de carregar dados
  await pagina.goto('https://www.kalodata.com/product', { waitUntil: 'networkidle' });
  console.log('   ✅ Página do Kalodata carregada com sucesso!');

  // Aguarda 3 segundos para garantir que tudo carregou na tela
  await pagina.waitForTimeout(3000);

  // ---- FILTRO DE DATA: Últimos 7 dias ----
  // Queremos ver só os produtos que estão vendendo AGORA,
  // por isso filtramos pelos últimos 7 dias
  console.log('   🗓️  Tentando aplicar filtro de data: Últimos 7 dias...');
  try {
    // Procura o botão/texto "Last 7 days" ou "Últimos 7 dias" na página
    const filtroData = pagina.locator('text=Last 7 days, text=Últimos 7 dias').first();
    await filtroData.click({ timeout: 8000 }); // Tenta clicar em até 8 segundos
    console.log('   ✅ Filtro de data aplicado!');
  } catch {
    // Se não encontrar, continua sem o filtro (não é crítico)
    console.log('   ⚠️  Filtro de data não encontrado automaticamente.');
    console.log('   ℹ️  Sem problema — vamos continuar assim mesmo.');
  }

  // Aguarda 2 segundos após o filtro
  await pagina.waitForTimeout(2000);

  // ---- FILTRO DE CATEGORIA: Roupas Femininas ----
  // Queremos apenas produtos da categoria "Roupas Femininas"
  // para garantir que o vídeo gerado faça sentido para o TikTok Shop
  console.log('   👗 Tentando aplicar filtro de categoria: Roupas Femininas...');
  try {
    // Primeiro, abre o painel de categorias clicando nele
    const botaoCategoria = pagina.locator('text=Category, text=Categoria').first();
    await botaoCategoria.click({ timeout: 8000 });
    await pagina.waitForTimeout(1500); // Aguarda o painel abrir

    // Dentro do painel, seleciona a opção de roupas femininas
    const opcaoRoupas = pagina.locator(
      'text=Womenswear, text=Roupas femininas, text=Women'
    ).first();
    await opcaoRoupas.click({ timeout: 8000 });
    console.log('   ✅ Categoria "Roupas Femininas" selecionada!');

    // Clica em "Aplicar" para confirmar a escolha da categoria
    const botaoAplicar = pagina.locator('text=Apply, text=Aplicar').first();
    await botaoAplicar.click({ timeout: 8000 });
    await pagina.waitForTimeout(2000);

  } catch (e) {
    // Se falhar, avisa o usuário e pede para ele aplicar manualmente
    console.log(`   ⚠️  Não consegui aplicar o filtro de categoria automaticamente.`);
    console.log('   ℹ️  Por favor, aplique o filtro manualmente no navegador.');
    console.log('   ℹ️  Depois volte aqui e pressione ENTER para continuar...');
    await esperarEnter(); // Pausa o script e espera o usuário pressionar Enter
  }

  // ---- BOTÃO "ENVIAR" para confirmar todos os filtros ----
  console.log('   🔎 Confirmando todos os filtros selecionados...');
  try {
    const botaoEnviar = pagina.locator('text=Submit, text=Enviar, text=Search').first();
    await botaoEnviar.click({ timeout: 8000 });
    console.log('   ✅ Filtros confirmados! Aguardando a lista de produtos carregar...');
    await pagina.waitForTimeout(4000); // Espera a lista atualizar
  } catch {
    console.log('   ℹ️  Botão de confirmação não encontrado.');
    console.log('   ℹ️  A lista pode já ter atualizado automaticamente.');
    await pagina.waitForTimeout(3000);
  }

  // ---- CAPTURA O PRIMEIRO PRODUTO DA LISTA ----
  // O primeiro produto da lista geralmente é o mais relevante/vendido
  console.log('   🔍 Lendo o nome do primeiro produto da lista...');
  let nomeProduto = '';

  try {
    // Tenta encontrar o nome do produto pelos seletores CSS mais comuns
    const primeiroProduto = pagina.locator(
      '[class*="product-name"], [class*="title"], .product-title, h3, h2'
    ).first();

    // Lê o texto do elemento encontrado
    nomeProduto = await primeiroProduto.innerText({ timeout: 8000 });
    nomeProduto = nomeProduto.trim(); // Remove espaços desnecessários
    console.log(`   ✅ Produto encontrado: "${nomeProduto}"`);

    // Tenta clicar no produto para ver mais detalhes
    console.log('   🖱️  Abrindo página de detalhes do produto...');
    await primeiroProduto.click({ timeout: 8000 });
    await pagina.waitForTimeout(3000);

    // Na página de detalhes, tenta pegar uma descrição mais completa
    const descricaoDetalhada = await pagina.evaluate(() => {
      // Esse código roda dentro do navegador para ler o conteúdo da página
      const el = document.querySelector('h1, [class*="product-detail-title"]');
      return el ? el.textContent.trim() : null;
    });

    if (descricaoDetalhada) {
      nomeProduto = descricaoDetalhada;
      console.log(`   ✅ Descrição detalhada capturada: "${nomeProduto}"`);
    }

  } catch {
    // Se os seletores CSS não funcionaram, usa JavaScript como backup
    console.log('   ⚠️  Seletores não encontraram o produto — tentando via JavaScript...');
    nomeProduto = await pagina.evaluate(() => {
      // Tenta qualquer elemento de título visível na página
      const el = document.querySelector('h1, h2, h3, [class*="title"], [class*="name"]');
      return el ? el.textContent.trim() : 'Vestido feminino elegante floral';
    });
    console.log(`   ✅ Nome capturado: "${nomeProduto}"`);
  }

  return nomeProduto; // Retorna o nome para usar no próximo passo
}


// ============================================================
// ETAPAS 2 e 3: ABRIR O GEMINI E DIGITAR O PROMPT
// ============================================================
// O Gemini é a IA do Google que gera vídeos (usando o modelo Veo3).
// Vamos abrir ele em uma nova aba e digitar um prompt profissional
// para gerar um vídeo de TikTok com o produto encontrado.

async function abrirGeminiEDigitarPrompt(contexto, descricaoProduto) {
  console.log('\n🤖 ETAPA 2: Abrindo o Gemini em uma nova aba do navegador...');

  // Abre uma NOVA ABA no mesmo navegador que já está aberto
  // Isso é importante porque mantém o login do Google ativo
  const paginaGemini = await contexto.newPage();

  // Navega até o site do Gemini
  await paginaGemini.goto('https://gemini.google.com', { waitUntil: 'networkidle' });
  await paginaGemini.waitForTimeout(4000); // Aguarda carregar completamente
  console.log('   ✅ Site do Gemini carregado!');

  // ---- VERIFICA SE ESTÁ LOGADO ----
  // O Gemini precisa que você esteja logado com uma conta Google
  // Procuramos pelo avatar/foto de perfil do usuário no canto da tela
  try {
    await paginaGemini.waitForSelector(
      'img[aria-label*="Google Account"], [data-ogsr-up], [aria-label*="Account"]',
      { timeout: 10000 } // Espera até 10 segundos
    );
    console.log('   ✅ Você está logado no Google! Podemos continuar.');
  } catch {
    // Se não encontrar o login, pausa e pede para o usuário logar manualmente
    console.log('   ⚠️  Login do Google não detectado automaticamente.');
    console.log('   👉 Por favor, faça login no Google no navegador que abriu.');
    console.log('   👉 Depois volte aqui e pressione ENTER para continuar...');
    await esperarEnter();
  }

  // ---- MONTA O PROMPT ----
  // O prompt é a "instrução" que enviamos ao Gemini.
  // Ele descreve exatamente como queremos que o vídeo seja gerado.
  // Substituímos [PRODUTO] pela descrição real do produto do Kalodata.
  console.log(`\n✍️  ETAPA 3: Preparando o prompt para o Gemini...`);
  console.log(`   Produto que será usado no vídeo: "${descricaoProduto.substring(0, 60)}..."`);

  const prompt =
    `Generate a vertical 9:16 video for TikTok: ` +
    `Vertical mirror selfie in a bedroom with soft natural lighting. ` +
    `A young woman wearing ${descricaoProduto} ` +
    `holds her phone in front of her face, filming her reflection in a full-length mirror. ` +
    `Full body frontal pose, slight weight shift, small clothing adjustment. ` +
    `She takes a small step toward the mirror with a light body sway to show how the clothing ` +
    `drapes and moves, then slowly turns to a side profile showing the silhouette of the outfit ` +
    `in the mirror. Relaxed, natural posture. Authentic TikTok fitting room style, ` +
    `UGC handheld creator style, natural lighting. ` +
    `Audio: soft bedroom ambient sound, light breathing, soft footsteps on floor, ` +
    `no speech, no music.`;

  // ---- DIGITA O PROMPT NO CAMPO DE TEXTO DO GEMINI ----
  // O campo de texto do Gemini é diferente de um campo normal —
  // ele usa um <div contenteditable> em vez de um <input>.
  // Por isso precisamos encontrá-lo de forma específica.
  console.log('   ⌨️  Digitando o prompt no campo de texto do Gemini...');
  try {
    // Procura o campo de texto usando seletores específicos do Gemini
    const campoTexto = paginaGemini.locator(
      '[contenteditable="true"], textarea, [role="textbox"]'
    ).first();

    // Clica no campo para garantir que está ativo/focado
    await campoTexto.click({ timeout: 10000 });
    await paginaGemini.waitForTimeout(1000);

    // Digita o prompt letra por letra com 15ms de delay
    // (delay pequeno para parecer mais natural e evitar erros)
    await campoTexto.type(prompt, { delay: 15 });
    console.log('   ✅ Prompt digitado com sucesso no Gemini!');

  } catch (e) {
    // Se não conseguir digitar automaticamente, pede ao usuário para fazer manual
    console.log(`   ❌ Não consegui digitar automaticamente: ${e.message}`);
    console.log('   👉 Por favor, copie e cole o prompt abaixo no Gemini:');
    console.log('\n' + '-'.repeat(60));
    console.log(prompt);
    console.log('-'.repeat(60) + '\n');
    console.log('   👉 Depois volte aqui e pressione ENTER para continuar...');
    await esperarEnter();
  }

  return paginaGemini; // Retorna a aba do Gemini para usar no próximo passo
}


// ============================================================
// ETAPA 4: ENVIAR O PROMPT E AGUARDAR O VÍDEO SER GERADO
// ============================================================
// Depois de digitar o prompt, precisamos clicar no botão de enviar.
// Então aguardamos pacientemente o Gemini gerar o vídeo (1 a 3 minutos).

async function enviarEAguardarVideo(paginaGemini) {
  console.log('\n🚀 ETAPA 4: Enviando o prompt para o Gemini gerar o vídeo...');

  // ---- CLICA NO BOTÃO DE ENVIAR ----
  // O botão de enviar do Gemini é geralmente um ícone de seta ou avião de papel
  try {
    const botaoEnviar = paginaGemini.locator(
      'button[aria-label*="Send"], button[aria-label*="Enviar"], [data-testid="send-button"]'
    ).first();
    await botaoEnviar.click({ timeout: 10000 });
    console.log('   ✅ Mensagem enviada! O Gemini começou a gerar o vídeo.');
  } catch {
    // Se não achar o botão, tenta pressionar Enter (funciona na maioria dos casos)
    console.log('   ⚠️  Botão de envio não encontrado — tentando pressionar Enter...');
    await paginaGemini.keyboard.press('Enter');
    console.log('   ✅ Enter pressionado.');
  }

  // ---- AGUARDA O VÍDEO SER GERADO ----
  // O Gemini geralmente mostra uma mensagem como:
  // "Criando o vídeo... Isso pode levar de 1 a 2 minutos"
  // Vamos verificar a cada 5 segundos se o vídeo ficou pronto
  console.log(`\n⏳ Aguardando o vídeo ser gerado...`);
  console.log('   (O Gemini vai mostrar: "Criando o vídeo... pode levar 1 a 2 minutos")');
  console.log('   Fique tranquilo, isso é normal! Aguarde...\n');

  const inicio = Date.now(); // Marca o tempo de início
  let videoGerado = false;

  // Loop que fica verificando até o vídeo aparecer ou o tempo acabar
  while (Date.now() - inicio < TEMPO_MAXIMO_MS) {

    // Calcula quantos segundos já passaram
    const segundos = Math.floor((Date.now() - inicio) / 1000);

    // Mostra o contador na mesma linha (sem pular linha)
    process.stdout.write(`   ⏱️  Verificando... ${segundos}s passados\r`);

    // ---- VERIFICA SE O VÍDEO JÁ APARECEU ----
    // Rodamos um código JavaScript dentro do navegador para verificar
    try {
      videoGerado = await paginaGemini.evaluate(() => {
        const textoDaPagina = document.body.innerText.toLowerCase();

        // Verifica se apareceu alguma mensagem indicando que o vídeo ficou pronto
        const videoFicouPronto =
          textoDaPagina.includes('your video is ready') ||     // Em inglês
          textoDaPagina.includes('vídeo está pronto') ||       // Em português
          textoDaPagina.includes('video is ready') ||          // Variação em inglês
          document.querySelector('video') !== null;            // Elemento de vídeo na página

        return videoFicouPronto;
      });

      if (videoGerado) {
        const segundosFinal = Math.floor((Date.now() - inicio) / 1000);
        console.log(`\n   🎉 VÍDEO GERADO COM SUCESSO após ${segundosFinal} segundos!`);
        break; // Para o loop assim que o vídeo aparecer
      }

    } catch {
      // Se der erro na verificação, ignora e continua tentando
    }

    // Aguarda 5 segundos antes de verificar de novo
    // (não precisamos verificar o tempo todo — 5s é suficiente)
    await paginaGemini.waitForTimeout(5000);
  }

  // Se chegou no tempo máximo sem gerar
  if (!videoGerado) {
    console.log(`\n   ⚠️  O tempo máximo de espera foi atingido.`);
    console.log('   ℹ️  Verifique o navegador — o Gemini pode ainda estar gerando.');
    console.log('   ℹ️  Se o vídeo aparecer depois, é só fazer o download manualmente.');
  }

  return videoGerado;
}


// ============================================================
// ETAPA 5: VALIDAR O RESULTADO E SALVAR PRINT DA TELA
// ============================================================
// Depois que o vídeo for gerado, tiramos um print (screenshot)
// da tela para registrar o resultado e mostramos um checklist
// para você verificar se o vídeo ficou como esperado.

async function validarESalvarResultado(paginaGemini, nomeProduto) {
  console.log('\n📸 ETAPA 5: Salvando um print da tela com o resultado...');

  // ---- TIRA O SCREENSHOT ----
  // Cria um nome único para o arquivo usando o horário atual
  // Exemplo: resultado_video_1717000000000.png
  const timestamp = Date.now();
  const nomeArquivo = `resultado_video_${timestamp}.png`;

  // Tira o screenshot da página inteira (incluindo o que está fora da tela)
  await paginaGemini.screenshot({ path: nomeArquivo, fullPage: true });
  console.log(`   ✅ Print salvo no arquivo: "${nomeArquivo}"`);
  console.log(`   📁 Você pode encontrar esse arquivo na mesma pasta do script.`);

  // ---- CHECKLIST DE VALIDAÇÃO ----
  // Esse checklist te ajuda a verificar se o vídeo gerado ficou bom
  // antes de usar no TikTok Shop
  console.log('\n' + '='.repeat(65));
  console.log('  ✅ CHECKLIST — Verifique o vídeo no navegador:');
  console.log('='.repeat(65));
  console.log('');
  console.log('  [ ] 1. O vídeo mostra uma mulher fazendo um mirror selfie?');
  console.log(`  [ ] 2. A roupa mostrada corresponde ao produto:`);
  console.log(`         "${nomeProduto.substring(0, 50)}..."`);
  console.log('  [ ] 3. O vídeo é VERTICAL (formato 9:16, igual ao TikTok)?');
  console.log('  [ ] 4. A iluminação é natural (luz suave, ambiente de quarto)?');
  console.log('  [ ] 5. O estilo parece autêntico/UGC (não parece propaganda)?');
  console.log('  [ ] 6. Não há fala nem música — apenas sons de ambiente?');
  console.log('');
  console.log('='.repeat(65));
  console.log('');
  console.log('  ❌ Se o vídeo não ficou bom, peça ao Gemini para refazer:');
  console.log('     "Please regenerate the video with better lighting"');
  console.log('     "Make the clothing more visible in the video"');
  console.log('     "Regenerate with a more natural and authentic style"');
  console.log('');
  console.log('  ✅ Se ficou bom, faça o download do vídeo diretamente no Gemini');
  console.log('     e publique no TikTok Shop!');
  console.log('='.repeat(65));
}


// ============================================================
// FUNÇÃO AUXILIAR: Espera o usuário pressionar Enter no terminal
// ============================================================
// Usada quando o script precisa que você faça algo manualmente
// (como fazer login) antes de continuar.

function esperarEnter() {
  return new Promise(resolve => {
    console.log('   ⏸️  Script pausado — pressione ENTER quando estiver pronto...');
    process.stdin.resume(); // Ativa a leitura do teclado
    process.stdin.once('data', () => {
      process.stdin.pause(); // Desativa a leitura do teclado
      resolve(); // Continua o script
    });
  });
}


// ============================================================
// FUNÇÃO PRINCIPAL — CONTROLA TODAS AS ETAPAS EM SEQUÊNCIA
// ============================================================
// Essa é a função que roda primeiro quando você executa o script.
// Ela chama cada etapa na ordem certa e passa o resultado de uma
// etapa para a próxima.

async function main() {
  // Cabeçalho de boas-vindas no terminal
  console.log('\n' + '='.repeat(65));
  console.log('   🎬 GERADOR DE VÍDEOS TIKTOK SHOP COM IA — INICIANDO');
  console.log('='.repeat(65));
  console.log('');
  console.log('   ℹ️  O navegador vai abrir automaticamente.');
  console.log('   ℹ️  NÃO feche o navegador durante o processo!');
  console.log('   ℹ️  Acompanhe as mensagens aqui no terminal.\n');

  // ---- CRIA A PASTA DE PERFIL SE NÃO EXISTIR ----
  // Essa pasta guarda os cookies e logins do navegador.
  // Assim você não precisa fazer login toda vez que rodar o script.
  if (!fs.existsSync(PASTA_PERFIL)) {
    fs.mkdirSync(PASTA_PERFIL, { recursive: true });
    console.log('   📁 Pasta de perfil criada (guarda seus logins).');
  }

  console.log('⚙️  Iniciando o navegador...');

  // ---- INICIA O NAVEGADOR ----
  // 'launchPersistentContext' abre o navegador com perfil salvo
  // Isso mantém seus logins entre uma execução e outra
  const contexto = await chromium.launchPersistentContext(PASTA_PERFIL, {
    headless: false,          // false = navegador VISÍVEL na tela (recomendado)
                              // true = navegador invisível (só para avançados)
    args: ['--start-maximized'], // Abre o navegador maximizado (tela cheia)
    viewport: null            // Usa o tamanho real da janela do computador
  });

  console.log('   ✅ Navegador aberto com sucesso!\n');
  console.log('   ⚠️  ATENÇÃO — PRIMEIRA VEZ RODANDO:');
  console.log('   👉 Você vai precisar fazer login no Kalodata.');
  console.log('   👉 Você vai precisar fazer login no Google (para o Gemini).');
  console.log('   👉 Depois disso, os logins ficam salvos automaticamente!\n');

  // Abre a primeira aba do navegador para o Kalodata
  const paginaKalodata = await contexto.newPage();

  try {
    // ---- RODA CADA ETAPA EM SEQUÊNCIA ----

    // Etapa 1: Busca o produto no Kalodata
    // O resultado (nome do produto) é guardado em 'descricaoProduto'
    const descricaoProduto = await buscarProdutoKalodata(paginaKalodata);

    // Etapas 2 e 3: Abre o Gemini e digita o prompt com o produto
    // O resultado (aba do Gemini) é guardado em 'paginaGemini'
    const paginaGemini = await abrirGeminiEDigitarPrompt(contexto, descricaoProduto);

    // Etapa 4: Envia o prompt e aguarda o vídeo ser gerado
    await enviarEAguardarVideo(paginaGemini);

    // Etapa 5: Salva o print e mostra o checklist de validação
    await validarESalvarResultado(paginaGemini, descricaoProduto);

    // ---- MANTÉM O NAVEGADOR ABERTO ----
    // Deixa o navegador aberto para você baixar o vídeo manualmente
    console.log('\n🌐 Script concluído! O navegador ficará aberto para você interagir.');
    console.log('   Quando terminar, feche o navegador ou pressione CTRL+C aqui.\n');

    // Espera indefinidamente (até o usuário fechar o terminal com CTRL+C)
    await new Promise(() => {});

  } catch (erro) {
    // ---- TRATAMENTO DE ERROS ----
    // Se algo inesperado acontecer, mostra uma mensagem explicativa
    console.error(`\n❌ Ocorreu um erro inesperado: ${erro.message}`);
    console.log('\n   Possíveis causas:');
    console.log('   • Você não está logado no Kalodata');
    console.log('   • Você não está logado no Google/Gemini');
    console.log('   • Sua conexão com a internet caiu');
    console.log('   • O site do Kalodata ou Gemini mudou de layout');
    console.log('\n   💡 Tente rodar o script novamente.');
    console.log('   💡 Se o erro persistir, entre em contato com o suporte.\n');

    // Mantém o navegador aberto por 20 segundos para você ver o que aconteceu
    await paginaKalodata.waitForTimeout(20000);

  } finally {
    // 'finally' roda sempre — seja com sucesso ou com erro
    // Garante que o navegador seja fechado corretamente
    await contexto.close();
    console.log('   🔒 Navegador fechado. Até a próxima!');
  }
}


// ============================================================
// INICIA O SCRIPT
// ============================================================
// Essa linha chama a função principal para começar tudo.
// O '.catch(console.error)' mostra qualquer erro que não foi tratado.

main().catch(console.error);
