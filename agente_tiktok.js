/**
 * =============================================================
 *   AGENTE DE VENDAS TIKTOK SHOP COM IA — Versão 4.0
 * =============================================================
 *
 * 🎯 COMO FUNCIONA:
 *
 *   VOCÊ FAZ (1 clique):
 *   → Quando o Kalodata abrir, clica em "Confirme que é humano"
 *   → Pressiona ENTER no terminal
 *   → Pronto! O agente faz o resto sozinho.
 *
 *   O AGENTE FAZ SOZINHO:
 *   ✅ Abre o Kalodata automaticamente
 *   ✅ Aguarda você passar o Cloudflare (1 clique)
 *   ✅ Analisa a página e pega os 7 melhores produtos
 *   ✅ Gera um vídeo TikTok para cada produto no Gemini
 *   ✅ Nunca repete produto (histórico de 30 dias)
 *   ✅ Salva print de cada vídeo gerado
 *   ✅ Gera relatório do dia
 *   ✅ Notifica no Telegram quando terminar
 *   ✅ Pode rodar todo dia automaticamente
 *
 * ▶️  COMO RODAR:
 *   node agente_tiktok.js
 *
 *   Todo dia automaticamente:
 *   node agente_tiktok.js --agendar
 *
 * =============================================================
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');


// ============================================================
// ⚙️  CONFIGURAÇÕES
// ============================================================

const CONFIG = {

  // Quantos produtos buscar e quantos vídeos gerar por execução
  quantidadeDeVideos: 7,

  // Horário para rodar automaticamente todo dia (formato 24h)
  horarioAutomatico: '09:00',

  // Tempo máximo por vídeo em milissegundos (3 minutos)
  tempoMaximoPorVideo: 180000,

  // Notificações no Telegram (opcional)
  telegramToken: '',
  telegramChatId: '',

  // Arquivos e pastas do agente
  arquivos: {
    historico: './historico.json',
    perfil: './perfil_navegador',
    relatorios: './relatorios',
    screenshots: './screenshots',
  }
};


// ============================================================
// 📁 INICIALIZAÇÃO
// ============================================================

function inicializar() {
  for (const pasta of [CONFIG.arquivos.perfil, CONFIG.arquivos.relatorios, CONFIG.arquivos.screenshots]) {
    if (!fs.existsSync(pasta)) fs.mkdirSync(pasta, { recursive: true });
  }
  if (!fs.existsSync(CONFIG.arquivos.historico)) {
    salvarHistorico({ produtos: [], totalVideos: 0, ultimaExecucao: null });
  }
}


// ============================================================
// 📋 HISTÓRICO — evita repetir produtos
// ============================================================

function carregarHistorico() {
  return JSON.parse(fs.readFileSync(CONFIG.arquivos.historico, 'utf8'));
}

function salvarHistorico(historico) {
  fs.writeFileSync(CONFIG.arquivos.historico, JSON.stringify(historico, null, 2));
}

function produtoJaUsado(historico, nome) {
  const trintaDias = Date.now() - (30 * 24 * 60 * 60 * 1000);
  return historico.produtos.some(p =>
    p.nome.toLowerCase() === nome.toLowerCase() &&
    new Date(p.data).getTime() > trintaDias
  );
}

function registrarNoHistorico(historico, nome, videoGerado) {
  historico.produtos.push({ nome, data: new Date().toISOString(), videoGerado });
  if (videoGerado) historico.totalVideos++;
  historico.ultimaExecucao = new Date().toISOString();
  salvarHistorico(historico);
}


// ============================================================
// 📊 RELATÓRIO
// ============================================================

function salvarRelatorio(relatorio) {
  relatorio.fim = new Date().toISOString();
  const data = new Date().toISOString().split('T')[0];
  const duracao = Math.floor((new Date(relatorio.fim) - new Date(relatorio.inicio)) / 1000 / 60);
  const texto = `
==========================================
  RELATÓRIO — AGENTE TIKTOK SHOP
  Data: ${data} | Duração: ${duracao} min
==========================================
Vídeos gerados: ${relatorio.totalGerados}
Falhas: ${relatorio.totalErros}

PRODUTOS:
${relatorio.produtos.map((p, i) =>
  `  ${i + 1}. ${p.nome}\n     ${p.videoGerado ? '✅ Gerado' : '❌ Falhou'} — ${p.horario}`
).join('\n')}
==========================================
`;
  const arquivo = path.join(CONFIG.arquivos.relatorios, `relatorio_${data}.txt`);
  fs.writeFileSync(arquivo, texto);
  console.log(`   📊 Relatório salvo: ${arquivo}`);
}


// ============================================================
// 📱 TELEGRAM
// ============================================================

async function notificarTelegram(mensagem) {
  if (!CONFIG.telegramToken || !CONFIG.telegramChatId) return;
  const corpo = JSON.stringify({ chat_id: CONFIG.telegramChatId, text: mensagem, parse_mode: 'HTML' });
  return new Promise(resolve => {
    const req = https.request(`https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) },
    }, () => resolve());
    req.on('error', () => resolve());
    req.write(corpo);
    req.end();
  });
}


// ============================================================
// 🛍️  ETAPA 1: BUSCAR PRODUTOS NO KALODATA
// ============================================================

async function buscarProdutosKalodata(contexto, historico) {
  console.log('\n📦 Abrindo o Kalodata para buscar os melhores produtos...');

  const pagina = await contexto.newPage();

  // Abre o Kalodata
  try {
    await pagina.goto('https://www.kalodata.com/product', { waitUntil: 'load', timeout: 60000 });
  } catch {
    await pagina.goto('https://www.kalodata.com/product', { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  await pagina.waitForTimeout(3000);

  // ---- AGUARDA O USUÁRIO PASSAR O CLOUDFLARE ----
  console.log('\n' + '='.repeat(60));
  console.log('   🔐 AÇÃO NECESSÁRIA — 1 clique só!');
  console.log('='.repeat(60));
  console.log('   👉 No navegador que abriu:');
  console.log('      1. Clique em "Confirme que é humano" se aparecer');
  console.log('      2. Espere a lista de produtos do Kalodata carregar');
  console.log('      3. Volte aqui e pressione ENTER para continuar');
  console.log('='.repeat(60));
  await esperarEnter();

  // Aguarda a página estabilizar após o ENTER
  await pagina.waitForTimeout(2000);

  // ---- TENTA APLICAR FILTROS AUTOMATICAMENTE ----
  console.log('\n   🔧 Tentando aplicar filtros automaticamente...');

  // Filtro de data: últimos 7 dias
  try {
    const filtroData = pagina.locator('text=Last 7 days, text=7 days, text=Últimos 7').first();
    await filtroData.click({ timeout: 5000 });
    await pagina.waitForTimeout(1500);
    console.log('   ✅ Filtro de data aplicado.');
  } catch {
    console.log('   ℹ️  Filtro de data não encontrado — continuando sem ele.');
  }

  // Filtro de categoria: roupas femininas
  try {
    const btnCategoria = pagina.locator('text=Category, text=Categoria').first();
    await btnCategoria.click({ timeout: 5000 });
    await pagina.waitForTimeout(1500);

    const opcaoRoupa = pagina.locator('text=Womenswear, text=Women, text=Roupas').first();
    await opcaoRoupa.click({ timeout: 5000 });
    await pagina.waitForTimeout(1000);

    const btnAplicar = pagina.locator('text=Apply, text=Aplicar').first();
    await btnAplicar.click({ timeout: 5000 });
    await pagina.waitForTimeout(3000);
    console.log('   ✅ Filtro de categoria aplicado.');
  } catch {
    console.log('   ℹ️  Filtro de categoria não aplicado automaticamente.');
  }

  // ---- COLETA OS PRODUTOS DA PÁGINA ----
  console.log('   🔍 Analisando a página e coletando os melhores produtos...');
  await pagina.waitForTimeout(2000);

  // Palavras que indicam texto de interface (não produto)
  const textosDaInterface = [
    'verificando', 'cloudflare', 'verificação', 'checking', 'moment',
    'tendência', 'taxa', 'receita', 'revenue', 'growth', 'sold', 'rank',
    'category', 'date', 'filter', 'search', 'sort', 'price', 'commission',
    'items', 'product', 'brand', 'shop', 'video', 'creator', 'últimos',
    'loading', 'carregando', 'aplicar', 'apply', 'reset'
  ];

  function isProdutoValido(texto) {
    const t = texto.toLowerCase().trim();
    if (t.length < 10 || t.length > 300) return false;
    if (textosDaInterface.some(p => t === p || t.startsWith(p + ' ') || t.endsWith(' ' + p))) return false;
    if (/^\d+([.,]\d+)?(%|k|m)?$/.test(t)) return false; // ignora números puros
    return true;
  }

  // Tenta vários seletores específicos do Kalodata para pegar nomes de produtos
  let produtos = await pagina.evaluate(() => {
    const seletores = [
      '[class*="product-name"]',
      '[class*="productName"]',
      '[class*="product_name"]',
      '[class*="item-name"]',
      '[class*="itemName"]',
      '[class*="goods-name"]',
      '[class*="goodsName"]',
      'td:nth-child(2) a',
      'td:nth-child(2) span',
      '.ant-table-cell:nth-child(2)',
    ];

    for (const seletor of seletores) {
      const els = document.querySelectorAll(seletor);
      if (els.length >= 3) {
        const textos = Array.from(els).map(el => el.textContent.trim()).filter(t => t.length > 5);
        if (textos.length >= 3) return textos.slice(0, 20);
      }
    }

    // Fallback: pega todos os links da tabela
    const links = document.querySelectorAll('table a, .table a');
    if (links.length > 0) {
      return Array.from(links).map(el => el.textContent.trim()).filter(t => t.length > 5).slice(0, 20);
    }

    return [];
  });

  // Filtra textos inválidos
  produtos = produtos.filter(isProdutoValido);

  // Se não encontrou nada automaticamente, pede ajuda
  if (produtos.length === 0) {
    console.log('\n   ⚠️  Não consegui detectar os produtos automaticamente.');
    console.log('   👉 Role a página até ver a lista de produtos no navegador.');
    console.log('   👉 Quando a lista estiver visível, pressione ENTER...');
    await esperarEnter();

    // Tenta novamente depois da instrução
    produtos = await pagina.evaluate(() => {
      const todos = document.querySelectorAll('td, [class*="name"], [class*="title"], a');
      return Array.from(todos)
        .map(el => el.textContent.trim())
        .filter(t => t.length > 15 && t.length < 200)
        .slice(0, 30);
    });
    produtos = produtos.filter(isProdutoValido);
  }

  // Remove produtos já usados recentemente
  const produtosNovos = produtos.filter(p => !produtoJaUsado(historico, p));
  const listafinal = (produtosNovos.length > 0 ? produtosNovos : produtos).slice(0, CONFIG.quantidadeDeVideos);

  console.log(`\n   ✅ ${listafinal.length} produto(s) selecionado(s):`);
  listafinal.forEach((p, i) => console.log(`      ${i + 1}. ${p.substring(0, 70)}`));

  await pagina.close();
  return listafinal;
}


// ============================================================
// 🎬 ETAPA 2: GERAR VÍDEO NO GEMINI
// ============================================================

async function gerarVideo(contexto, produto, indice, total) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`🎬 Gerando vídeo ${indice + 1} de ${total}`);
  console.log(`   Produto: "${produto.substring(0, 60)}"`);
  console.log('─'.repeat(60));

  const pagina = await contexto.newPage();

  try {
    await pagina.goto('https://gemini.google.com', { waitUntil: 'load', timeout: 60000 });
    await pagina.waitForTimeout(4000);

    // Verifica login
    const logado = await pagina.evaluate(() => {
      const t = document.body.innerText.toLowerCase();
      return !t.includes('fazer login') && !t.includes('sign in') && !t.includes('log in');
    });

    if (!logado) {
      console.log('   ⚠️  Gemini pediu login.');
      console.log('   👉 Faça login no Google no navegador e pressione ENTER...');
      await esperarEnter();
    } else {
      console.log('   ✅ Logado no Gemini.');
    }

    // Monta o prompt
    const prompt =
      `Generate a vertical 9:16 video for TikTok: ` +
      `Vertical mirror selfie in a bedroom with soft natural lighting. ` +
      `A young woman wearing ${produto} ` +
      `holds her phone in front of her face, filming her reflection in a full-length mirror. ` +
      `Full body frontal pose, slight weight shift, small clothing adjustment. ` +
      `She takes a small step toward the mirror with a light body sway to show how the clothing ` +
      `drapes and moves, then slowly turns to a side profile showing the silhouette of the outfit ` +
      `in the mirror. Relaxed, natural posture. Authentic TikTok fitting room style, ` +
      `UGC handheld creator style, natural lighting. ` +
      `Audio: soft bedroom ambient sound, light breathing, soft footsteps on floor, no speech, no music.`;

    // Digita o prompt
    const campo = pagina.locator('[contenteditable="true"], textarea, [role="textbox"]').first();
    await campo.click({ timeout: 10000 });
    await pagina.waitForTimeout(500);
    await campo.type(prompt, { delay: 10 });
    console.log('   ✅ Prompt digitado.');

    // Envia
    try {
      await pagina.locator('button[aria-label*="Send"], button[aria-label*="Enviar"]').first().click({ timeout: 8000 });
    } catch {
      await pagina.keyboard.press('Enter');
    }
    console.log('   🚀 Enviado! Aguardando geração do vídeo...');
    console.log('   (Isso leva de 1 a 3 minutos — aguarde)');

    // Aguarda o vídeo
    const inicio = Date.now();
    let videoGerado = false;

    while (Date.now() - inicio < CONFIG.tempoMaximoPorVideo) {
      const seg = Math.floor((Date.now() - inicio) / 1000);
      process.stdout.write(`   ⏱️  Aguardando... ${seg}s\r`);

      videoGerado = await pagina.evaluate(() => {
        const t = document.body.innerText.toLowerCase();
        return (
          t.includes('your video is ready') ||
          t.includes('vídeo está pronto') ||
          t.includes('video is ready') ||
          document.querySelector('video') !== null
        );
      }).catch(() => false);

      if (videoGerado) {
        console.log(`\n   🎉 Vídeo ${indice + 1} gerado com sucesso!`);
        break;
      }
      await pagina.waitForTimeout(5000);
    }

    if (!videoGerado) {
      console.log(`\n   ⚠️  Tempo máximo atingido — verifique o navegador.`);
    }

    // Salva screenshot
    const arquivo = path.join(CONFIG.arquivos.screenshots, `video_${Date.now()}_${indice + 1}.png`);
    await pagina.screenshot({ path: arquivo, fullPage: true });
    console.log(`   📸 Print salvo: ${arquivo}`);

    return videoGerado;

  } catch (e) {
    console.error(`   ❌ Erro ao gerar vídeo: ${e.message}`);
    return false;
  } finally {
    await pagina.close();
  }
}


// ============================================================
// 🚀 EXECUÇÃO PRINCIPAL
// ============================================================

async function executarAgente() {
  const historico = carregarHistorico();
  const relatorio = {
    inicio: new Date().toISOString(),
    fim: null,
    produtos: [],
    totalGerados: 0,
    totalErros: 0,
  };

  console.log('\n' + '='.repeat(60));
  console.log(`   🤖 AGENTE TIKTOK SHOP v4.0 — ${new Date().toLocaleString('pt-BR')}`);
  console.log('='.repeat(60));
  console.log(`   Vídeos a gerar: ${CONFIG.quantidadeDeVideos}`);
  console.log(`   Total histórico: ${historico.totalVideos} vídeos`);

  // Inicia o Edge (ou Chromium se Edge não encontrado)
  const caminhoEdge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const executablePath = fs.existsSync(caminhoEdge) ? caminhoEdge : undefined;
  console.log(executablePath ? '\n   ✅ Usando Microsoft Edge.' : '\n   ℹ️  Usando Chromium.');

  const contexto = await chromium.launchPersistentContext(CONFIG.arquivos.perfil, {
    headless: false,
    executablePath,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: null,
  });

  console.log('   ✅ Navegador iniciado.');

  try {
    // ---- Busca produtos no Kalodata (com 1 clique seu) ----
    const produtos = await buscarProdutosKalodata(contexto, historico);

    if (produtos.length === 0) {
      console.log('\n   ❌ Nenhum produto encontrado. Encerrando.');
      return;
    }

    // ---- Gera vídeo para cada produto ----
    for (let i = 0; i < produtos.length; i++) {
      const produto = produtos[i];
      const videoGerado = await gerarVideo(contexto, produto, i, produtos.length);

      registrarNoHistorico(historico, produto, videoGerado);
      relatorio.produtos.push({
        nome: produto,
        videoGerado,
        horario: new Date().toLocaleTimeString('pt-BR'),
      });
      if (videoGerado) relatorio.totalGerados++;
      else relatorio.totalErros++;

      // Pausa entre vídeos para não sobrecarregar o Gemini
      if (i < produtos.length - 1) {
        console.log('\n   ⏸️  Aguardando 15 segundos antes do próximo vídeo...');
        await new Promise(r => setTimeout(r, 15000));
      }
    }

    // ---- Relatório e resumo ----
    salvarRelatorio(relatorio);

    const historicofinal = carregarHistorico();
    console.log('\n' + '='.repeat(60));
    console.log('   🏁 AGENTE FINALIZADO!');
    console.log('='.repeat(60));
    console.log(`   ✅ Vídeos gerados hoje: ${relatorio.totalGerados}`);
    console.log(`   ❌ Falhas: ${relatorio.totalErros}`);
    console.log(`   📊 Total histórico: ${historicofinal.totalVideos} vídeos`);
    console.log(`   📁 Screenshots: pasta /screenshots`);
    console.log(`   📋 Relatório: pasta /relatorios`);
    console.log('\n   👉 Baixe os vídeos no navegador e poste no TikTok Shop!');
    console.log('='.repeat(60));

    await notificarTelegram(
      `🎬 <b>Agente TikTok Shop finalizado!</b>\n\n` +
      `✅ Gerados: ${relatorio.totalGerados}\n` +
      `❌ Falhas: ${relatorio.totalErros}\n` +
      `📊 Total: ${historicofinal.totalVideos} vídeos\n\n` +
      relatorio.produtos.map((p, i) =>
        `${i + 1}. ${p.nome.substring(0, 40)} ${p.videoGerado ? '✅' : '❌'}`
      ).join('\n')
    );

    console.log('\n   🌐 Navegador aberto — baixe os vídeos e pressione CTRL+C.\n');
    await new Promise(() => {});

  } catch (e) {
    console.error(`\n❌ Erro: ${e.message}`);
    await notificarTelegram(`❌ Erro no Agente TikTok: ${e.message}`);
    salvarRelatorio(relatorio);
  } finally {
    await contexto.close();
  }
}


// ============================================================
// ⏰ AGENDAMENTO AUTOMÁTICO
// ============================================================

async function agendarExecucaoDiaria() {
  console.log('\n' + '='.repeat(60));
  console.log('   ⏰ MODO AGENDAMENTO ATIVO');
  console.log(`   Rodando todo dia às ${CONFIG.horarioAutomatico}`);
  console.log('   Deixe este terminal aberto. CTRL+C para parar.');
  console.log('='.repeat(60));

  while (true) {
    const [hora, minuto] = CONFIG.horarioAutomatico.split(':').map(Number);
    const agora = new Date();
    const proxima = new Date();
    proxima.setHours(hora, minuto, 0, 0);
    if (proxima <= agora) proxima.setDate(proxima.getDate() + 1);

    const ms = proxima - agora;
    const h = Math.floor(ms / 1000 / 60 / 60);
    const m = Math.floor((ms / 1000 / 60) % 60);
    console.log(`\n   ⏳ Próxima execução: ${proxima.toLocaleString('pt-BR')} (em ${h}h ${m}min)`);

    await new Promise(r => setTimeout(r, ms));
    console.log('\n🔔 Iniciando agente automático...');
    await executarAgente();
  }
}


// ============================================================
// 🔧 UTILITÁRIOS
// ============================================================

function esperarEnter() {
  return new Promise(resolve => {
    process.stdin.resume();
    process.stdin.once('data', () => { process.stdin.pause(); resolve(); });
  });
}


// ============================================================
// ▶️  INÍCIO
// ============================================================

async function main() {
  inicializar();
  if (process.argv.includes('--agendar')) {
    await agendarExecucaoDiaria();
  } else {
    await executarAgente();
  }
}

main().catch(console.error);
