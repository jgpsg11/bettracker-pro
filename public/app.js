const S = {
  theme: document.documentElement.getAttribute('data-theme') || 'dark',
  currentView: 'dashboard',
  editingId: null,
  dashFilter: { sport: '', bookmaker: '', period: '', dateStart: '', dateEnd: '' },
  histFilter: { sport: '', bookmaker: '', period: '', status: 'all' },
  charts: {},
  selections: []
};

const $ = id => document.getElementById(id);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const fmt = (v, dec = 2) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Number(v || 0)) + '€';
const fmtNum = (v, dec = 2) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Number(v || 0));
const fmtOdds = v => Number(v || 0).toFixed(2);
const today = () => new Date().toISOString().split('T')[0];
const safeText = (id, value) => { const el = $(id); if (el) el.textContent = value; };
const safeHTML = (id, value) => { const el = $(id); if (el) el.innerHTML = value; };
const setPnlClass = (id, value) => {
  const el = $(id);
  if (!el) return;
  el.classList.remove('is-profit', 'is-loss', 'is-neutral');
  if (value > 0) el.classList.add('is-profit');
  else if (value < 0) el.classList.add('is-loss');
  else el.classList.add('is-neutral');
};

const periodRange = (val) => {
  const now = new Date();
  if (val === '7') return { start: new Date(now - 7 * 864e5).toISOString().split('T')[0], end: today() };
  if (val === '30') return { start: new Date(now - 30 * 864e5).toISOString().split('T')[0], end: today() };
  if (val === 'month') return { start: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, end: today() };
  if (val === 'year') return { start: `${now.getFullYear()}-01-01`, end: today() };
  return { start: '', end: '' };
};

function showToast(msg) {
  const wrap = $('toastWrap');
  if (!wrap) return;
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

const api = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`GET ${url} failed`);
    return r.json();
  },
  async post(url, data) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!r.ok) throw new Error(`POST ${url} failed`);
    return r.json();
  },
  async patch(url, data) {
    const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!r.ok) throw new Error(`PATCH ${url} failed`);
    return r.json();
  },
  async del(url) {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) throw new Error(`DELETE ${url} failed`);
    return r.json();
  }
};

function navigate(view) {
  S.currentView = view;
  $$('.view').forEach(el => el.classList.remove('active'));
  $$('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`view-${view}`)?.classList.add('active');
  $$(`[data-view="${view}"]`).forEach(el => el.classList.add('active'));
  if (view === 'dashboard') loadDashboard();
  if (view === 'history') loadHistory();
  if (view === 'open') loadOpen();
  if (view === 'stats') loadStats();
  if (view === 'add') {
    if (!S.editingId) resetForm();
    loadAutocompletes();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function populateSelect(id, items, current, placeholder) {
  const sel = $(id);
  if (!sel) return;
  sel.innerHTML = `<option value="">${placeholder}</option>` + (items || []).map(i => `<option value="${i}" ${i === current ? 'selected' : ''}>${i}</option>`).join('');
}

function computeLocalPnl(bet) {
  if (bet.status === 'won') return bet.is_freebet ? Number(bet.potential_payout || 0) : Number(bet.potential_payout || 0) - Number(bet.stake || 0);
  if (bet.status === 'lost') return bet.is_freebet ? 0 : -Number(bet.stake || 0);
  return 0;
}

function computeBankrollSeries(bets, startingBankroll = 0) {
  let running = Number(startingBankroll || 0);
  return bets
    .filter(b => b.status !== 'open')
    .sort((a, b) => new Date(a.bet_date) - new Date(b.bet_date))
    .map(b => {
      running += computeLocalPnl(b);
      return { date: b.bet_date, title: b.title, value: +running.toFixed(2) };
    });
}

async function loadDashboard() {
  try {
    const f = S.dashFilter;
    const range = f.period === 'custom' ? { start: f.dateStart, end: f.dateEnd } : periodRange(f.period);
    const params = new URLSearchParams();
    if (f.sport) params.set('sport', f.sport);
    if (f.bookmaker) params.set('bookmaker', f.bookmaker);
    if (range.start) params.set('period_start', range.start);
    if (range.end) params.set('period_end', range.end);

    const [stats, bets, settings] = await Promise.all([
      api.get(`/api/stats?${params}`),
      api.get(`/api/bets?${params}`),
      api.get('/api/settings')
    ]);

    const series = computeBankrollSeries(bets, settings.starting_bankroll || 0);
    const pnl = bets.filter(b => b.status !== 'open').reduce((sum, b) => sum + computeLocalPnl(b), 0);

    safeText('topBankroll', fmt((settings.starting_bankroll || 0) + pnl));
    safeText('heroBankroll', fmt((settings.starting_bankroll || 0) + pnl));
    safeText('heroPnl', `P&L filtré : ${pnl > 0 ? '+' : ''}${fmt(pnl)}`);
    setPnlClass('heroPnl', pnl);
    safeText('metCount', bets.filter(b => b.status !== 'open').length);
    safeText('metOpen', bets.filter(b => b.status === 'open').length);
    safeText('metHitRate', `${stats.hit_rate}%`);
    safeText('metAvgOdds', fmtOdds(stats.avg_odds));
    populateSelect('fSport', stats.sports, f.sport, 'Tous les sports');
    populateSelect('fBookmaker', stats.bookmakers, f.bookmaker, 'Tous les bookmakers');
    drawBankrollChart(series);
    renderBetList('recentBets', bets.filter(b => b.status !== 'open').sort((a,b)=>new Date(b.bet_date)-new Date(a.bet_date)).slice(0, 5), { compact: true });
  } catch (err) {
    console.error(err);
    safeText('topBankroll', 'Erreur chargement');
    safeHTML('recentBets', `<div class="empty"><p>Impossible de charger le dashboard.</p></div>`);
  }
}

function drawBankrollChart(points) {
  const ctx = $('bankrollChart');
  if (!ctx || typeof Chart === 'undefined') return;
  const cs = getComputedStyle(document.documentElement);
  const primary = cs.getPropertyValue('--color-primary').trim();
  const muted = cs.getPropertyValue('--color-text-muted').trim();
  if (S.charts.bankroll) S.charts.bankroll.destroy();
  S.charts.bankroll = new Chart(ctx, {
    type: 'line',
    data: {
      labels: points.length ? points.map((p, i) => p.date || String(i + 1)) : ['0'],
      datasets: [{
        data: points.length ? points.map(p => p.value) : [0],
        borderColor: primary,
        backgroundColor: primary + '28',
        tension: 0.35,
        fill: true,
        pointRadius: 3,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: muted, maxRotation: 0, autoSkip: true } },
        y: { ticks: { color: muted } }
      }
    }
  });
}

async function loadHistory() {
  try {
    const f = S.histFilter;
    const range = periodRange(f.period);
    const params = new URLSearchParams();
    if (f.sport) params.set('sport', f.sport);
    if (f.bookmaker) params.set('bookmaker', f.bookmaker);
    if (range.start) params.set('period_start', range.start);
    if (range.end) params.set('period_end', range.end);
    if (f.status && f.status !== 'all') params.set('status', f.status);
    const [bets, stats] = await Promise.all([api.get(`/api/bets?${params}`), api.get('/api/stats')]);
    populateSelect('hSport', stats.sports, f.sport, 'Tous les sports');
    populateSelect('hBookmaker', stats.bookmakers, f.bookmaker, 'Tous les bookmakers');
    renderBetList('historyList', bets.filter(b => b.status !== 'open'));
  } catch (err) {
    console.error(err);
    safeHTML('historyList', `<div class="empty"><p>Impossible de charger l'historique.</p></div>`);
  }
}

async function loadOpen() {
  try {
    const bets = await api.get('/api/bets?status=open');
    renderBetList('openList', bets, { showSettle: true });
  } catch (err) {
    console.error(err);
    safeHTML('openList', `<div class="empty"><p>Impossible de charger les paris en cours.</p></div>`);
  }
}

async function loadStats() {
  try {
    const [stats, bets, settings] = await Promise.all([api.get('/api/stats'), api.get('/api/bets'), api.get('/api/settings')]);
    const totalPnl = bets.filter(b => b.status !== 'open').reduce((sum, b) => sum + computeLocalPnl(b), 0);
    const bankroll = Number(settings.starting_bankroll || 0) + totalPnl;
    safeText('sBankroll', fmt(bankroll));
    safeText('sPnl', `${totalPnl > 0 ? '+' : ''}${fmt(totalPnl)}`);
    setPnlClass('sPnl', totalPnl);
    safeText('sWon', stats.won_count);
    safeText('sHit', `${stats.hit_rate}%`);
    safeText('sOdds', fmtOdds(stats.avg_odds));
    safeText('sTotalBets', bets.length);
  } catch (err) {
    console.error(err);
  }
}

function statusBadge(b) {
  const map = { open: 'badge-open', won: 'badge-won', lost: 'badge-lost', void: 'badge-void' };
  const labels = { open: 'En cours', won: 'Gagné', lost: 'Perdu', void: 'Annulé' };
  return `<span class="badge ${map[b.status] || 'badge-open'}">${labels[b.status] || b.status}${b.is_freebet ? ' · FB' : ''}</span>`;
}

function selectionSummary(selection) {
  const match = selection.match?.trim() || 'Match';
  const pick = selection.pick?.trim() || 'Sélection';
  const odds = selection.odds ? ` @ ${fmtOdds(selection.odds)}` : '';
  return `${match} — ${pick}${odds}`;
}

function renderBetList(containerId, bets, opts = {}) {
  const el = $(containerId);
  if (!el) return;
  if (!bets.length) {
    el.innerHTML = `<div class="empty"><p>Aucun pari ici pour le moment.</p></div>`;
    return;
  }
  el.innerHTML = bets.map(b => {
    let selections = [];
    try { selections = JSON.parse(b.notes || '[]'); } catch { selections = []; }
    const pnl = computeLocalPnl(b);
    return `
      <article class="bet-card">
        <div class="bet-top">
          <div>
            <div class="bet-title">${b.title}</div>
            <div class="bet-meta-row">${b.sport || '—'} · ${b.bookmaker || '—'} · ${b.bet_date}</div>
          </div>
          ${statusBadge(b)}
        </div>
        <div class="bet-figures">
          <div class="fig-box"><span>Cote</span><strong>${fmtOdds(b.odds)}</strong></div>
          <div class="fig-box"><span>Mise</span><strong>${fmt(b.stake)}</strong></div>
          <div class="fig-box"><span>Gain potentiel</span><strong>${fmt(b.potential_payout)}</strong></div>
          ${!opts.compact ? `<div class="fig-box"><span>P&L</span><strong class="${pnl > 0 ? 'is-profit' : pnl < 0 ? 'is-loss' : 'is-neutral'}">${pnl > 0 ? '+' : ''}${fmt(pnl)}</strong></div>` : ''}
        </div>
        ${selections.length ? `<div class="bet-selections-preview">${selections.slice(0,3).map(s => `<div class="bet-meta-row">• ${selectionSummary(s)}</div>`).join('')}${selections.length > 3 ? `<div class="bet-meta-row">+${selections.length - 3} autres sélections</div>` : ''}</div>` : ''}
        <div class="bet-actions">
          ${opts.showSettle ? `
            <button class="mini-btn" data-settle="${b.id}" data-status="won">Gagné</button>
            <button class="mini-btn" data-settle="${b.id}" data-status="lost">Perdu</button>
            <button class="mini-btn" data-settle="${b.id}" data-status="void">Annuler</button>` : ''}
          ${!opts.compact ? `<button class="mini-btn" data-edit="${b.id}">Modifier</button>` : ''}
          ${!opts.compact ? `<button class="mini-btn" data-delete="${b.id}">Supprimer</button>` : ''}
          <button class="mini-btn" data-detail="${b.id}">Détail</button>
        </div>
      </article>
    `;
  }).join('');
}

function createEmptySelection() {
  return { match: '', pick: '', odds: '' };
}

function renderSelections() {
  const wrap = $('selectionsList');
  if (!wrap) return;
  if (!S.selections.length) S.selections = [createEmptySelection()];
  wrap.innerHTML = S.selections.map((sel, index) => `
    <div class="selection-card" data-selection-index="${index}">
      <div class="selection-header">
        <strong>Sélection ${index + 1}</strong>
        ${S.selections.length > 1 ? `<button type="button" class="mini-btn" data-remove-selection="${index}">Supprimer</button>` : ''}
      </div>
      <div class="form-grid better-grid selection-grid">
        <div class="field full">
          <label>Match</label>
          <input type="text" data-sel-field="match" data-sel-index="${index}" value="${sel.match || ''}" placeholder="Ex: Milan - Inter">
        </div>
        <div class="field full">
          <label>Pari sélectionné</label>
          <input type="text" data-sel-field="pick" data-sel-index="${index}" value="${sel.pick || ''}" placeholder="Ex: Plus de 2,5 buts">
        </div>
        <div class="field">
          <label>Cote de la sélection</label>
          <input type="number" min="1.01" step="0.01" data-sel-field="odds" data-sel-index="${index}" value="${sel.odds || ''}" placeholder="1.85">
        </div>
      </div>
    </div>
  `).join('');
  updateGeneratedTitle();
}

function updateGeneratedTitle() {
  const count = S.selections.filter(s => s.match || s.pick || s.odds).length;
  const badge = $('betTypeBadge');
  if (badge) badge.textContent = count > 1 ? `Combiné ${count}` : 'Simple';
  const title = buildGeneratedTitle();
  safeText('generatedTitle', title || 'Aucune sélection pour le moment.');
}

function buildGeneratedTitle() {
  const filled = S.selections.filter(s => s.match?.trim() || s.pick?.trim() || s.odds);
  if (!filled.length) return '';
  if (filled.length === 1) {
    const s = filled[0];
    return `${s.match?.trim() || 'Sélection'} — ${s.pick?.trim() || 'Pari'}${s.odds ? ` @ ${fmtOdds(s.odds)}` : ''}`;
  }
  return `${filled.length} sélections · ` + filled.map(s => `${s.match?.trim() || 'Match'} (${s.pick?.trim() || 'Pari'}${s.odds ? ` @ ${fmtOdds(s.odds)}` : ''})`).join(' | ');
}

function serializeSelections() {
  return JSON.stringify(S.selections.filter(s => s.match?.trim() || s.pick?.trim() || s.odds));
}

document.body?.addEventListener('click', async e => {
  const nav = e.target.closest('[data-view]');
  if (nav) return navigate(nav.dataset.view);

  const settle = e.target.closest('[data-settle]');
  if (settle) {
    await api.patch(`/api/bets/${settle.dataset.settle}`, { status: settle.dataset.status });
    showToast('Statut mis à jour.');
    await refreshAllVisible();
    return;
  }

  const del = e.target.closest('[data-delete]');
  if (del) {
    if (!confirm('Supprimer ce pari ?')) return;
    await api.del(`/api/bets/${del.dataset.delete}`);
    showToast('Pari supprimé.');
    await refreshAllVisible();
    return;
  }

  const edit = e.target.closest('[data-edit]');
  if (edit) return openEdit(edit.dataset.edit);

  const detail = e.target.closest('[data-detail]');
  if (detail) return openDetail(detail.dataset.detail);

  const removeSel = e.target.closest('[data-remove-selection]');
  if (removeSel) {
    S.selections.splice(Number(removeSel.dataset.removeSelection), 1);
    renderSelections();
  }
});

async function refreshAllVisible() {
  if (S.currentView === 'dashboard') await loadDashboard();
  if (S.currentView === 'history') await loadHistory();
  if (S.currentView === 'open') await loadOpen();
  if (S.currentView === 'stats') await loadStats();
  if (S.currentView !== 'dashboard') await loadDashboard();
}

async function openEdit(id) {
  const bets = await api.get('/api/bets');
  const bet = bets.find(b => b.id === id);
  if (!bet) return;
  S.editingId = id;
  if ($('editingId')) $('editingId').value = id;
  safeText('formTitle', 'Modifier le pari');
  if ($('fDate')) $('fDate').value = bet.bet_date;
  if ($('fSportField')) $('fSportField').value = bet.sport || '';
  if ($('fBookmakerField')) $('fBookmakerField').value = bet.bookmaker || '';
  if ($('fOdds')) $('fOdds').value = bet.odds;
  if ($('fStake')) $('fStake').value = bet.stake;
  if ($('fPotential')) $('fPotential').value = bet.potential_payout || '';
  if ($('fStatus')) $('fStatus').value = bet.status;
  if ($('fFreebet')) $('fFreebet').checked = !!bet.is_freebet;
  try {
    const parsed = JSON.parse(bet.notes || '[]');
    S.selections = Array.isArray(parsed) && parsed.length ? parsed : [createEmptySelection()];
  } catch {
    S.selections = [createEmptySelection()];
  }
  renderSelections();
  if ($('cancelEdit')) $('cancelEdit').style.display = '';
  safeText('submitBtn', 'Enregistrer les modifications');
  navigate('add');
}

function resetForm() {
  S.editingId = null;
  S.selections = [createEmptySelection()];
  if ($('editingId')) $('editingId').value = '';
  $('betForm')?.reset();
  if ($('fDate')) $('fDate').value = today();
  safeText('formTitle', 'Nouveau pari');
  if ($('cancelEdit')) $('cancelEdit').style.display = 'none';
  safeText('submitBtn', 'Enregistrer le pari');
  if ($('ocrRow')) $('ocrRow').style.display = 'none';
  if ($('ocrThumb')) $('ocrThumb').src = '';
  safeText('ocrExtract', '');
  safeText('ocrStatus', '');
  safeText('dropzoneLabel', 'Choisir un screenshot ou prendre une photo');
  renderSelections();
}

async function loadAutocompletes() {
  try {
    const [stats, settings] = await Promise.all([api.get('/api/stats'), api.get('/api/settings')]);
    safeHTML('sportList', (stats.sports || []).map(s => `<option value="${s}">`).join(''));
    safeHTML('bookmakerList', (stats.bookmakers || []).map(b => `<option value="${b}">`).join(''));
    if (settings.default_bookmaker && $('fBookmakerField') && !$('fBookmakerField').value) $('fBookmakerField').value = settings.default_bookmaker;
    if (settings.default_sport && $('fSportField') && !$('fSportField').value) $('fSportField').value = settings.default_sport;
  } catch (err) {
    console.error(err);
  }
}

function recalcPotential() {
  const odds = parseFloat($('fOdds')?.value || 0);
  const stake = parseFloat($('fStake')?.value || 0);
  if (odds && stake && $('fPotential')) $('fPotential').value = (odds * stake).toFixed(2);
}

$('betForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const odds = parseFloat($('fOdds')?.value || 0);
  const stake = parseFloat($('fStake')?.value || 0);
  const title = buildGeneratedTitle() || 'Pari sans titre';
  const payload = {
    title,
    bet_date: $('fDate')?.value || today(),
    sport: $('fSportField')?.value.trim() || '',
    bookmaker: $('fBookmakerField')?.value.trim() || '',
    odds,
    stake,
    potential_payout: parseFloat($('fPotential')?.value || 0) || +(odds * stake).toFixed(2),
    is_freebet: $('fFreebet')?.checked ? 1 : 0,
    status: $('fStatus')?.value || 'open',
    notes: serializeSelections(),
    source_image: $('ocrThumb')?.src || ''
  };
  try {
    if ($('editingId')?.value) {
      await api.patch(`/api/bets/${$('editingId').value}`, payload);
      showToast('Pari modifié.');
    } else {
      await api.post('/api/bets', payload);
      showToast('Pari enregistré.');
    }
    resetForm();
    navigate('dashboard');
  } catch (err) {
    console.error(err);
    showToast("Erreur lors de l'enregistrement.");
  }
});

$('cancelEdit')?.addEventListener('click', () => { resetForm(); navigate('history'); });
$('addSelectionBtn')?.addEventListener('click', () => { S.selections.push(createEmptySelection()); renderSelections(); });
$('fOdds')?.addEventListener('input', recalcPotential);
$('fStake')?.addEventListener('input', recalcPotential);

$('selectionsList')?.addEventListener('input', e => {
  const field = e.target.dataset.selField;
  const index = Number(e.target.dataset.selIndex);
  if (!field || Number.isNaN(index) || !S.selections[index]) return;
  S.selections[index][field] = field === 'odds' ? e.target.value : e.target.value;
  updateGeneratedTitle();
});

$('betImage')?.addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  safeText('dropzoneLabel', file.name);
  if ($('ocrThumb')) $('ocrThumb').src = URL.createObjectURL(file);
  if ($('ocrRow')) $('ocrRow').style.display = 'grid';
  safeText('ocrStatus', 'Analyse OCR en cours…');

  const fd = new FormData();
  fd.append('image', file);
  try {
    const uploadRes = await fetch('/api/upload', { method: 'POST', body: fd });
    const uploadData = await uploadRes.json();
    if ($('ocrThumb')) $('ocrThumb').src = uploadData.path || $('ocrThumb').src;
  } catch {}

  try {
    if (typeof Tesseract === 'undefined') throw new Error('OCR indisponible');
    const { data } = await Tesseract.recognize(file, 'eng+fra');
    const extracted = extractBetDataFromText(data.text || '');
    if (extracted.totalOdds && $('fOdds')) $('fOdds').value = extracted.totalOdds;
    if (extracted.stake && $('fStake')) $('fStake').value = extracted.stake;
    if (extracted.potential && $('fPotential')) $('fPotential').value = extracted.potential;
    if (extracted.freebet && $('fFreebet')) $('fFreebet').checked = true;
    if (extracted.sport && $('fSportField') && !$('fSportField').value) $('fSportField').value = extracted.sport;
    if (extracted.selections?.length) {
      S.selections = extracted.selections;
      renderSelections();
    }
    safeText('ocrStatus', 'Extraction terminée.');
    safeText('ocrExtract', [
      extracted.totalOdds ? `Cote totale ${fmtOdds(extracted.totalOdds)}` : '',
      extracted.stake ? `Mise ${fmt(extracted.stake)}` : '',
      extracted.potential ? `Gain ${fmt(extracted.potential)}` : '',
      extracted.selections?.length ? `${extracted.selections.length} sélection(s)` : '',
      extracted.freebet ? 'Freebet détecté' : ''
    ].filter(Boolean).join(' · '));
    recalcPotential();
  } catch (err) {
    console.error(err);
    safeText('ocrStatus', 'OCR indisponible, complète à la main.');
  }
});

function extractBetDataFromText(text) {
  const raw = text || '';
  const norm = raw.replace(/,/g, '.').replace(/\s+/g, ' ').trim();

  const moneyMatches = [...norm.matchAll(/(?:€|eur)?\s*(\d+(?:\.\d{1,2})?)\s*(?:€|eur)/gi)].map(m => +m[1]);
  const allDecimals = [...norm.matchAll(/\b(\d+\.\d{2})\b/g)].map(m => +m[1]);
  const allLines = raw.split(/\n+/).map(l => l.trim()).filter(Boolean);

  let stake = '';
  let potential = '';
  let totalOdds = '';

  const stakeLine = allLines.find(l => /mise|stake|wager/i.test(l));
  const gainLine = allLines.find(l => /gain|retour|payout|potential|gains potentiels/i.test(l));
  const oddsLine = allLines.find(l => /cote totale|total odds|odds/i.test(l));

  if (stakeLine) {
    const m = stakeLine.match(/(\d+(?:[\.,]\d{1,2})?)/);
    if (m) stake = +m[1].replace(',', '.');
  }
  if (gainLine) {
    const m = gainLine.match(/(\d+(?:[\.,]\d{1,2})?)/);
    if (m) potential = +m[1].replace(',', '.');
  }
  if (oddsLine) {
    const m = oddsLine.match(/(\d+(?:[\.,]\d{1,2})?)/);
    if (m) totalOdds = +m[1].replace(',', '.');
  }

  if (!stake && moneyMatches.length) stake = moneyMatches[0];
  if (!potential && moneyMatches.length > 1) potential = Math.max(...moneyMatches);

  if (!totalOdds) {
    const candidates = allDecimals.filter(n => n >= 1.05 && n <= 100);
    if (potential && stake) {
      const ratio = +(potential / stake).toFixed(2);
      const close = candidates.find(n => Math.abs(n - ratio) <= 0.08);
      totalOdds = close || candidates[candidates.length - 1] || '';
    } else {
      totalOdds = candidates[candidates.length - 1] || '';
    }
  }

  const selectionCandidates = allLines
    .filter(l => !/mise|stake|gain|retour|payout|odds|cote totale|pari|freebet|bonus/i.test(l))
    .filter(l => /\d+\.\d{2}|vs|v\.|-|—|over|under|plus de|moins de|1x2|btts|double chance/i.test(l));

  const selections = selectionCandidates.slice(0, 8).map(line => {
    const oddsMatch = line.match(/(\d+(?:\.\d{2}))/);
    const odds = oddsMatch ? +oddsMatch[1] : '';
    let cleaned = line.replace(/(\d+(?:\.\d{2}))/g, '').replace(/\s+/g, ' ').trim();
    let match = cleaned;
    let pick = '';
    const separators = [' — ', ' - ', ' | ', ' / '];
    for (const sep of separators) {
      if (cleaned.includes(sep)) {
        const parts = cleaned.split(sep).map(s => s.trim()).filter(Boolean);
        if (parts.length >= 2) {
          match = parts[0];
          pick = parts.slice(1).join(' - ');
          break;
        }
      }
    }
    return { match, pick, odds };
  }).filter(s => s.match || s.pick || s.odds);

  let sport = '';
  if (/football|soccer/i.test(norm)) sport = 'Football';
  else if (/tennis/i.test(norm)) sport = 'Tennis';
  else if (/basket/i.test(norm)) sport = 'Basketball';

  return {
    totalOdds,
    stake,
    potential,
    freebet: /free ?bet|bonus|gratuit/i.test(norm),
    sport,
    selections: selections.length ? selections : [createEmptySelection()]
  };
}

$('settingsBtn')?.addEventListener('click', async () => {
  try {
    const s = await api.get('/api/settings');
    if ($('sBankrollStart')) $('sBankrollStart').value = s.starting_bankroll || '';
    if ($('sDefaultBookmaker')) $('sDefaultBookmaker').value = s.default_bookmaker || '';
    if ($('sDefaultSport')) $('sDefaultSport').value = s.default_sport || '';
    $('settingsBackdrop')?.classList.add('open');
  } catch (err) {
    console.error(err);
  }
});

$('closeSettings')?.addEventListener('click', () => $('settingsBackdrop')?.classList.remove('open'));

$('saveSettings')?.addEventListener('click', async () => {
  try {
    await api.patch('/api/settings', {
      starting_bankroll: parseFloat($('sBankrollStart')?.value || 0) || 0,
      default_bookmaker: $('sDefaultBookmaker')?.value.trim() || '',
      default_sport: $('sDefaultSport')?.value.trim() || ''
    });
    $('settingsBackdrop')?.classList.remove('open');
    showToast('Paramètres sauvegardés.');
    await refreshAllVisible();
  } catch (err) {
    console.error(err);
    showToast('Erreur paramètres.');
  }
});

async function openDetail(id) {
  try {
    const bets = await api.get('/api/bets');
    const b = bets.find(x => x.id === id);
    if (!b) return;
    const events = await api.get(`/api/bets/${id}/events`);
    let selections = [];
    try { selections = JSON.parse(b.notes || '[]'); } catch { selections = []; }
    const pnl = computeLocalPnl(b);
    safeText('detailTitle', b.title);
    safeHTML('detailBody', `
      <div class="bet-figures" style="margin-bottom:var(--space-4)">
        <div class="fig-box"><span>Cote</span><strong>${fmtOdds(b.odds)}</strong></div>
        <div class="fig-box"><span>Mise</span><strong>${fmt(b.stake)}</strong></div>
        <div class="fig-box"><span>Gain potentiel</span><strong>${fmt(b.potential_payout)}</strong></div>
        <div class="fig-box"><span>P&L</span><strong class="${pnl > 0 ? 'is-profit' : pnl < 0 ? 'is-loss' : 'is-neutral'}">${pnl > 0 ? '+' : ''}${fmt(pnl)}</strong></div>
      </div>
      ${selections.length ? `<div class="detail-selections">${selections.map((s, i) => `<div class="bet-meta-row">${i + 1}. ${selectionSummary(s)}</div>`).join('')}</div>` : ''}`);
    safeHTML('detailEvents', `<div class="event-log">${events.map(ev => `<div class="event-item"><span class="event-dot"></span><div><div>${ev.event_type}</div><div class="bet-meta-row">${ev.event_date}</div></div><span class="event-delta ${ev.bankroll_delta > 0 ? 'pos' : ev.bankroll_delta < 0 ? 'neg' : ''}">${ev.bankroll_delta !== 0 ? (ev.bankroll_delta > 0 ? '+' : '') + fmt(ev.bankroll_delta) : ''}</span></div>`).join('')}</div>`);
    $('betDetailBackdrop')?.classList.add('open');
  } catch (err) {
    console.error(err);
  }
}

$('closeBetDetail')?.addEventListener('click', () => $('betDetailBackdrop')?.classList.remove('open'));
$('fSport')?.addEventListener('change', e => { S.dashFilter.sport = e.target.value; loadDashboard(); });
$('fBookmaker')?.addEventListener('change', e => { S.dashFilter.bookmaker = e.target.value; loadDashboard(); });
$('fPeriod')?.addEventListener('change', e => {
  S.dashFilter.period = e.target.value;
  if ($('customDateRange')) $('customDateRange').style.display = e.target.value === 'custom' ? 'flex' : 'none';
  if (e.target.value !== 'custom') loadDashboard();
});
$('fDateStart')?.addEventListener('change', e => { S.dashFilter.dateStart = e.target.value; if (S.dashFilter.dateEnd) loadDashboard(); });
$('fDateEnd')?.addEventListener('change', e => { S.dashFilter.dateEnd = e.target.value; loadDashboard(); });
$('hSport')?.addEventListener('change', e => { S.histFilter.sport = e.target.value; loadHistory(); });
$('hBookmaker')?.addEventListener('change', e => { S.histFilter.bookmaker = e.target.value; loadHistory(); });
$('hPeriod')?.addEventListener('change', e => { S.histFilter.period = e.target.value; loadHistory(); });
$('statusPills')?.addEventListener('click', e => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  document.querySelectorAll('#statusPills .pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');
  S.histFilter.status = pill.dataset.status;
  loadHistory();
});
$('themeBtn')?.addEventListener('click', () => {
  S.theme = S.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', S.theme);
  if (S.currentView === 'dashboard') loadDashboard();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
if ($('fDate')) $('fDate').value = today();
resetForm();
navigate('dashboard');
