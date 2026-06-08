/**
 * =============================================================
 *   AGENTE TIKTOK SHOP — Interface de Comandos no Terminal
 *   Versão 5.0
 * =============================================================
 *
 * ▶️  COMO RODAR:
 *   node agente_tiktok.js
 *
 * 💬 COMANDOS DISPONÍVEIS:
 *   analisar              → Busca os 7 melhores produtos no Kalodata
 *   gerar                 → Gera vídeos para os produtos encontrados
 *   gerar 3               → Gera apenas 3 vídeos
 *   status                → Mostra produtos prontos para gerar vídeo
 *   historico             → Mostra produtos já usados
 *   relatorio             → Mostra relatório do dia
 *   agendar 09:00         → Agenda execução automática diária
 *   parar agendamento     → Para o agendamento automático
 *   limpar historico      → Limpa o histórico de produtos usados
 *   ajuda                 → Lista todos os comandos
 *   sair                  → Encerra o agente
 * =============================================================
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');


// ============================================================
// ⚙️  CONFIGURAÇÕES
// ============================================================

const CONFIG = {
  quantidadeDeVideos: 7,
  tempoMaximoPorVideo: 180000, // 3 minutos
  telegramToken: '',
  telegramChatId: '',
  arquivos: {
    historico: './historico.json',
    perfil: './perfil_navegador',
    relatorios: './relatorios',
    screenshots: './screenshots',
  }
};


// ============================================================
// 📦 ESTADO DO AGENTE
// Guarda os produtos encontrados e o contexto do navegador
// ============================================================

const ESTADO = {
  produtosEncontrados: [],   // Produtos buscados no Kalodata
  navegadorAberto: false,    // Se o navegador está aberto
  contexto: null,            // Contexto do Playwright
  agendamento: null,         // Timer do agendamento automático
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
// 📋 HISTÓRICO
// ============================================================

function carregarHistorico() {
  return JSON.parse(fs.readFileSync(CONFIG.arquivos.historico, 'utf8'));
}

function salvarHistorico(historico) {
  fs.writeFileSync(CONFIG.arquivos.historico, JSON.stringify(historico, null, 2));
}

function produtoJaUsado(nome) {
  const historico = carregarHistorico();
  const trintaDias = Date.now() - (30 * 24 * 60 * 60 * 1000);
  return historico.produtos.some(p =>
    p.nome.toLowerCase() === nome.toLowerCase() &&
    new Date(p.data).getTime() > trintaDias
  );
}

function registrarNoHistorico(nome, videoGerado) {
  const historico = carregarHistorico();
  historico.produtos.push({ nome, data: new Date().toISOString(), videoGerado });
  if (videoGerado) historico.totalVideos++;
  historico.ultimaExecucao = new Date().toISOString();
  salvarHistorico(historico);
}


// ============================================================
// 🌐 NAVEGADOR — Abre e fecha o Edge
// ============================================================

async function abrirNavegador() {
  if (ESTADO.navegadorAberto) return;

  const caminhoEdge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const executablePath = fs.existsSync(caminhoEdge) ? caminhoEdge : undefined;

  ESTADO.contexto = await chromium.launchPersistentContext(CONFIG.arquivos.perfil, {
    headless: false,
    executablePath,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: null,
  });

  ESTADO.navegadorAberto = true;
  console.log('   ✅ Navegador aberto.');
}

async function fecharNavegador() {
  if (ESTADO.contexto) {
    await ESTADO.contexto.close();
    ESTADO.contexto = null;
    ESTADO.navegadorAberto = false;
    console.log('   ✅ Navegador fechado.');
  }
}


// ============================================================
// 🛍️  COMANDO: analisar
// Busca os melhores produtos no Kalodata
// ============================================================

async function cmdAnalisar(quantidade) {
  console.log('\n📦 Abrindo o Kalodata para buscar produtos...');

  await abrirNavegador();
  const pagina = await ESTADO.contexto.newPage();

  try {
    await pagina.goto('https://www.kalodata.com/product', { waitUntil: 'load', timeout: 60000 });
  } catch {
    await pagina.goto('https://www.kalodata.com/product', { waitUntil: 'domcontentloaded', timeout: 60000 });
  }

  await pagina.waitForTimeout(3000);

  console.log('\n' + '='.repeat(55));
  console.log('   🔐 AÇÃO NECESSÁRIA — 1 clique!');
  console.log('='.repeat(55));
  console.log('   1. Clique em "Confirme que é humano" no navegador');
  console.log('   2. Espere a lista de produtos carregar');
  console.log('   3. Digite  continuar  aqui e pressione ENTER');
  console.log('='.repeat(55));

  // Aguarda o comando "continuar" pelo readline (não bloqueia o terminal)
  await aguardarComando('continuar');

  await pagina.waitForTimeout(2000);

  // Tenta aplicar filtros automaticamente
  try {
    await pagina.locator('text=Last 7 days, text=7 days').first().click({ timeout: 4000 });
    await pagina.waitForTimeout(1500);
    console.log('   ✅ Filtro de data: Últimos 7 dias');
  } catch { }

  try {
    await pagina.locator('text=Category, text=Categoria').first().click({ timeout: 4000 });
    await pagina.waitForTimeout(1000);
    await pagina.locator('text=Womenswear, text=Women, text=Roupas').first().click({ timeout: 4000 });
    await pagina.waitForTimeout(1000);
    await pagina.locator('text=Apply, text=Aplicar').first().click({ timeout: 4000 });
    await pagina.waitForTimeout(3000);
    console.log('   ✅ Filtro de categoria: Roupas Femininas');
  } catch { }

  // Palavras que indicam texto de interface (não produto)
  const textosDaInterface = [
    'product info', 'informações do produto', 'product information',
    'verificando', 'cloudflare', 'tendência', 'taxa', 'receita',
    'revenue', 'growth', 'rank', 'category', 'date', 'filter',
    'search', 'sort', 'price', 'commission', 'loading', 'aplicar',
    'apply', 'reset', 'itens vendidos', 'items sold', 'shop name',
    'seller', 'vendedor', 'followers', 'seguidores'
  ];

  // Palavras que indicam roupa feminina — filtra produtos irrelevantes
  const palavrasRoupas = [
    'vestido', 'blusa', 'calça', 'saia', 'conjunto', 'jaqueta', 'casaco',
    'moletom', 'cropped', 'top', 'legging', 'short', 'bermuda', 'macacão',
    'camiseta', 'camisa', 'regata', 'body', 'kimono', 'cardigan', 'suéter',
    'tricot', 'malha', 'feminina', 'feminino', 'mulher', 'woman', 'dress',
    'pants', 'jacket', 'blouse', 'skirt', 'coat', 'sweater', 'lingerie',
    'pijama', 'blusão', 'sobretudo', 'trench', 'blazer', 'colete'
  ];

  function isProdutoValido(texto) {
    const t = texto.toLowerCase().trim();
    if (t.length < 10 || t.length > 300) return false;
    if (textosDaInterface.some(p => t.includes(p))) return false;
    if (/^\d+([.,]\d+)?(%|k|m|r\$)?$/.test(t)) return false;
    return true;
  }

  function isProdutoRoupa(texto) {
    const t = texto.toLowerCase();
    return palavrasRoupas.some(p => t.includes(p));
  }

  console.log('   🔍 Analisando a página...');
  await pagina.waitForTimeout(2000);

  let produtos = await pagina.evaluate(() => {
    const seletores = [
      '[class*="product-name"]', '[class*="productName"]', '[class*="product_name"]',
      '[class*="item-name"]', '[class*="itemName"]', '[class*="goods-name"]',
      'td:nth-child(2) a', 'td:nth-child(2) span', '.ant-table-cell:nth-child(2)',
    ];
    for (const seletor of seletores) {
      const els = document.querySelectorAll(seletor);
      if (els.length >= 3) {
        const textos = Array.from(els).map(el => el.textContent.trim()).filter(t => t.length > 5);
        if (textos.length >= 3) return textos.slice(0, 20);
      }
    }
    const links = document.querySelectorAll('table a, .table a');
    if (links.length > 0) {
      return Array.from(links).map(el => el.textContent.trim()).filter(t => t.length > 5).slice(0, 20);
    }
    return [];
  });

  produtos = produtos.filter(isProdutoValido);

  if (produtos.length === 0) {
    console.log('\n   ⚠️  Não encontrei produtos automaticamente.');
    console.log('   👉 Role até ver a lista de produtos e digite  continuar  para tentar de novo.');
    await aguardarComando('continuar');

    produtos = await pagina.evaluate(() => {
      const todos = document.querySelectorAll('td, [class*="name"], a');
      return Array.from(todos).map(el => el.textContent.trim())
        .filter(t => t.length > 15 && t.length < 200).slice(0, 30);
    });
    produtos = produtos.filter(isProdutoValido);
  }

  // Prioriza roupas femininas, depois aceita qualquer roupa, depois qualquer produto
  const roupasFemininas = produtos.filter(p => isProdutoRoupa(p) && !produtoJaUsado(p));
  const qualquerRoupa = produtos.filter(p => isProdutoRoupa(p));
  const todos = produtos.filter(p => !produtoJaUsado(p));

  const qtd = quantidade || CONFIG.quantidadeDeVideos;
  const listaPriorizada = roupasFemininas.length >= 3 ? roupasFemininas
    : qualquerRoupa.length >= 3 ? qualquerRoupa
    : todos.length > 0 ? todos
    : produtos;

  ESTADO.produtosEncontrados = listaPriorizada.slice(0, qtd);

  if (roupasFemininas.length > 0) {
    console.log(`   👗 ${roupasFemininas.length} produto(s) de roupa feminina encontrado(s).`);
  } else {
    console.log('   ⚠️  Poucos produtos de roupa feminina — usando todos os produtos encontrados.');
    console.log('   💡 Dica: aplique o filtro "Womenswear" manualmente no Kalodata para melhores resultados.');
  }

  await pagina.close();

  if (ESTADO.produtosEncontrados.length === 0) {
    console.log('\n   ❌ Nenhum produto encontrado. Tente novamente.');
    return;
  }

  console.log(`\n   ✅ ${ESTADO.produtosEncontrados.length} produto(s) encontrado(s):\n`);
  ESTADO.produtosEncontrados.forEach((p, i) => {
    const jaUsado = produtoJaUsado(p) ? ' ⚠️ (já usado recentemente)' : '';
    console.log(`   ${i + 1}. ${p.substring(0, 65)}${jaUsado}`);
  });
  console.log('\n   💡 Digite "gerar" para criar os vídeos agora.');
}


// ============================================================
// 🎬 COMANDO: gerar
// Gera vídeos no Gemini para os produtos encontrados
// ============================================================

async function cmdGerar(quantidade) {
  if (ESTADO.produtosEncontrados.length === 0) {
    console.log('\n   ⚠️  Nenhum produto em memória. Digite "analisar" primeiro.');
    return;
  }

  const qtd = quantidade || ESTADO.produtosEncontrados.length;
  const lista = ESTADO.produtosEncontrados.slice(0, qtd);

  console.log(`\n🎬 Gerando ${lista.length} vídeo(s)...\n`);

  await abrirNavegador();

  let gerados = 0;
  let falhas = 0;

  for (let i = 0; i < lista.length; i++) {
    const produto = lista[i];
    console.log(`${'─'.repeat(55)}`);
    console.log(`🎬 Vídeo ${i + 1} de ${lista.length}: "${produto.substring(0, 50)}"`);
    console.log('─'.repeat(55));

    const ok = await gerarVideoGemini(produto, i + 1);
    registrarNoHistorico(produto, ok);

    if (ok) gerados++;
    else falhas++;

    // Remove da lista de pendentes
    ESTADO.produtosEncontrados = ESTADO.produtosEncontrados.filter(p => p !== produto);

    if (i < lista.length - 1) {
      console.log('   ⏸️  Aguardando 15s antes do próximo...');
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  const historico = carregarHistorico();
  console.log('\n' + '='.repeat(55));
  console.log('   🏁 GERAÇÃO CONCLUÍDA!');
  console.log(`   ✅ Gerados: ${gerados} | ❌ Falhas: ${falhas}`);
  console.log(`   📊 Total histórico: ${historico.totalVideos} vídeos`);
  console.log('='.repeat(55));

  await notificarTelegram(
    `🎬 <b>Vídeos gerados!</b>\n✅ ${gerados} gerados\n❌ ${falhas} falhas\n📊 Total: ${historico.totalVideos}`
  );

  // Salva relatório
  const data = new Date().toISOString().split('T')[0];
  const rel = `=== RELATÓRIO ${data} ===\nGerados: ${gerados} | Falhas: ${falhas}\n\nProdutos:\n${lista.map((p, i) => `${i+1}. ${p}`).join('\n')}`;
  fs.writeFileSync(path.join(CONFIG.arquivos.relatorios, `relatorio_${data}.txt`), rel);
  console.log(`\n   📊 Relatório salvo em /relatorios/relatorio_${data}.txt`);
}

// Função interna que gera um vídeo no Gemini
async function gerarVideoGemini(produto, numero) {
  const pagina = await ESTADO.contexto.newPage();
  try {
    await pagina.goto('https://gemini.google.com', { waitUntil: 'load', timeout: 60000 });
    await pagina.waitForTimeout(4000);

    // Verifica login
    const logado = await pagina.evaluate(() => {
      const t = document.body.innerText.toLowerCase();
      return !t.includes('fazer login') && !t.includes('sign in');
    });

    if (!logado) {
      console.log('   ⚠️  Gemini pediu login. Faça login no navegador.');
      console.log('   👉 Depois digite  continuar  aqui.');
      await aguardarComando('continuar');
    } else {
      console.log('   ✅ Gemini pronto.');
    }

    // Monta prompt adaptado ao tipo de roupa
    const prompt = montarPrompt(produto);

    // Digita e envia
    const campo = pagina.locator('[contenteditable="true"], textarea, [role="textbox"]').first();
    await campo.click({ timeout: 10000 });
    await pagina.waitForTimeout(500);
    await campo.type(prompt, { delay: 10 });

    try {
      await pagina.locator('button[aria-label*="Send"], button[aria-label*="Enviar"]').first().click({ timeout: 8000 });
    } catch {
      await pagina.keyboard.press('Enter');
    }
    console.log('   🚀 Prompt enviado. Aguardando vídeo...');

    // Aguarda geração
    const inicio = Date.now();
    let ok = false;
    while (Date.now() - inicio < CONFIG.tempoMaximoPorVideo) {
      const seg = Math.floor((Date.now() - inicio) / 1000);
      process.stdout.write(`   ⏱️  ${seg}s\r`);
      ok = await pagina.evaluate(() => {
        const t = document.body.innerText.toLowerCase();
        return t.includes('your video is ready') || t.includes('video is ready') ||
               t.includes('vídeo está pronto') || document.querySelector('video') !== null;
      }).catch(() => false);
      if (ok) { console.log(`\n   🎉 Vídeo ${numero} gerado!`); break; }
      await pagina.waitForTimeout(5000);
    }

    if (!ok) console.log(`\n   ⚠️  Tempo esgotado para o vídeo ${numero}.`);

    // Screenshot
    const arquivo = path.join(CONFIG.arquivos.screenshots, `video_${Date.now()}_${numero}.png`);
    await pagina.screenshot({ path: arquivo, fullPage: true });
    console.log(`   📸 Print: ${arquivo}`);

    return ok;
  } catch (e) {
    console.error(`   ❌ Erro: ${e.message}`);
    return false;
  } finally {
    await pagina.close();
  }
}

// Adapta o prompt conforme o tipo de roupa
function montarPrompt(produto) {
  const p = produto.toLowerCase();
  let estilo = 'mirror selfie in a bedroom';
  let audio = 'soft bedroom ambient sound, light breathing, soft footsteps on floor';

  if (p.includes('vestido') || p.includes('dress')) {
    estilo = 'mirror selfie in a bright bedroom, twirling slightly to show the dress flow';
  } else if (p.includes('calça') || p.includes('pants') || p.includes('legging')) {
    estilo = 'mirror selfie showing full body, emphasizing the fit of the pants';
  } else if (p.includes('blusa') || p.includes('camiseta') || p.includes('top')) {
    estilo = 'mirror selfie in a bedroom, showing upper body and tucking the top';
  } else if (p.includes('jaqueta') || p.includes('casaco') || p.includes('jacket')) {
    estilo = 'mirror selfie opening and closing the jacket to show the full look';
  }

  return (
    `Generate a vertical 9:16 video for TikTok: Vertical ${estilo} with soft natural lighting. ` +
    `A young woman wearing ${produto} holds her phone in front of her face, filming her reflection ` +
    `in a full-length mirror. Full body frontal pose, slight weight shift, small clothing adjustment. ` +
    `She takes a small step toward the mirror with a light body sway to show how the clothing drapes ` +
    `and moves, then slowly turns to a side profile showing the silhouette of the outfit in the mirror. ` +
    `Relaxed, natural posture. Authentic TikTok fitting room style, UGC handheld creator style, ` +
    `natural lighting. Audio: ${audio}, no speech, no music.`
  );
}


// ============================================================
// 📊 COMANDO: status
// Mostra produtos prontos para gerar vídeo
// ============================================================

function cmdStatus() {
  console.log('\n📋 STATUS DO AGENTE:\n');

  if (ESTADO.produtosEncontrados.length === 0) {
    console.log('   Nenhum produto em memória.');
    console.log('   → Digite "analisar" para buscar produtos no Kalodata.\n');
  } else {
    console.log(`   ${ESTADO.produtosEncontrados.length} produto(s) prontos para gerar vídeo:\n`);
    ESTADO.produtosEncontrados.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.substring(0, 65)}`);
    });
    console.log('\n   → Digite "gerar" para criar os vídeos.');
    console.log(`   → Digite "gerar 3" para criar apenas 3 vídeos.\n`);
  }

  const historico = carregarHistorico();
  console.log(`   📊 Total de vídeos gerados até hoje: ${historico.totalVideos}`);
  console.log(`   🕐 Última execução: ${historico.ultimaExecucao ? new Date(historico.ultimaExecucao).toLocaleString('pt-BR') : 'Nunca'}\n`);
}


// ============================================================
// 📜 COMANDO: historico
// Mostra os últimos produtos usados
// ============================================================

function cmdHistorico() {
  const historico = carregarHistorico();

  if (historico.produtos.length === 0) {
    console.log('\n   📋 Histórico vazio — nenhum produto gerado ainda.\n');
    return;
  }

  console.log(`\n📜 HISTÓRICO (últimos 20 produtos):\n`);
  const ultimos = historico.produtos.slice(-20).reverse();
  ultimos.forEach((p, i) => {
    const data = new Date(p.data).toLocaleDateString('pt-BR');
    const status = p.videoGerado ? '✅' : '❌';
    console.log(`   ${i + 1}. ${status} ${data} — ${p.nome.substring(0, 55)}`);
  });
  console.log(`\n   Total: ${historico.totalVideos} vídeos gerados\n`);
}


// ============================================================
// 📄 COMANDO: relatorio
// Mostra o relatório do dia atual
// ============================================================

function cmdRelatorio() {
  const data = new Date().toISOString().split('T')[0];
  const arquivo = path.join(CONFIG.arquivos.relatorios, `relatorio_${data}.txt`);

  if (!fs.existsSync(arquivo)) {
    console.log(`\n   📄 Nenhum relatório para hoje (${data}) ainda.\n`);
    return;
  }

  console.log('\n' + fs.readFileSync(arquivo, 'utf8'));
}


// ============================================================
// ⏰ COMANDO: agendar HH:MM
// Agenda execução automática diária
// ============================================================

function cmdAgendar(horario) {
  if (!horario || !/^\d{2}:\d{2}$/.test(horario)) {
    console.log('\n   ⚠️  Formato inválido. Use: agendar 09:00\n');
    return;
  }

  if (ESTADO.agendamento) {
    clearTimeout(ESTADO.agendamento);
    ESTADO.agendamento = null;
  }

  const [hora, minuto] = horario.split(':').map(Number);

  function agendarProxima() {
    const agora = new Date();
    const proxima = new Date();
    proxima.setHours(hora, minuto, 0, 0);
    if (proxima <= agora) proxima.setDate(proxima.getDate() + 1);

    const ms = proxima - agora;
    const h = Math.floor(ms / 1000 / 60 / 60);
    const m = Math.floor((ms / 1000 / 60) % 60);

    console.log(`\n   ⏰ Agendado para ${proxima.toLocaleString('pt-BR')} (em ${h}h ${m}min)`);
    console.log('   ℹ️  Deixe o terminal aberto. Use "parar agendamento" para cancelar.\n');

    ESTADO.agendamento = setTimeout(async () => {
      console.log('\n🔔 Horário agendado! Iniciando execução automática...\n');
      await cmdAnalisar();
      await cmdGerar();
      agendarProxima(); // Agenda o próximo dia
    }, ms);
  }

  agendarProxima();
}


// ============================================================
// 🧹 COMANDO: limpar historico
// ============================================================

function cmdLimparHistorico() {
  salvarHistorico({ produtos: [], totalVideos: 0, ultimaExecucao: null });
  ESTADO.produtosEncontrados = [];
  console.log('\n   ✅ Histórico limpo com sucesso.\n');
}


// ============================================================
// ❓ COMANDO: ajuda
// ============================================================

function cmdAjuda() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║          AGENTE TIKTOK SHOP — COMANDOS               ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  analisar           Busca produtos no Kalodata       ║
║  analisar 5         Busca apenas 5 produtos          ║
║                                                      ║
║  gerar              Gera vídeos de todos os produtos ║
║  gerar 3            Gera apenas 3 vídeos             ║
║                                                      ║
║  status             Mostra produtos na memória       ║
║  historico          Mostra produtos já usados        ║
║  relatorio          Mostra relatório do dia          ║
║                                                      ║
║  agendar 09:00      Agenda execução diária às 9h     ║
║  parar agendamento  Cancela o agendamento            ║
║                                                      ║
║  limpar historico   Limpa o histórico de produtos    ║
║  fechar navegador   Fecha o navegador                ║
║  ajuda              Mostra estes comandos            ║
║  sair               Encerra o agente                 ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
`);
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
// 🔧 UTILITÁRIOS
// ============================================================

// Aguarda um comando específico via readline (não bloqueia o terminal)
// Usado para pausas onde o usuário precisa fazer algo no navegador
let _resolverComando = null;
let _comandoEsperado = null;

function aguardarComando(cmd) {
  _comandoEsperado = cmd;
  return new Promise(resolve => { _resolverComando = resolve; });
}

function esperarEnter() {
  return new Promise(resolve => {
    process.stdin.resume();
    process.stdin.once('data', () => { process.stdin.pause(); resolve(); });
  });
}


// ============================================================
// 💬 INTERFACE DE COMANDOS NO TERMINAL
// ============================================================

async function iniciarInterface() {
  inicializar();

  // Cabeçalho
  console.log('\n' + '='.repeat(55));
  console.log('   🤖 AGENTE TIKTOK SHOP v5.0');
  console.log('   Gerador automático de vídeos com IA');
  console.log('='.repeat(55));
  console.log('   Digite "ajuda" para ver os comandos disponíveis.');
  console.log('   Digite "analisar" para começar.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });

  rl.prompt();

  rl.on('line', async (linha) => {
    const cmd = linha.trim().toLowerCase();
    const partes = cmd.split(' ');
    const comando = partes[0];
    const argumento = partes[1];

    // Se está esperando um comando específico (ex: "continuar"), resolve a promessa
    if (_comandoEsperado && cmd === _comandoEsperado) {
      _comandoEsperado = null;
      const resolver = _resolverComando;
      _resolverComando = null;
      resolver();
      rl.prompt();
      return;
    }

    try {
      if (comando === 'analisar') {
        await cmdAnalisar(argumento ? parseInt(argumento) : null);

      } else if (comando === 'gerar') {
        await cmdGerar(argumento ? parseInt(argumento) : null);

      } else if (comando === 'status') {
        cmdStatus();

      } else if (comando === 'historico') {
        cmdHistorico();

      } else if (comando === 'relatorio') {
        cmdRelatorio();

      } else if (comando === 'agendar') {
        cmdAgendar(argumento);

      } else if (cmd === 'parar agendamento') {
        if (ESTADO.agendamento) {
          clearTimeout(ESTADO.agendamento);
          ESTADO.agendamento = null;
          console.log('\n   ✅ Agendamento cancelado.\n');
        } else {
          console.log('\n   ℹ️  Nenhum agendamento ativo.\n');
        }

      } else if (cmd === 'limpar historico') {
        cmdLimparHistorico();

      } else if (cmd === 'fechar navegador') {
        await fecharNavegador();

      } else if (comando === 'ajuda' || comando === 'help') {
        cmdAjuda();

      } else if (comando === 'sair' || comando === 'exit') {
        console.log('\n   👋 Encerrando o agente...\n');
        await fecharNavegador();
        process.exit(0);

      } else if (cmd === '') {
        // Linha em branco — não faz nada

      } else {
        console.log(`\n   ❓ Comando não reconhecido: "${cmd}"`);
        console.log('   Digite "ajuda" para ver os comandos disponíveis.\n');
      }

    } catch (e) {
      console.error(`\n   ❌ Erro ao executar comando: ${e.message}\n`);
    }

    rl.prompt();
  });

  rl.on('close', async () => {
    await fecharNavegador();
    process.exit(0);
  });
}

// Inicia a interface
iniciarInterface().catch(console.error);
