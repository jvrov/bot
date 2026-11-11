'use strict';

// ---------------------------------------------------------------------------
// Estado e utilidades
// ---------------------------------------------------------------------------
const state = { produtos: [], email: null, emailConfigurado: true, lojas: {} };

const $ = (sel) => document.querySelector(sel);

const brl = (v) =>
    v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function tempoRelativo(iso) {
    if (!iso) return 'nunca';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'agora mesmo';
    if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function parsePreco(texto) {
    // Aceita "1.999,90", "1999.90", "1999"
    let s = String(texto).replace(/[^\d.,]/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) && n > 0 ? n : null;
}

const Toast = Swal.mixin({
    toast: true, position: 'top-end', showConfirmButton: false, timer: 3000, timerProgressBar: true,
});

async function api(url, { method = 'GET', body } = {}) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    let data;
    try {
        const res = await fetch(url, opts);
        data = await res.json();
    } catch (e) {
        throw new Error('Falha de conexão com o servidor');
    }
    if (!data.success) throw new Error(data.message || 'Erro desconhecido');
    return data;
}

function erro(e) {
    Swal.fire({ icon: 'error', title: 'Ops!', text: e.message, confirmButtonColor: '#2563eb' });
}

// ---------------------------------------------------------------------------
// Tema
// ---------------------------------------------------------------------------
function aplicarIconeTema() {
    const dark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
    $('#themeToggle i').className = dark ? 'fas fa-sun' : 'fas fa-moon';
}

$('#themeToggle').addEventListener('click', () => {
    const atual = document.documentElement.getAttribute('data-bs-theme');
    const novo = atual === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-bs-theme', novo);
    try { localStorage.setItem('theme', novo); } catch (e) { /* modo privado */ }
    aplicarIconeTema();
});
aplicarIconeTema();

// ---------------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------------
function sparkline(historico, alvo) {
    const pts = historico.map((h) => h.p);
    if (pts.length < 2) return '';
    const w = 110, h = 34, pad = 3;
    const min = Math.min(...pts, alvo), max = Math.max(...pts, alvo);
    const span = max - min || 1;
    const x = (i) => pad + (i * (w - pad * 2)) / (pts.length - 1);
    const y = (v) => h - pad - ((v - min) * (h - pad * 2)) / span;
    const d = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" aria-hidden="true">
        <line class="alvo" x1="0" x2="${w}" y1="${y(alvo)}" y2="${y(alvo)}"></line>
        <path d="${d}"></path></svg>`;
}

function statusDe(p) {
    if (p.erro && p.preco_atual == null) return { cls: 'badge-bad', txt: 'Erro ao ler preço', icon: 'fa-circle-exclamation' };
    if (p.preco_atual == null) return { cls: 'badge-new', txt: 'Aguardando verificação', icon: 'fa-hourglass-half' };
    if (p.preco_atual <= p.preco_desejado) return { cls: 'badge-ok', txt: p.alertado ? 'No alvo · alerta enviado' : 'No preço alvo!', icon: 'fa-circle-check' };
    return { cls: 'badge-wait', txt: 'Monitorando', icon: 'fa-eye' };
}

function cardProduto(p) {
    const st = statusDe(p);
    const noAlvo = p.preco_atual != null && p.preco_atual <= p.preco_desejado;
    const pct = p.preco_atual ? Math.min(100, (p.preco_desejado / p.preco_atual) * 100) : 0;
    const falta = p.preco_atual != null ? p.preco_atual - p.preco_desejado : null;
    const loja = state.lojas[p.loja] || (() => { try { return new URL(p.url).hostname.replace('www.', ''); } catch (e) { return ''; } })();

    return `
    <article class="produto ${noAlvo ? 'no-alvo' : ''} ${p.erro ? 'com-erro' : ''}" data-id="${esc(p.id)}">
        <div class="d-flex gap-3 align-items-start justify-content-between">
            <div class="flex-grow-1 min-w-0">
                <p class="produto-nome" title="${esc(p.nome)}">${esc(p.nome)}</p>
                <div class="produto-meta mt-1">
                    ${loja ? `<span class="store-chip store-${esc(p.loja || '')} me-1">${esc(loja)}</span>` : ''}
                    <span class="badge-status ${st.cls}"><i class="fas ${st.icon} me-1"></i>${st.txt}</span>
                    <span class="ms-1">· ${tempoRelativo(p.ultima_verificacao)}</span>
                </div>
            </div>
            ${sparkline(p.historico || [], p.preco_desejado)}
        </div>

        <div class="d-flex flex-wrap align-items-end justify-content-between gap-2 mt-3">
            <div>
                <div class="preco-atual ${noAlvo ? 'text-success' : ''}">${brl(p.preco_atual)}</div>
                <div class="preco-alvo">
                    Alvo: <strong>${brl(p.preco_desejado)}</strong>
                    ${p.preco_minimo != null ? ` · Menor: ${brl(p.preco_minimo)}` : ''}
                    ${falta != null && falta > 0 ? ` · faltam ${brl(falta)}` : ''}
                </div>
            </div>
            <div class="produto-acoes d-flex gap-1">
                <a class="btn btn-outline-secondary btn-sm" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" title="Abrir na loja"><i class="fas fa-arrow-up-right-from-square"></i></a>
                <button class="btn btn-outline-secondary btn-sm" data-acao="verificar" title="Verificar agora"><i class="fas fa-rotate"></i></button>
                <button class="btn btn-outline-secondary btn-sm" data-acao="historico" title="Histórico"><i class="fas fa-chart-line"></i></button>
                <button class="btn btn-outline-secondary btn-sm" data-acao="editar" title="Editar"><i class="fas fa-pen"></i></button>
                <button class="btn btn-outline-danger btn-sm" data-acao="remover" title="Remover"><i class="fas fa-trash"></i></button>
            </div>
        </div>
        ${p.preco_atual != null ? `
        <div class="progress progress-alvo mt-3" title="Quão perto do preço alvo">
            <div class="progress-bar ${noAlvo ? 'bg-success' : ''}" style="width:${pct.toFixed(0)}%"></div>
        </div>` : ''}
        ${p.erro ? `<div class="small text-danger mt-2"><i class="fas fa-circle-info me-1"></i>${esc(p.erro)}</div>` : ''}
    </article>`;
}

function ordenar(lista) {
    const modo = $('#ordem').value;
    const copia = [...lista];
    const ratio = (p) => (p.preco_atual ? p.preco_atual / p.preco_desejado : Infinity);
    if (modo === 'proximos') copia.sort((a, b) => ratio(a) - ratio(b));
    else if (modo === 'preco') copia.sort((a, b) => (a.preco_atual ?? Infinity) - (b.preco_atual ?? Infinity));
    else if (modo === 'nome') copia.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    else copia.reverse();
    return copia;
}

function render() {
    const lista = $('#listaProdutos');
    const termo = $('#busca').value.trim().toLowerCase();
    const filtrados = ordenar(state.produtos.filter((p) => p.nome.toLowerCase().includes(termo)));

    if (!state.produtos.length) {
        lista.innerHTML = `<div class="empty-state"><i class="fas fa-box-open d-block"></i>
            <h5>Nenhum produto ainda</h5><p class="mb-0">Cole o link de um produto ao lado para começar.</p></div>`;
    } else if (!filtrados.length) {
        lista.innerHTML = `<div class="empty-state"><i class="fas fa-magnifying-glass d-block"></i><p>Nenhum produto encontrado.</p></div>`;
    } else {
        lista.innerHTML = filtrados.map(cardProduto).join('');
    }

    // Estatísticas
    const comPreco = state.produtos.filter((p) => p.preco_atual != null);
    const noAlvo = comPreco.filter((p) => p.preco_atual <= p.preco_desejado);
    const falta = comPreco.reduce((s, p) => s + Math.max(0, p.preco_atual - p.preco_desejado), 0);
    const ultimas = state.produtos.map((p) => p.ultima_verificacao).filter(Boolean).sort();
    $('#statTotal').textContent = state.produtos.length;
    $('#statAbaixo').textContent = noAlvo.length;
    $('#statFalta').textContent = comPreco.length ? brl(falta) : '—';
    $('#statUltima').textContent = tempoRelativo(ultimas[ultimas.length - 1]);

    $('#avisoEmail').classList.toggle('d-none', state.emailConfigurado);
}

async function carregar() {
    try {
        const data = await api('/api/estado');
        state.produtos = data.produtos;
        state.email = data.email;
        state.emailConfigurado = data.email_configurado;
        state.lojas = data.lojas;
        if (data.email) $('#email').value = data.email;
        render();
    } catch (e) {
        $('#listaProdutos').innerHTML = `<div class="empty-state text-danger"><i class="fas fa-plug-circle-xmark d-block"></i><p>${esc(e.message)}</p></div>`;
    }
}

function substituirProduto(produto) {
    const i = state.produtos.findIndex((p) => p.id === produto.id);
    if (i >= 0) state.produtos[i] = produto;
    render();
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------
$('#formProduto').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('#url').value.trim();
    const preco = parsePreco($('#preco_desejado').value);
    if (!/^https?:\/\/.+/i.test(url)) return erro(new Error('Cole um link válido (http:// ou https://)'));
    if (!preco) return erro(new Error('Informe um preço desejado válido'));

    const btn = e.submitter || $('#formProduto button[type=submit]');
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Buscando preço...';
    try {
        const data = await api('/api/produtos', {
            method: 'POST', body: { url, preco_desejado: preco, nome: $('#nome').value.trim() },
        });
        state.produtos.push(data.produto);
        render();
        e.target.reset();
        if (data.resultado.status === 'alerta_enviado') {
            Swal.fire({ icon: 'success', title: 'Já está no preço!', text: `Enviamos um alerta: ${brl(data.produto.preco_atual)}`, confirmButtonColor: '#2563eb' });
        } else {
            Toast.fire({ icon: data.produto.preco_atual != null ? 'success' : 'info', title: data.message });
        }
    } catch (err) {
        erro(err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = original;
    }
});

$('#formEmail').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
        const data = await api('/api/email', { method: 'POST', body: { email: $('#email').value.trim() } });
        state.email = $('#email').value.trim();
        Toast.fire({ icon: 'success', title: data.message });
    } catch (err) { erro(err); }
});

$('#btnTesteEmail').addEventListener('click', async () => {
    try {
        const data = await api('/api/email/teste', { method: 'POST' });
        Toast.fire({ icon: 'success', title: data.message });
    } catch (err) { erro(err); }
});

$('#btnVerificar').addEventListener('click', async () => {
    if (!state.produtos.length) return erro(new Error('Adicione pelo menos um produto'));
    Swal.fire({
        title: 'Verificando preços...',
        html: `Consultando ${state.produtos.length} produto(s) nas lojas`,
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading(),
    });
    try {
        const data = await api('/api/verificar', { method: 'POST' });
        state.produtos = data.produtos;
        render();
        mostrarResultados(data.resultados);
    } catch (err) { erro(err); }
});

function mostrarResultados(resultados) {
    const grupo = (status) => resultados.filter((r) => r.status === status);
    const alertas = grupo('alerta_enviado');
    const noAlvo = grupo('abaixo_do_alvo');
    const erros = grupo('erro');
    const linha = (r) => `<li class="text-start"><strong>${esc(r.nome)}</strong><br>
        <small>${r.preco_atual != null ? `${brl(r.preco_atual)} (alvo ${brl(r.preco_desejado)})` : esc(r.mensagem)}</small></li>`;

    Swal.fire({
        title: 'Verificação concluída',
        icon: alertas.length || noAlvo.length ? 'success' : erros.length === resultados.length ? 'error' : 'info',
        confirmButtonColor: '#2563eb',
        html: `
            <div class="d-flex justify-content-around my-3">
                <div><div class="fs-3 fw-bold text-success">${alertas.length + noAlvo.length}</div><small>no alvo</small></div>
                <div><div class="fs-3 fw-bold text-primary">${grupo('monitorado').length}</div><small>acima</small></div>
                <div><div class="fs-3 fw-bold text-danger">${erros.length}</div><small>erros</small></div>
            </div>
            ${alertas.length ? `<h6 class="text-success text-start mt-3">🔔 Alertas enviados</h6><ul class="ps-3">${alertas.map(linha).join('')}</ul>` : ''}
            ${noAlvo.length ? `<h6 class="text-success text-start mt-3">✅ No preço alvo</h6><ul class="ps-3">${noAlvo.map(linha).join('')}</ul>` : ''}
            ${erros.length ? `<h6 class="text-danger text-start mt-3">⚠️ Não foi possível ler</h6><ul class="ps-3">${erros.map(linha).join('')}</ul>` : ''}`,
    });
}

$('#listaProdutos').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-acao]');
    if (!btn) return;
    const id = btn.closest('.produto').dataset.id;
    const produto = state.produtos.find((p) => p.id === id);
    if (!produto) return;
    ({ verificar, historico, editar, remover })[btn.dataset.acao](produto, btn);
});

async function verificar(produto, btn) {
    btn.disabled = true;
    btn.querySelector('i').classList.add('fa-spin');
    try {
        const data = await api(`/api/produtos/${produto.id}/verificar`, { method: 'POST' });
        substituirProduto(data.produto);
        const r = data.resultado;
        Toast.fire({
            icon: r.status === 'erro' ? 'error' : 'success',
            title: r.status === 'erro' ? r.mensagem : `Preço atual: ${brl(r.preco_atual)}`,
        });
    } catch (err) {
        erro(err);
        btn.disabled = false;
        btn.querySelector('i').classList.remove('fa-spin');
    }
}

async function editar(produto) {
    const { value } = await Swal.fire({
        title: 'Editar produto',
        html: `
            <label class="form-label w-100 text-start" for="swNome">Nome</label>
            <input id="swNome" class="form-control mb-3" maxlength="200" value="${esc(produto.nome)}">
            <label class="form-label w-100 text-start" for="swPreco">Preço desejado (R$)</label>
            <input id="swPreco" class="form-control" inputmode="decimal" value="${produto.preco_desejado.toFixed(2).replace('.', ',')}">`,
        showCancelButton: true,
        confirmButtonText: 'Salvar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#2563eb',
        focusConfirm: false,
        preConfirm: () => {
            const nome = document.getElementById('swNome').value.trim();
            const preco = parsePreco(document.getElementById('swPreco').value);
            if (!nome) return Swal.showValidationMessage('Informe um nome');
            if (!preco) return Swal.showValidationMessage('Informe um preço válido');
            return { nome, preco_desejado: preco };
        },
    });
    if (!value) return;
    try {
        const data = await api(`/api/produtos/${produto.id}`, { method: 'PATCH', body: value });
        substituirProduto(data.produto);
        Toast.fire({ icon: 'success', title: data.message });
    } catch (err) { erro(err); }
}

async function remover(produto) {
    const { isConfirmed } = await Swal.fire({
        title: 'Remover produto?',
        text: produto.nome,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc2626',
        confirmButtonText: 'Remover',
        cancelButtonText: 'Cancelar',
    });
    if (!isConfirmed) return;
    try {
        await api(`/api/produtos/${produto.id}`, { method: 'DELETE' });
        state.produtos = state.produtos.filter((p) => p.id !== produto.id);
        render();
        Toast.fire({ icon: 'success', title: 'Produto removido' });
    } catch (err) { erro(err); }
}

function historico(produto) {
    const hist = produto.historico || [];
    $('#historicoTitulo').textContent = produto.nome;
    const corpo = $('#historicoCorpo');

    if (!hist.length) {
        corpo.innerHTML = '<div class="empty-state"><i class="fas fa-chart-line d-block"></i><p>Ainda não há histórico. Clique em "Verificar" para registrar o primeiro preço.</p></div>';
    } else {
        const precos = hist.map((h) => h.p);
        const min = Math.min(...precos), max = Math.max(...precos);
        corpo.innerHTML = `
            <div class="row text-center g-2 mb-3">
                <div class="col"><div class="small text-body-secondary">Atual</div><div class="fw-bold">${brl(produto.preco_atual)}</div></div>
                <div class="col"><div class="small text-body-secondary">Menor</div><div class="fw-bold text-success">${brl(min)}</div></div>
                <div class="col"><div class="small text-body-secondary">Maior</div><div class="fw-bold text-danger">${brl(max)}</div></div>
                <div class="col"><div class="small text-body-secondary">Alvo</div><div class="fw-bold">${brl(produto.preco_desejado)}</div></div>
            </div>
            ${grafico(hist, produto.preco_desejado)}
            <div class="table-responsive mt-3" style="max-height: 200px">
                <table class="table table-sm mb-0">
                    <thead><tr><th>Data</th><th class="text-end">Preço</th></tr></thead>
                    <tbody>${[...hist].reverse().map((h) => `<tr><td>${new Date(h.t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td><td class="text-end">${brl(h.p)}</td></tr>`).join('')}</tbody>
                </table>
            </div>`;
    }
    bootstrap.Modal.getOrCreateInstance('#historicoModal').show();
}

function grafico(hist, alvo) {
    const w = 700, h = 260, l = 70, r = 16, t = 16, b = 28;
    const pts = hist.map((x) => x.p);
    let min = Math.min(...pts, alvo), max = Math.max(...pts, alvo);
    const margem = (max - min) * 0.1 || max * 0.05;
    min -= margem; max += margem;
    const x = (i) => l + (pts.length === 1 ? (w - l - r) / 2 : (i * (w - l - r)) / (pts.length - 1));
    const y = (v) => t + ((max - v) * (h - t - b)) / (max - min);
    const linha = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${linha} L${x(pts.length - 1).toFixed(1)},${h - b} L${x(0).toFixed(1)},${h - b} Z`;
    const ticks = [0, 1, 2, 3, 4].map((k) => min + ((max - min) * k) / 4);
    const fmt = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
    const datas = [0, pts.length - 1].filter((v, i, a) => a.indexOf(v) === i);

    return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Gráfico do histórico de preços">
        <g class="grid">${ticks.map((v) => `<line x1="${l}" x2="${w - r}" y1="${y(v)}" y2="${y(v)}"></line>
            <text x="${l - 8}" y="${y(v) + 4}" text-anchor="end">R$ ${fmt(v)}</text>`).join('')}</g>
        <path class="area" d="${area}"></path>
        <line class="alvo" x1="${l}" x2="${w - r}" y1="${y(alvo)}" y2="${y(alvo)}"></line>
        <text x="${w - r}" y="${y(alvo) - 6}" text-anchor="end" style="fill: var(--ok)">alvo</text>
        <path class="linha" d="${linha}"></path>
        ${pts.length <= 30 ? pts.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3"><title>${brl(v)}</title></circle>`).join('') : ''}
        ${datas.map((i) => `<text x="${x(i)}" y="${h - 8}" text-anchor="${i === 0 && pts.length > 1 ? 'start' : 'end'}">${new Date(hist[i].t).toLocaleDateString('pt-BR')}</text>`).join('')}
    </svg>`;
}

$('#busca').addEventListener('input', render);
$('#ordem').addEventListener('change', render);

carregar();
// Atualiza os "há X min" periodicamente.
setInterval(render, 60000);
