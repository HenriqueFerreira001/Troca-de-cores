/**
 * =============================================================
 *   AGENTE DE VENDAS TIKTOK SHOP COM IA — Versão 3.0
 * =============================================================
 *
 * 🎯 COMO FUNCIONA:
 *
 *   VOCÊ FAZ (30 segundos por dia):
 *   → Abre o Kalodata ou Kalowave no seu navegador
 *   → Copia os nomes dos produtos que quer divulgar
 *   → Cola no arquivo "produtos.txt" (um produto por linha)
 *
 *   O AGENTE FAZ SOZINHO:
 *   ✅ Lê os produtos do arquivo produtos.txt
 *   ✅ Gera um vídeo TikTok para cada produto no Gemini
 *   ✅ Nunca repete produto (histórico de 30 dias)
 *   ✅ Salva print de cada vídeo gerado
 *   ✅ Gera relatório do dia em texto
 *   ✅ Notifica no Telegram quando terminar
 *   ✅ Pode rodar automaticamente todo dia no horário que você definir
 *
 * ▶️  COMO RODAR:
 *   Rodar uma vez agora:
 *     node agente_tiktok.js
 *
 *   Rodar todo dia automaticamente (deixe o PC ligado):
 *     node agente_tiktok.js --agendar
 *
 * =============================================================
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');


// ============================================================
// ⚙️  CONFIGURAÇÕES — EDITE AQUI CONFORME SUA NECESSIDADE
// ============================================================

const CONFIG = {

  // Quantos vídeos gerar por execução
  // O agente vai pegar esse número de produtos do arquivo produtos.txt
  quantidadeDeVideos: 3,

  // Horário para rodar automaticamente todo dia (formato 24h)
  horarioAutomatico: '09:00',

  // Tempo máximo por vídeo em milissegundos (3 minutos)
  tempoMaximoPorVideo: 180000,

  // Notificações no Telegram (opcional)
  // Veja como configurar no final do arquivo
  telegramToken: '',
  telegramChatId: '',

  // Arquivos e pastas do agente
  arquivos: {
    produtos: './produtos.txt',       // ← VOCÊ EDITA ESSE ARQUIVO
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
  // Cria pastas necessárias
  for (const pasta of [CONFIG.arquivos.perfil, CONFIG.arquivos.relatorios, CONFIG.arquivos.screenshots]) {
    if (!fs.existsSync(pasta)) {
      fs.mkdirSync(pasta, { recursive: true });
    }
  }

  // Cria histórico se não existir
  if (!fs.existsSync(CONFIG.arquivos.historico)) {
    salvarHistorico({ produtos: [], totalVideos: 0, ultimaExecucao: null });
  }

  // Cria o arquivo produtos.txt com instruções se não existir
  if (!fs.existsSync(CONFIG.arquivos.produtos)) {
    fs.writeFileSync(CONFIG.arquivos.produtos, `# ARQUIVO DE PRODUTOS — AGENTE TIKTOK SHOP
# ============================================
# INSTRUÇÕES:
#   1. Acesse kalodata.com ou kalowave.com no seu navegador
#   2. Filtre por Roupas Femininas / Últimos 7 dias
#   3. Copie os nomes dos produtos mais vendidos
#   4. Cole abaixo (um produto por linha)
#   5. Salve o arquivo e rode o agente
#
# DICA: Quanto mais detalhada a descrição, melhor o vídeo!
# Exemplo: Vestido midi floral com manga bufante e decote V, cor rose
#
# Linhas começando com # são ignoradas pelo agente.
# ============================================

# Cole seus produtos abaixo:
`);
    console.log('   📝 Arquivo produtos.txt criado! Adicione seus produtos nele.');
  }
}


// ============================================================
// 📋 LEITURA DO ARQUIVO PRODUTOS.TXT
// ============================================================

function lerProdutos() {
  const conteudo = fs.readFileSync(CONFIG.arquivos.produtos, 'utf8');

  // Lê linha por linha, ignora comentários e linhas vazias
  const produtos = conteudo
    .split('\n')
    .map(linha => linha.trim())
    .filter(linha => linha.length > 0 && !linha.startsWith('#'));

  return produtos;
}

function removerProdutoUsado(nomeProduto) {
  // Remove o produto do arquivo depois de usar, para não repetir
  const conteudo = fs.readFileSync(CONFIG.arquivos.produtos, 'utf8');
  const linhas = conteudo.split('\n');
  const novasLinhas = linhas.filter(linha => linha.trim() !== nomeProduto);
  fs.writeFileSync(CONFIG.arquivos.produtos, novasLinhas.join('\n'));
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

function registrarNoHistorico(historico, nomeProduto, videoGerado) {
  historico.produtos.push({
    nome: nomeProduto,
    data: new Date().toISOString(),
    videoGerado,
  });
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
  RELATÓRIO DO AGENTE TIKTOK SHOP
  Data: ${data}
  Duração: ${duracao} minutos
==========================================

Vídeos gerados: ${relatorio.totalGerados}
Falhas: ${relatorio.totalErros}

PRODUTOS:
${relatorio.produtos.map((p, i) =>
  `  ${i + 1}. ${p.nome}\n     ${p.videoGerado ? '✅ Vídeo gerado' : '❌ Falhou'} — ${p.horario}`
).join('\n')}

==========================================
`;
  const nomeArquivo = path.join(CONFIG.arquivos.relatorios, `relatorio_${data}.txt`);
  fs.writeFileSync(nomeArquivo, texto);
  console.log(`   📊 Relatório salvo: ${nomeArquivo}`);
}


// ============================================================
// 📱 NOTIFICAÇÃO TELEGRAM
// ============================================================

async function notificarTelegram(mensagem) {
  if (!CONFIG.telegramToken || !CONFIG.telegramChatId) return;

  const corpo = JSON.stringify({ chat_id: CONFIG.telegramChatId, text: mensagem, parse_mode: 'HTML' });
  return new Promise(resolve => {
    const req = https.request(`https://api.telegram.org/bot${CONFIG.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) },
    }, res => {
      if (res.statusCode === 200) console.log('   📱 Notificação Telegram enviada!');
      resolve();
    });
    req.on('error', () => resolve());
    req.write(corpo);
    req.end();
  });
}


// ============================================================
// 🤖 GERAR VÍDEO NO GEMINI
// ============================================================

async function gerarVideo(contexto, produto, indice, total) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`🎬 Vídeo ${indice + 1} de ${total}: "${produto.substring(0, 55)}..."`);
  console.log('─'.repeat(60));

  const pagina = await contexto.newPage();

  try {
    // Abre o Gemini
    await pagina.goto('https://gemini.google.com', { waitUntil: 'load', timeout: 60000 });
    await pagina.waitForTimeout(4000);

    // Verifica se está logado
    const logado = await pagina.evaluate(() => {
      return !document.body.innerText.toLowerCase().includes('fazer login') &&
             !document.body.innerText.toLowerCase().includes('sign in');
    });

    if (!logado) {
      console.log('   ⚠️  Gemini pediu login. Faça login no navegador e pressione ENTER...');
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

    // Aguarda o vídeo
    const inicio = Date.now();
    let videoGerado = false;

    while (Date.now() - inicio < CONFIG.tempoMaximoPorVideo) {
      const seg = Math.floor((Date.now() - inicio) / 1000);
      process.stdout.write(`   ⏱️  Aguardando... ${seg}s\r`);

      videoGerado = await pagina.evaluate(() => {
        const t = document.body.innerText.toLowerCase();
        return t.includes('your video is ready') || t.includes('vídeo está pronto') ||
               t.includes('video is ready') || document.querySelector('video') !== null;
      }).catch(() => false);

      if (videoGerado) {
        console.log(`\n   🎉 Vídeo gerado em ${Math.floor((Date.now() - inicio) / 1000)}s!`);
        break;
      }
      await pagina.waitForTimeout(5000);
    }

    if (!videoGerado) {
      console.log(`\n   ⚠️  Tempo máximo atingido — verifique o navegador.`);
    }

    // Salva screenshot
    const nomeArquivo = path.join(CONFIG.arquivos.screenshots, `video_${Date.now()}_${indice + 1}.png`);
    await pagina.screenshot({ path: nomeArquivo, fullPage: true });
    console.log(`   📸 Print salvo: ${nomeArquivo}`);

    return videoGerado;

  } catch (e) {
    console.error(`   ❌ Erro: ${e.message}`);
    return false;
  } finally {
    await pagina.close();
  }
}


// ============================================================
// 🚀 EXECUÇÃO PRINCIPAL DO AGENTE
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
  console.log(`   🤖 AGENTE TIKTOK SHOP — ${new Date().toLocaleString('pt-BR')}`);
  console.log('='.repeat(60));

  // ---- Lê os produtos do arquivo ----
  const todosProdutos = lerProdutos();

  if (todosProdutos.length === 0) {
    console.log('\n   ❌ Nenhum produto encontrado no arquivo produtos.txt!');
    console.log('\n   👉 O que fazer:');
    console.log('      1. Abra o arquivo produtos.txt na pasta do projeto');
    console.log('      2. Cole os nomes dos produtos (um por linha)');
    console.log('      3. Salve e rode o agente novamente\n');
    console.log('   Exemplo de produto:');
    console.log('   Vestido midi floral manga bufante decote V cor rose\n');
    return;
  }

  // Pega a quantidade configurada de produtos
  const produtosDoDia = todosProdutos.slice(0, CONFIG.quantidadeDeVideos);

  console.log(`\n   📋 Produtos para hoje (${produtosDoDia.length}):`);
  produtosDoDia.forEach((p, i) => console.log(`      ${i + 1}. ${p.substring(0, 60)}`));
  console.log(`   📊 Total já gerado: ${historico.totalVideos} vídeos\n`);

  // ---- Inicia o navegador ----
  // Tenta usar o Edge instalado no Windows
  const caminhoEdge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const executablePath = fs.existsSync(caminhoEdge) ? caminhoEdge : undefined;

  if (executablePath) {
    console.log('   ✅ Usando Microsoft Edge.');
  } else {
    console.log('   ℹ️  Edge não encontrado — usando Chromium padrão.');
  }

  const contexto = await chromium.launchPersistentContext(CONFIG.arquivos.perfil, {
    headless: false,
    executablePath,
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: null,
  });

  console.log('   ✅ Navegador iniciado.\n');

  try {
    // ---- Gera vídeo para cada produto ----
    for (let i = 0; i < produtosDoDia.length; i++) {
      const produto = produtosDoDia[i];
      const videoGerado = await gerarVideo(contexto, produto, i, produtosDoDia.length);

      // Remove produto usado do arquivo para não repetir
      removerProdutoUsado(produto);

      // Registra no histórico
      registrarNoHistorico(historico, produto, videoGerado);

      // Adiciona ao relatório
      relatorio.produtos.push({ nome: produto, videoGerado, horario: new Date().toLocaleTimeString('pt-BR') });
      if (videoGerado) relatorio.totalGerados++;
      else relatorio.totalErros++;

      // Pausa entre vídeos
      if (i < produtosDoDia.length - 1) {
        console.log('\n   ⏸️  Aguardando 10 segundos antes do próximo...');
        await new Promise(r => setTimeout(r, 10000));
      }
    }

    // ---- Salva relatório ----
    salvarRelatorio(relatorio);

    // ---- Resumo final ----
    console.log('\n' + '='.repeat(60));
    console.log('   🏁 AGENTE FINALIZADO!');
    console.log('='.repeat(60));
    console.log(`   ✅ Vídeos gerados: ${relatorio.totalGerados}`);
    console.log(`   ❌ Falhas: ${relatorio.totalErros}`);
    console.log(`   📊 Total histórico: ${historico.totalVideos} vídeos`);
    console.log(`\n   👉 Baixe os vídeos no navegador e poste no TikTok Shop!`);

    // Produtos restantes no arquivo
    const restantes = lerProdutos();
    if (restantes.length > 0) {
      console.log(`\n   ℹ️  Ainda tem ${restantes.length} produto(s) no arquivo para a próxima execução.`);
    } else {
      console.log(`\n   ℹ️  Arquivo produtos.txt está vazio. Adicione novos produtos para amanhã!`);
    }
    console.log('='.repeat(60));

    // Notifica no Telegram
    await notificarTelegram(
      `🎬 <b>Agente TikTok Shop finalizado!</b>\n\n` +
      `✅ Vídeos gerados: ${relatorio.totalGerados}\n` +
      `❌ Falhas: ${relatorio.totalErros}\n` +
      `📊 Total: ${historico.totalVideos} vídeos\n\n` +
      relatorio.produtos.map((p, i) =>
        `${i + 1}. ${p.nome.substring(0, 40)} ${p.videoGerado ? '✅' : '❌'}`
      ).join('\n')
    );

    console.log('\n   🌐 Navegador aberto — baixe os vídeos e pressione CTRL+C quando terminar.\n');
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
// ⏰ AGENDAMENTO AUTOMÁTICO DIÁRIO
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


/*
 * =============================================================
 * 📱 COMO CONFIGURAR NOTIFICAÇÕES NO TELEGRAM:
 * =============================================================
 * 1. Abra o Telegram e procure @BotFather
 * 2. Digite /newbot e siga os passos para criar seu bot
 * 3. Copie o TOKEN gerado e cole em CONFIG.telegramToken
 * 4. Procure @userinfobot no Telegram, envie /start
 * 5. Copie seu CHAT ID e cole em CONFIG.telegramChatId
 * =============================================================
 */
