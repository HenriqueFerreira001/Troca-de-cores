# Rota Certa → sistema da equipe (equipe.maxxpav.us)

Este documento é para quem cuida do sistema **equipe.maxxpav.us**. Ele explica o que é
preciso fazer no sistema para receber, sem ninguém subir na mão, as fotos e as medidas
de cada OS concluída no app Rota Certa.

App: https://henriqueferreira001.github.io/Troca-de-cores/

## Como funciona

1. A equipe toca em **✅ Feito** na parada e preenche as medidas e as fotos de cada etapa.
   Cada foto já vem carimbada com OS, endereço, etapa, data e hora.
2. Ao concluir, o app faz **um POST** para o endereço configurado, com os dados e as fotos.
3. Se a resposta for **2xx**, o app marca a OS como *enviada*. Se der erro ou faltar
   internet, o app guarda tudo e tenta de novo depois: quando a internet volta, quando o
   app é aberto ou pelo botão "⬆ Sistema" nos detalhes da parada.
   Por isso, **a mesma OS pode chegar mais de uma vez**. Use `id_parada` para não duplicar.

## O que precisa existir no sistema

### 1. Uma rota que recebe o envio

```
POST https://equipe.maxxpav.us/<caminho que você escolher>
Authorization: Bearer <chave>
Content-Type: multipart/form-data
```

Campos do formulário:

| Campo | Exemplo | Observação |
|---|---|---|
| `os` | `2637568786` | Número da OS (vem da planilha) |
| `endereco` | `Rua Astor, 24 - Jardim Santa Tereza, Embu` | Endereço já arrumado |
| `endereco_planilha` | `RUA ASTOR, 24 - JD STA TEREZA - EMBU` | Como veio na planilha |
| `situacao` | `feito` ou `nao_feito` | |
| `medidas` | `[{"comprimento":2.4,"largura":1.7}]` | JSON, em metros; pode ter vários buracos |
| `area_m2` | `4.08` | Soma das áreas (vazio se não mediram) |
| `anotacao` | `2 buracos, massa fria` | Texto livre da equipe (ou o motivo, se não fez) |
| `observacao` | `OS 2637568786 — REPOR CAPA ASFALTICA` | Observação da planilha |
| `concluido_em` | `2026-09-28T13:51:00.000Z` | Data e hora (ISO, UTC) |
| `lat`, `lng` | `-23.6491`, `-46.8062` | Posição da OS no mapa |
| `equipe` | `Equipe Mauro` | Nome configurado no celular |
| `rota` | `Rota 28/09/2026` | Nome da rota no app |
| `id_parada` | `k3j9x2...` | Identificador único da parada (use para não duplicar) |
| `fotos` | arquivos `.jpg` (vários) | Um campo `fotos` para cada foto, na ordem |
| `etapas` | `["Antes","Recorte",...]` | JSON: etapa de cada foto, na mesma ordem de `fotos` |

Etapas possíveis: `Antes`, `Recorte`, `Limpeza / pintura de ligação`, `Asfalto aplicado`,
`Compactação`, `Pronto (depois)`, `Medida com trena`, `Outras` (e `Fotos do local` quando
não foi possível fazer).

Nome de cada foto: `OS2637568786_01_antes.jpg`, `OS2637568786_02_recorte.jpg`...
As fotos têm até 1600 px e cerca de 200 a 400 KB cada. São em média de 5 a 8 por OS,
então aceite pelo menos **20 MB** por envio.

Resposta: qualquer **2xx** conta como recebido. O conteúdo da resposta não é lido.

### 2. Liberar o app para chamar essa rota (CORS)

O app roda no navegador, em outro endereço. Por isso a rota precisa responder ao
`OPTIONS` e incluir estes cabeçalhos:

```
Access-Control-Allow-Origin: https://henriqueferreira001.github.io
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Authorization
```

### 3. A chave

Gere uma chave (um texto longo e aleatório) e valide o cabeçalho
`Authorization: Bearer <chave>`. Pode ser uma chave por equipe, para saber quem mandou.
A chave é digitada uma vez em cada celular, em ⚙ Configurações → "Sistema da empresa".

## Exemplo mínimo (Node/Express)

```js
const multer = require('multer');
const upload = multer({ dest: 'uploads/', limits: { fileSize: 10 * 1024 * 1024 } });

app.options('/api/rota-certa/servicos', cors);
app.post('/api/rota-certa/servicos', cors, upload.array('fotos', 30), async (req, res) => {
    if (req.headers.authorization !== 'Bearer ' + process.env.ROTA_CERTA_CHAVE) return res.sendStatus(401);
    const etapas = JSON.parse(req.body.etapas || '[]');
    const medidas = JSON.parse(req.body.medidas || '[]');
    // grava a OS req.body.os com medidas, área, situação e as fotos (req.files[i] ↔ etapas[i])
    // se id_parada já existir, atualize em vez de criar de novo
    res.sendStatus(201);
});

function cors(req, res, next) {
    res.set('Access-Control-Allow-Origin', 'https://henriqueferreira001.github.io');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
}
```

## Para testar

1. No app, abra ⚙ Configurações e preencha "Sistema da empresa — endereço de envio" e a "chave".
2. Conclua uma parada de teste com uma ou duas fotos.
3. Deve aparecer "⬆ Enviado ao sistema". Se aparecer "⚠ Não foi", abra a parada: o erro
   aparece ali (ex.: `HTTP 401` = chave errada; `Failed to fetch` = CORS ou endereço errado).
