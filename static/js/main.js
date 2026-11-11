'use strict';

/* ==========================================================================
   Estado e utilidades
   ========================================================================== */
const state = {
    produtos: [], email: null, emailConfigurado: true, ia: false,
    lojas: {}, lojasBusca: [],
    busca: null,           // { id, texto, interp, ofertas, compat, erros }
    filtro: 'todos', ordemOfertas: 'preco',
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const brl = (v) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isUrl = (s) => /^https?:\/\/\S+$/i.test(s.trim());
const nomeLoja = (k) => state.lojas[k] || k || '';

function parsePreco(texto) {
    let s = String(texto ?? '').replace(/[^\d.,]/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
const fmtInput = (v) => (v ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

function tempoRelativo(iso) {
    if (!iso) return 'nunca';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'agora mesmo';
    if (s < 3600) return `há ${Math.floor(s / 60)} min`;
    if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
    if (s < 86400 * 7) return `há ${Math.floor(s / 86400)} d`;
    return new Date(iso).toLocaleDateString('pt-BR');
}

async function api(url, { method = 'GET', body } = {}) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    let res, data;
    try {
        res = await fetch(url, opts);
        data = await res.json();
    } catch (e) {
        throw new Error(res && res.status === 504 ? 'O servidor demorou demais para responder' : 'Falha de conexão com o servidor');
    }
    if (!data.success) throw new Error(data.message || 'Erro desconhecido');
    return data;
}

/* ---------- Toasts ---------- */
function toast(msg, tipo = 'ok') {
    const icon = { ok: 'fa-circle-check', err: 'fa-circle-exclamation', info: 'fa-circle-info' }[tipo];
    const el = document.createElement('div');
    el.className = `toast ${tipo}`;
    el.innerHTML = `<i class="fa-solid ${icon}"></i><div>${esc(msg)}</div>`;
    $('#toasts').append(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, tipo === 'err' ? 6000 : 3500);
}
const erro = (e) => toast(e.message || String(e), 'err');

/* ---------- Diálogo ---------- */
const dlg = $('#dialogo');
let dlgValidate = null;

function abrirDialogo({ titulo, corpo, rodape = '', largo = false, validar = null, aoAbrir = null }) {
    $('#dialogoTitulo').textContent = titulo;
    $('#dialogoCorpo').innerHTML = corpo;
    $('#dialogoRodape').innerHTML = rodape;
    dlg.classList.toggle('wide', largo);
    dlgValidate = validar;
    dlg.returnValue = '';
    dlg.showModal();
    if (aoAbrir) aoAbrir(dlg);
    const foco = $('#dialogoCorpo input', dlg);
    if (foco) setTimeout(() => { foco.focus(); foco.select?.(); }, 30);
    return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true }));
}

$('#dialogoForm').addEventListener('submit', (e) => {
    const valor = e.submitter?.value;
    if (valor && valor !== 'cancel' && dlgValidate) {
        const msg = dlgValidate(valor);
        if (msg) {
            e.preventDefault();
            let n = $('#dialogoCorpo .notice', dlg);
            if (!n) { n = document.createElement('div'); n.className = 'notice'; $('#dialogoCorpo').append(n); }
            n.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>${esc(msg)}`;
        }
    }
});
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel'); });

async function confirmar(titulo, texto, botao = 'Confirmar', perigo = false) {
    const r = await abrirDialogo({
        titulo,
        corpo: `<p class="dialog-note">${esc(texto)}</p>`,
        rodape: `<button class="btn btn-ghost" value="cancel" formnovalidate>Cancelar</button>
                 <button class="btn ${perigo ? 'btn-danger' : 'btn-primary'}" value="ok">${esc(botao)}</button>`,
    });
    return r === 'ok';
}

async function pedirPrecoAlvo({ titulo, nota, sugestao }) {
    let valor = null;
    const r = await abrirDialogo({
        titulo,
        corpo: `<p class="dialog-note">${nota}</p>
            <div class="field"><label for="dlgPreco">Me avise quando custar até</label>
            <label class="money-input"><span>R$</span><input id="dlgPreco" inputmode="decimal" value="${fmtInput(sugestao)}"></label></div>`,
        rodape: `<button class="btn btn-ghost" value="cancel" formnovalidate>Cancelar</button>
                 <button class="btn btn-primary" value="ok"><i class="fa-solid fa-bell"></i> Criar alerta</button>`,
        validar: () => { valor = parsePreco($('#dlgPreco').value); return valor ? null : 'Informe um preço válido'; },
    });
    return r === 'ok' ? valor : null;
}

/* ==========================================================================
   Tema
   ========================================================================== */
function iconeTema() {
    $('#themeToggle i').className = document.documentElement.dataset.theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}
$('#themeToggle').addEventListener('click', () => {
    const novo = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = novo;
    try { localStorage.setItem('theme', novo); } catch (e) { /* ok */ }
    iconeTema();
});
iconeTema();

/* ==========================================================================
   Busca em linguagem natural
   ========================================================================== */
const pedido = $('#pedido');
function autoGrow() { pedido.style.height = 'auto'; pedido.style.height = `${pedido.scrollHeight}px`; }
pedido.addEventListener('input', autoGrow);
pedido.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); }
});
$('#exemplos').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    pedido.value = chip.textContent.trim();
    autoGrow();
    $('#composer').requestSubmit();
});

$('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const texto = pedido.value.trim();
    if (texto.length < 3) { pedido.focus(); return toast('Descreva o que você procura', 'info'); }
    if (isUrl(texto)) adicionarLink(texto);
    else buscar(texto);
});

$('#btnFecharBusca').addEventListener('click', () => {
    state.busca = null;
    $('#resultados').classList.add('hidden');
});

function passo(id, icone, texto) {
    return `<li class="step" id="passo-${id}"><i class="fa-solid ${icone}"></i><span>${texto}</span></li>`;
}
function marcarPasso(id, status, extra) {
    const el = $(`#passo-${id}`);
    if (!el) return;
    el.className = `step ${status}`;
    const i = $('i', el);
    i.className = 'fa-solid ' + ({ running: 'fa-circle-notch', done: 'fa-check', fail: 'fa-xmark' }[status] || 'fa-circle');
    if (extra !== undefined) {
        let sm = $('small', el);
        if (!sm) { sm = document.createElement('small'); el.append(sm); }
        sm.textContent = extra;
    }
}

async function buscar(texto) {
    const id = Date.now();
    state.busca = { id, texto, interp: null, ofertas: [], compat: [], erros: {} };
    const atual = () => state.busca && state.busca.id === id;

    const sec = $('#resultados');
    sec.classList.remove('hidden');
    $('#vigiarBusca').classList.add('hidden');
    $('#barraResultados').classList.add('hidden');
    $('#resumoBusca').textContent = `“${texto}”`;
    $('#tagsBusca').innerHTML = '';
    $('#passos').innerHTML = passo('ia', 'fa-circle', 'Entendendo o pedido')
        + state.lojasBusca.map((l) => passo(l, 'fa-circle', nomeLoja(l))).join('')
        + passo('filtro', 'fa-circle', 'Escolhendo o que combina');
    $('#gradeOfertas').innerHTML = Array.from({ length: 4 }, () => '<div class="skeleton"></div>').join('');
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#btnBuscar').disabled = true;

    try {
        // 1. Interpretar
        marcarPasso('ia', 'running');
        const { interpretacao } = await api('/api/interpretar', { method: 'POST', body: { texto } });
        if (!atual()) return;
        state.busca.interp = interpretacao;
        marcarPasso('ia', 'done', interpretacao.ia ? '· IA' : '');
        $('#resumoBusca').textContent = interpretacao.resumo || `Procurando ${interpretacao.termo_busca}`;
        $('#tagsBusca').innerHTML = [
            `<span class="tag"><i class="fa-solid fa-magnifying-glass"></i>${esc(interpretacao.termo_busca)}</span>`,
            ...(interpretacao.requisitos || []).map((r) => `<span class="tag neutral">${esc(r)}</span>`),
            interpretacao.preco_maximo ? `<span class="tag ok">até ${brl(interpretacao.preco_maximo)}</span>` : '',
        ].join('');

        // 2. Buscar em cada loja (em paralelo, uma requisição por loja)
        await Promise.all(state.lojasBusca.map(async (loja) => {
            marcarPasso(loja, 'running');
            try {
                const r = await api('/api/buscar', { method: 'POST', body: { termo: interpretacao.termo_busca, loja } });
                if (!atual()) return;
                state.busca.ofertas.push(...r.ofertas);
                if (r.erro) { state.busca.erros[loja] = r.erro; marcarPasso(loja, 'fail', r.erro); }
                else marcarPasso(loja, r.ofertas.length ? 'done' : 'fail', `${r.ofertas.length}`);
            } catch (e) {
                if (!atual()) return;
                state.busca.erros[loja] = e.message;
                marcarPasso(loja, 'fail', 'indisponível');
            }
        }));
        if (!atual()) return;

        // 3. Filtrar
        if (!state.busca.ofertas.length) {
            marcarPasso('filtro', 'fail');
            $('#gradeOfertas').innerHTML = vazio('fa-store-slash', 'Nenhuma loja retornou resultados',
                'As lojas podem estar bloqueando consultas automáticas agora. Tente de novo em alguns minutos ou com outras palavras.');
            return;
        }
        marcarPasso('filtro', 'running');
        const f = await api('/api/filtrar', { method: 'POST', body: { texto, interpretacao, ofertas: state.busca.ofertas } });
        if (!atual()) return;
        state.busca.compat = f.ofertas;
        marcarPasso('filtro', 'done', `${f.ofertas.length} de ${f.total}`);
        mostrarOfertas();
    } catch (e) {
        if (atual()) {
            erro(e);
            $('#gradeOfertas').innerHTML = vazio('fa-triangle-exclamation', 'Não deu certo', esc(e.message));
        }
    } finally {
        if (atual()) $('#btnBuscar').disabled = false;
    }
}

function mostrarOfertas(todas = false) {
    const b = state.busca;
    const lista = todas ? [...b.ofertas].map((o) => ({ ...o, motivo: '' })) : [...b.compat];
    if (state.ordemOfertas === 'loja') lista.sort((x, y) => x.loja.localeCompare(y.loja) || x.preco - y.preco);
    else lista.sort((x, y) => x.preco - y.preco);

    const grade = $('#gradeOfertas');
    if (!lista.length) {
        grade.innerHTML = `<div class="empty"><i class="fa-solid fa-filter-circle-xmark"></i>
            <h3>Nada bateu exatamente com o pedido</h3>
            <p>Encontrei ${b.ofertas.length} anúncios, mas nenhum cumpre tudo o que você pediu.</p>
            <button class="btn btn-secondary" style="margin-top:14px" id="btnVerTodos" type="button">Ver todos os resultados</button></div>`;
        $('#btnVerTodos').onclick = () => mostrarOfertas(true);
    } else {
        const menor = Math.min(...lista.map((o) => o.preco));
        grade.innerHTML = lista.map((o, i) => cardOferta(o, i, o.preco === menor)).join('');
        grade._ofertas = lista;
    }

    $('#barraResultados').classList.remove('hidden');
    $('#contagem').textContent = todas
        ? `${lista.length} resultados sem filtro`
        : `${lista.length} ${lista.length === 1 ? 'produto compatível' : 'produtos compatíveis'}`;

    // Vigiar a busca
    const precoMax = b.interp?.preco_maximo;
    const min = b.compat.length ? Math.min(...b.compat.map((o) => o.preco)) : null;
    const sugestao = precoMax || (min ? Math.floor(min * 0.95) : null);
    $('#alvoBusca').value = fmtInput(sugestao);
    $('#vigiarTexto').textContent = min
        ? `Hoje o mais barato compatível sai por ${brl(min)}. Aviso quando qualquer um, em qualquer loja, ficar abaixo do seu preço.`
        : 'Aviso quando aparecer algo compatível abaixo do seu preço, em qualquer loja.';
    $('#vigiarBusca').classList.remove('hidden');
}

function cardOferta(o, i, melhor) {
    return `
    <article class="card offer" style="animation-delay:${Math.min(i, 12) * 35}ms">
        ${melhor ? '<span class="badge-best"><i class="fa-solid fa-trophy"></i>Menor preço</span>' : ''}
        <div class="offer-img">${o.imagem ? `<img src="${esc(o.imagem)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('i'),{className:'fa-regular fa-image ph'}))">` : '<i class="fa-regular fa-image ph"></i>'}</div>
        <div class="offer-body">
            <span class="store store-${esc(o.loja)}">${esc(nomeLoja(o.loja))}</span>
            <div class="offer-title" title="${esc(o.titulo)}">${esc(o.titulo)}</div>
            ${o.motivo ? `<div class="offer-why"><i class="fa-solid fa-check"></i><span>${esc(o.motivo)}</span></div>` : ''}
            <div class="offer-price">${brl(o.preco)}</div>
            <div class="offer-foot">
                <button class="btn btn-primary btn-sm" data-vigiar="${i}" type="button"><i class="fa-solid fa-bell"></i> Vigiar</button>
                <a class="btn btn-secondary btn-sm" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">Ver na loja</a>
            </div>
        </div>
    </article>`;
}

$('#ordemResultados').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-ordem]');
    if (!b || !state.busca) return;
    $$('#ordemResultados button').forEach((x) => x.classList.toggle('active', x === b));
    state.ordemOfertas = b.dataset.ordem;
    mostrarOfertas();
});

$('#gradeOfertas').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-vigiar]');
    if (!b) return;
    const o = $('#gradeOfertas')._ofertas[+b.dataset.vigiar];
    const max = state.busca?.interp?.preco_maximo;
    const preco = await pedirPrecoAlvo({
        titulo: 'Vigiar este produto',
        nota: `<strong>${esc(o.titulo)}</strong><br>Hoje: ${brl(o.preco)} na ${esc(nomeLoja(o.loja))}.`,
        sugestao: max && max < o.preco ? max : Math.floor(o.preco * 0.9),
    });
    if (!preco) return;
    criarAlerta({ url: o.url, nome: o.titulo, imagem: o.imagem, preco_atual: o.preco, preco_desejado: preco });
});

$('#formVigiar').addEventListener('submit', (e) => {
    e.preventDefault();
    const preco = parsePreco($('#alvoBusca').value);
    if (!preco) return toast('Informe o preço alvo', 'info');
    const b = state.busca;
    criarAlerta({ tipo: 'busca', texto: b.texto, interpretacao: b.interp, ofertas: b.compat, preco_desejado: preco });
});

async function adicionarLink(url) {
    const preco = await pedirPrecoAlvo({
        titulo: 'Vigiar produto pelo link',
        nota: `Vou ler o preço desta página e avisar quando baixar:<br><span class="muted" style="word-break:break-all">${esc(url)}</span>`,
        sugestao: null,
    });
    if (!preco) return;
    criarAlerta({ url, preco_desejado: preco });
}

async function criarAlerta(body) {
    toast('Criando alerta…', 'info');
    try {
        const data = await api('/api/produtos', { method: 'POST', body });
        state.produtos.push(data.produto);
        renderPainel(data.produto.id);
        const r = data.resultado;
        if (r.status === 'alerta_enviado') toast(`Já está no seu preço! Enviamos um email: ${brl(r.preco_atual)}`);
        else if (r.status === 'abaixo_do_alvo') toast(`Já está no seu preço: ${brl(r.preco_atual)}. ${r.mensagem || ''}`);
        else toast(data.message);
        if (!state.email) setTimeout(() => toast('Configure seu email para receber os avisos', 'info'), 600);
        if (body.texto || body.url === pedido.value.trim()) { pedido.value = ''; autoGrow(); }
    } catch (e) { erro(e); }
}

/* ==========================================================================
   Painel de alertas
   ========================================================================== */
function sparkline(hist, alvo) {
    const pts = (hist || []).map((h) => h.p);
    if (pts.length < 2) return '';
    const w = 120, h = 40, pad = 3;
    const min = Math.min(...pts, alvo), max = Math.max(...pts, alvo), span = max - min || 1;
    const x = (i) => pad + (i * (w - pad * 2)) / (pts.length - 1);
    const y = (v) => h - pad - ((v - min) * (h - pad * 2)) / span;
    const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">
        <path class="area" d="${d} L${x(pts.length - 1)},${h} L${x(0)},${h} Z"></path>
        <line class="target" x1="0" x2="${w}" y1="${y(alvo)}" y2="${y(alvo)}"></line>
        <path d="${d}"></path></svg>`;
}

function statusDe(p) {
    if (p.preco_atual == null) {
        return p.erro ? { cls: 'bad', ic: 'fa-circle-exclamation', txt: 'Sem preço agora' }
            : { cls: 'new', ic: 'fa-hourglass-half', txt: 'Aguardando' };
    }
    if (p.preco_atual <= p.preco_desejado) return { cls: 'ok', ic: 'fa-bell', txt: p.alertado ? 'Email enviado' : 'No preço alvo!' };
    return { cls: 'wait', ic: 'fa-eye', txt: 'Vigiando' };
}

const thumb = (p) => (p.tipo === 'busca' && !p.imagem
    ? '<div class="thumb search"><i class="fa-solid fa-satellite-dish"></i></div>'
    : `<div class="thumb">${p.imagem ? `<img src="${esc(p.imagem)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('i'),{className:'fa-solid fa-box ph'}))">` : '<i class="fa-solid fa-box ph"></i>'}</div>`);

function cardItem(p) {
    const st = statusDe(p);
    const hit = p.preco_atual != null && p.preco_atual <= p.preco_desejado;
    const pct = p.preco_atual ? Math.min(100, (p.preco_desejado / p.preco_atual) * 100) : 0;
    const falta = p.preco_atual != null ? p.preco_atual - p.preco_desejado : null;
    const melhor = p.tipo === 'busca' && p.melhor_oferta;
    const loja = p.tipo === 'busca' ? (melhor ? melhor.loja : null) : p.loja;

    return `
    <article class="card item ${hit ? 'hit' : ''}" data-id="${esc(p.id)}">
        <div class="item-top">
            ${thumb(p)}
            <div style="min-width:0">
                <div class="item-title" title="${esc(p.nome)}">${esc(p.nome)}</div>
                <div class="item-meta">
                    <span class="kind ${p.tipo === 'busca' ? 'busca' : ''}">${p.tipo === 'busca' ? 'Busca' : 'Produto'}</span>
                    ${loja ? `<span class="store store-${esc(loja)}">${esc(nomeLoja(loja))}</span>` : ''}
                    <span>${tempoRelativo(p.ultima_verificacao)}</span>
                </div>
            </div>
        </div>
        ${melhor ? `<div class="item-best"><i class="fa-solid fa-trophy" style="color:var(--warn)"></i><span title="${esc(melhor.titulo)}">${esc(melhor.titulo)}</span></div>` : ''}
        <div class="item-prices">
            <div>
                <div class="price-now ${hit ? 'hit' : ''}">${brl(p.preco_atual)}</div>
                <div class="price-sub">Alvo <strong>${brl(p.preco_desejado)}</strong>${falta > 0 ? ` · faltam ${brl(falta)}` : ''}${p.preco_minimo != null ? ` · menor ${brl(p.preco_minimo)}` : ''}</div>
            </div>
            ${sparkline(p.historico, p.preco_desejado)}
        </div>
        ${p.preco_atual != null ? `<div class="meter ${hit ? 'hit' : ''}"><span style="width:${pct.toFixed(0)}%"></span></div>` : ''}
        ${p.erro ? `<div class="item-error"><i class="fa-solid fa-circle-info"></i><span>${esc(p.erro)}</span></div>` : ''}
        <div class="item-foot">
            <span class="pill ${st.cls}"><i class="fa-solid ${st.ic}"></i>${st.txt}</span>
            <div class="actions">
                ${p.url ? `<a class="icon-btn" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" title="Abrir na loja"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>` : ''}
                <button class="icon-btn" data-acao="verificar" title="Verificar agora" type="button"><i class="fa-solid fa-rotate"></i></button>
                <button class="icon-btn" data-acao="detalhes" title="Histórico${p.tipo === 'busca' ? ' e ofertas' : ''}" type="button"><i class="fa-solid fa-chart-line"></i></button>
                <button class="icon-btn" data-acao="editar" title="Editar" type="button"><i class="fa-solid fa-pen"></i></button>
                <button class="icon-btn danger" data-acao="remover" title="Remover" type="button"><i class="fa-regular fa-trash-can"></i></button>
            </div>
        </div>
    </article>`;
}

function vazio(icone, titulo, texto) {
    return `<div class="empty"><i class="fa-solid ${icone}"></i><h3>${titulo}</h3><p>${texto}</p></div>`;
}

function renderPainel(destacar) {
    const termo = $('#filtroTexto').value.trim().toLowerCase();
    const hit = (p) => p.preco_atual != null && p.preco_atual <= p.preco_desejado;
    let lista = state.produtos.filter((p) => p.nome.toLowerCase().includes(termo));
    if (state.filtro === 'alvo') lista = lista.filter(hit);
    else if (state.filtro !== 'todos') lista = lista.filter((p) => p.tipo === state.filtro);
    lista.sort((a, b) => (hit(b) - hit(a)) || (b.criado_em || '').localeCompare(a.criado_em || ''));

    const el = $('#listaItens');
    if (!state.produtos.length) {
        el.innerHTML = vazio('fa-bell', 'Nenhum alerta ainda',
            'Diga lá em cima o que você quer comprar. Depois é só clicar em <strong>Vigiar</strong> num produto, ou criar um alerta para a busca inteira.');
    } else if (!lista.length) {
        el.innerHTML = vazio('fa-filter', 'Nada aqui', 'Nenhum alerta neste filtro.');
    } else {
        el.innerHTML = lista.map(cardItem).join('');
    }
    if (destacar) {
        const c = $(`.item[data-id="${destacar}"]`);
        if (c) c.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const comPreco = state.produtos.filter((p) => p.preco_atual != null);
    const falta = comPreco.reduce((s, p) => s + Math.max(0, p.preco_atual - p.preco_desejado), 0);
    const ult = state.produtos.map((p) => p.ultima_verificacao).filter(Boolean).sort().pop();
    $('#statTotal').textContent = state.produtos.length;
    $('#navCount').textContent = state.produtos.length;
    $('#statAlvo').textContent = state.produtos.filter(hit).length;
    $('#statEconomia').textContent = comPreco.length ? brl(falta) : '—';
    $('#statUltima').textContent = tempoRelativo(ult);
}

$('#filtroPainel').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-filtro]');
    if (!b) return;
    $$('#filtroPainel button').forEach((x) => x.classList.toggle('active', x === b));
    state.filtro = b.dataset.filtro;
    renderPainel();
});
$('#filtroTexto').addEventListener('input', () => renderPainel());

$('#listaItens').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-acao]');
    if (!b) return;
    const p = state.produtos.find((x) => x.id === b.closest('.item').dataset.id);
    if (p) ({ verificar, detalhes, editar, remover })[b.dataset.acao](p, b);
});

function substituir(p) {
    const i = state.produtos.findIndex((x) => x.id === p.id);
    if (i >= 0) state.produtos[i] = p;
    renderPainel();
}

async function verificar(p, btn) {
    btn.classList.add('spin');
    btn.disabled = true;
    try {
        const d = await api(`/api/produtos/${p.id}/verificar`, { method: 'POST' });
        substituir(d.produto);
        const r = d.resultado;
        toast(r.status === 'erro' ? r.mensagem : `Agora: ${brl(r.preco_atual)}`, r.status === 'erro' ? 'err' : 'ok');
    } catch (e) {
        erro(e);
        btn.classList.remove('spin');
        btn.disabled = false;
    }
}

$('#btnVerificar').addEventListener('click', async (e) => {
    if (!state.produtos.length) return toast('Crie um alerta primeiro', 'info');
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> Verificando…';
    try {
        const d = await api('/api/verificar', { method: 'POST' });
        state.produtos = d.produtos;
        renderPainel();
        const conta = (s) => d.resultados.filter((r) => r.status === s).length;
        const alvo = conta('alerta_enviado') + conta('abaixo_do_alvo');
        const erros = conta('erro');
        toast(`${d.resultados.length} verificados · ${alvo} no alvo${erros ? ` · ${erros} sem resposta` : ''}`, alvo ? 'ok' : 'info');
    } catch (err) { erro(err); }
    finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Verificar agora';
    }
});

async function editar(p) {
    let valores = null;
    const r = await abrirDialogo({
        titulo: 'Editar alerta',
        corpo: `<div class="field"><label for="dlgNome">Nome</label><input class="input" id="dlgNome" maxlength="200" value="${esc(p.nome)}"></div>
            <div class="field"><label for="dlgAlvo">Preço alvo</label>
            <label class="money-input"><span>R$</span><input id="dlgAlvo" inputmode="decimal" value="${fmtInput(p.preco_desejado)}"></label></div>`,
        rodape: `<button class="btn btn-ghost" value="cancel" formnovalidate>Cancelar</button><button class="btn btn-primary" value="ok">Salvar</button>`,
        validar: () => {
            const nome = $('#dlgNome').value.trim();
            const preco = parsePreco($('#dlgAlvo').value);
            if (!nome) return 'Informe um nome';
            if (!preco) return 'Informe um preço válido';
            valores = { nome, preco_desejado: preco };
            return null;
        },
    });
    if (r !== 'ok') return;
    try {
        const d = await api(`/api/produtos/${p.id}`, { method: 'PATCH', body: valores });
        substituir(d.produto);
        toast('Alerta atualizado');
    } catch (e) { erro(e); }
}

async function remover(p) {
    if (!(await confirmar('Remover alerta?', p.nome, 'Remover', true))) return;
    try {
        await api(`/api/produtos/${p.id}`, { method: 'DELETE' });
        state.produtos = state.produtos.filter((x) => x.id !== p.id);
        renderPainel();
        toast('Alerta removido');
    } catch (e) { erro(e); }
}

function grafico(hist, alvo) {
    const w = 720, h = 240, l = 64, r = 14, t = 14, b = 26;
    const pts = hist.map((x) => x.p);
    let min = Math.min(...pts, alvo), max = Math.max(...pts, alvo);
    const m = (max - min) * 0.12 || max * 0.05;
    min -= m; max += m;
    const x = (i) => l + (pts.length === 1 ? (w - l - r) / 2 : (i * (w - l - r)) / (pts.length - 1));
    const y = (v) => t + ((max - v) * (h - t - b)) / (max - min);
    const linha = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const ticks = [0, 1, 2, 3].map((k) => min + ((max - min) * k) / 3);
    const datas = [...new Set([0, Math.floor((pts.length - 1) / 2), pts.length - 1])];
    return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Histórico de preços">
        <defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stop-color="var(--brand)" stop-opacity=".25"/><stop offset="1" stop-color="var(--brand)" stop-opacity="0"/></linearGradient></defs>
        <g class="grid">${ticks.map((v) => `<line x1="${l}" x2="${w - r}" y1="${y(v)}" y2="${y(v)}"></line>
            <text x="${l - 8}" y="${y(v) + 4}" text-anchor="end">${v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</text>`).join('')}</g>
        <path class="area" d="${linha} L${x(pts.length - 1)},${h - b} L${x(0)},${h - b} Z"></path>
        <line class="target" x1="${l}" x2="${w - r}" y1="${y(alvo)}" y2="${y(alvo)}"></line>
        <text x="${w - r}" y="${y(alvo) - 6}" text-anchor="end" style="fill:var(--ok)">seu alvo</text>
        <path class="line" d="${linha}"></path>
        ${pts.length <= 40 ? pts.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3.5"><title>${brl(v)} · ${new Date(hist[i].t).toLocaleString('pt-BR')}</title></circle>`).join('') : ''}
        ${datas.map((i) => `<text x="${x(i)}" y="${h - 6}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}">${new Date(hist[i].t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</text>`).join('')}
    </svg>`;
}

function detalhes(p) {
    const hist = p.historico || [];
    const precos = hist.map((h) => h.p);
    const ofertas = p.tipo === 'busca' ? (p.ofertas || []) : [];
    const corpo = `
        <div class="mini-stats">
            <div><span>Agora</span><strong>${brl(p.preco_atual)}</strong></div>
            <div><span>Menor</span><strong style="color:var(--ok)">${brl(precos.length ? Math.min(...precos) : null)}</strong></div>
            <div><span>Maior</span><strong>${brl(precos.length ? Math.max(...precos) : null)}</strong></div>
            <div><span>Seu alvo</span><strong>${brl(p.preco_desejado)}</strong></div>
        </div>
        ${hist.length ? grafico(hist, p.preco_desejado) : vazio('fa-chart-line', 'Sem histórico ainda', 'Os preços aparecem aqui a cada verificação.')}
        ${ofertas.length ? `<h4 style="margin:18px 0 0">Melhores ofertas compatíveis</h4><div class="offer-list">${ofertas.map((o) => `
            <a class="offer-row" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">
                ${thumb({ imagem: o.imagem })}
                <div style="min-width:0"><div class="t" title="${esc(o.titulo)}">${esc(o.titulo)}</div><span class="store store-${esc(o.loja)}">${esc(nomeLoja(o.loja))}</span></div>
                <span class="p">${brl(o.preco)}</span>
            </a>`).join('')}</div>` : ''}`;
    abrirDialogo({ titulo: p.nome, corpo, largo: true });
}

/* ==========================================================================
   Configurações (email)
   ========================================================================== */
function atualizarStatusEmail() {
    const ok = !!state.email && state.emailConfigurado;
    $('#emailDot').classList.toggle('ok', ok);
    $('#emailLabel').textContent = state.email ? state.email : 'Configurar email';
}

$('#btnConfig').addEventListener('click', async () => {
    let email = null;
    const r = await abrirDialogo({
        titulo: 'Avisos por email',
        corpo: `<div class="field"><label for="dlgEmail">Seu email</label>
            <input class="input" type="email" id="dlgEmail" placeholder="voce@exemplo.com" value="${esc(state.email || '')}">
            <small>Enviamos um aviso quando um alerta atingir o preço que você quer.</small></div>
            ${state.emailConfigurado ? '' : '<div class="notice"><i class="fa-solid fa-triangle-exclamation"></i>O servidor ainda não tem um remetente configurado (EMAIL_USER / EMAIL_PASSWORD).</div>'}
            <p class="dialog-note" style="margin-top:12px"><i class="fa-solid fa-wand-magic-sparkles"></i>
            Busca inteligente: ${state.ia ? '<strong style="color:var(--ok)">ligada (IA)</strong>' : '<strong>modo simples</strong> (configure ANTHROPIC_API_KEY para usar IA)'}</p>`,
        rodape: `<button class="btn btn-ghost" value="teste" ${state.email ? '' : 'disabled'}><i class="fa-regular fa-paper-plane"></i> Email de teste</button>
                 <button class="btn btn-primary" value="ok">Salvar</button>`,
        validar: (v) => {
            if (v !== 'ok') return null;
            email = $('#dlgEmail').value.trim();
            return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? null : 'Informe um email válido';
        },
    });
    try {
        if (r === 'ok') {
            await api('/api/email', { method: 'POST', body: { email } });
            state.email = email;
            atualizarStatusEmail();
            toast('Email salvo');
        } else if (r === 'teste') {
            const d = await api('/api/email/teste', { method: 'POST' });
            toast(d.message);
        }
    } catch (e) { erro(e); }
});

/* ==========================================================================
   Início
   ========================================================================== */
async function carregar() {
    $('#listaItens').innerHTML = '<div class="skeleton" style="height:220px"></div><div class="skeleton" style="height:220px"></div>';
    try {
        const d = await api('/api/estado');
        Object.assign(state, {
            produtos: d.produtos, email: d.email, emailConfigurado: d.email_configurado,
            ia: d.ia, lojas: d.lojas, lojasBusca: d.lojas_busca,
        });
        $('#iaBadge').textContent = d.ia ? 'Busca inteligente com IA' : 'Busca inteligente';
        atualizarStatusEmail();
        renderPainel();
    } catch (e) {
        $('#listaItens').innerHTML = vazio('fa-plug-circle-xmark', 'Não consegui carregar', esc(e.message));
    }
}

carregar();
setInterval(() => { if (!dlg.open) renderPainel(); }, 60000);
