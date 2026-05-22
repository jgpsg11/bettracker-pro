const S = {
  theme: document.documentElement.getAttribute('data-theme') || 'dark',
  currentView: 'dashboard',
  editingId: null,
  dashFilter: { sport: '', bookmaker: '', period: '', dateStart: '', dateEnd: '' },
  histFilter: { sport: '', bookmaker: '', period: '', status: 'all' },
  charts: {}
};

const $ = id => document.getElementById(id);
const fmt = (v, dec = 2) => new Intl.NumberFormat('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Number(v || 0)) + '€';
const fmtOdds = v => Number(v || 0).toFixed(2);
const today = () => new Date().toISOString().split('T')[0];
const safeText = (id, value) => { const el = $(id); if (el) el.textContent = value; };
const safeHTML = (id, value) => { const el = $(id); if (el) el.innerHTML = value; };

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
  setTimeout(() => t.remove(), 2500);
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
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`view-${view}`)?.classList.add('active');
  document.querySelectorAll(`[data-view="${view}"]`).forEach(el => el.classList.add('active'));
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

async function loadDashboard() {
  try {
    const f = S.dashFilter;
    const range = f.period === 'custom' ? { start: f.dateStart, end: f.dateEnd } : periodRange(f.period);
    const params = new URLSearchParams();
    if (f.sport) params.set('sport', f.sport);
    if (f.bookmaker) params.set('bookmaker', f.bookmaker);
    if (range.start) params.set('period_start', range.start);
    if (range.end) params.set('period_end', range.end);

    const stats = await api.get(`/api/stats?${params}`);
    safeText('topBankroll', fmt(stats.bankroll));
    safeText('heroBankroll', fmt(stats.bankroll));
    safeText('heroPnl', `P&L filtré : ${stats.filtered_pnl >= 0 ? '+' : ''}${fmt(stats.filtered_pnl)}`);
    safeText('metCount', stats.count);
    safeText('metOpen', stats.open_count);
    safeText('metHitRate', `${stats.hit_rate}%`);
    safeText('metAvgOdds', fmtOdds(stats.avg_odds));
    populateSelect('fSport', stats.sports, f.sport, 'Tous les sports');
    populateSelect('fBookmaker', stats.bookmakers, f.bookmaker, 'Tous les bookmakers');
    drawBankrollChart(stats.bankroll_points || []);
    const bets = await api.get(`/api/bets?${params}`);
    renderBetList('recentBets', bets.filter(b => b.status !== 'open').slice(0, 5), { compact: true });
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
      labels: points.length ? points.map((_, i) => String(i + 1)) : ['0'],
      datasets: [{
        data: points.length ? points.map(p => p.value) : [0],
        borderColor: primary,
        backgroundColor: primary + '28',
        tension: 0.38,
        fill: true,
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: muted } }, y: { ticks: { color: muted } } }
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
    const [stats, bets] = await Promise.all([api.get('/api/stats'), api.get('/api/bets')]);
    safeText('sBankroll', fmt(stats.bankroll));
    safeText('sPnl', `${stats.filtered_pnl >= 0 ? '+' : ''}${fmt(stats.filtered_pnl)}`);
    safeText('sWon', stats.won_count);
    safeText('sHit', `${stats.hit_rate}%`);
    safeText('sOdds', fmtOdds(stats.avg_odds));
    safeText('sStaked', fmt(bets.filter(b => !b.is_freebet).reduce((s, b) => s + b.stake, 0)));
  } catch (err) {
    console.error(err);
  }
}

function statusBadge(b) {
  const map = { open: 'badge-open', won: 'badge-won', lost: 'badge-lost', void: 'badge-void' };
  const labels = { open: 'En cours', won: 'Gagné', lost: 'Perdu', void: 'Annulé' };
  return `<span class="badge ${map[b.status] || 'badge-open'}">${labels[b.status] || b.status}${b.is_freebet ? ' · FB' : ''}</span>`;
}

function renderBetList(containerId, bets, opts = {}) {
  const el = $(containerId);
  if (!el) return;
  if (!bets.length) {
    el.innerHTML = `<div class="empty"><p>Aucun pari ici pour le moment.</p></div>`;
    return;
  }
  el.innerHTML = bets.map(b => `
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
        ${!opts.compact ? `<div class="fig-box"><span>Type</span><strong>${b.is_freebet ? 'Freebet' : 'Cash'}</strong></div>` : ''}
      </div>
      ${b.notes ? `<p class="bet-meta-row">${b.notes}</p>` : ''}
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
  `).join('');
}

document.body?.addEventListener('click', async e => {
  const nav = e.target.closest('[data-view]');
  if (nav) return navigate(nav.dataset.view);

  const settle = e.target.closest('[data-settle]');
  if (settle) {
    await api.patch(`/api/bets/${settle.dataset.settle}`, { status: settle.dataset.status });
    showToast('Statut mis à jour.');
    return navigate(S.currentView);
  }

  const del = e.target.closest('[data-delete]');
  if (del) {
    if (!confirm('Supprimer ce pari ?')) return;
    await api.del(`/api/bets/${del.dataset.delete}`);
    showToast('Pari supprimé.');
    return navigate(S.currentView);
  }

  const edit = e.target.closest('[data-edit]');
  if (edit) return openEdit(edit.dataset.edit);

  const detail = e.target.closest('[data-detail]');
  if (detail) return openDetail(detail.dataset.detail);
});

async function openEdit(id) {
  const bets = await api.get('/api/bets');
  const bet = bets.find(b => b.id === id);
  if (!bet) return;
  S.editingId = id;
  if ($('editingId')) $('editingId').value = id;
  safeText('formTitle', 'Modifier le pari');
  if ($('fTitle')) $('fTitle').value = bet.title;
  if ($('fDate')) $('fDate').value = bet.bet_date;
  if ($('fSportField')) $('fSportField').value = bet.sport || '';
  if ($('fBookmakerField')) $('fBookmakerField').value = bet.bookmaker || '';
  if ($('fOdds')) $('fOdds').value = bet.odds;
  if ($('fStake')) $('fStake').value = bet.stake;
  if ($('fPotential')) $('fPotential').value = bet.potential_payout || '';
  if ($('fStatus')) $('fStatus').value = bet.status;
  if ($('fFreebet')) $('fFreebet').checked = !!bet.is_freebet;
  if ($('fNotes')) $('fNotes').value = bet.notes || '';
  if ($('cancelEdit')) $('cancelEdit').style.display = '';
  safeText('submitBtn', 'Enregistrer les modifications');
  navigate('add');
}

function resetForm() {
  S.editingId = null;
  if ($('editingId')) $('editingId').value = '';
  $('betForm')?.reset();
  if ($('fDate')) $('fDate').value = today();
  safeText('formTitle', 'Nouveau pari');
  if ($('cancelEdit')) $('cancelEdit').style.display = 'none';
  safeText('submitBtn', 'Enregistrer le pari');
  if ($('ocrRow')) $('ocrRow').style.display = 'none';
  if ($('ocrThumb')) $('ocrThumb').src = '';
  safeText('ocrExtract', '');
  safeText('dropzoneLabel', 'Appuie pour prendre une photo ou choisir une image');
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

$('betForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const odds = parseFloat($('fOdds')?.value || 0);
  const stake = parseFloat($('fStake')?.value || 0);
  const payload = {
    title: $('fTitle')?.value.trim() || '',
    bet_date: $('fDate')?.value || today(),
    sport: $('fSportField')?.value.trim() || '',
    bookmaker: $('fBookmakerField')?.value.trim() || '',
    odds,
    stake,
    potential_payout: parseFloat($('fPotential')?.value || 0) || +(odds * stake).toFixed(2),
    is_freebet: $('fFreebet')?.checked ? 1 : 0,
    status: $('fStatus')?.value || 'open',
    notes: $('fNotes')?.value.trim() || '',
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

['fOdds', 'fStake'].forEach(id => {
  $(id)?.addEventListener('input', () => {
    const o = parseFloat($('fOdds')?.value || 0);
    const s = parseFloat($('fStake')?.value || 0);
    if (o && s && $('fPotential') && !$('fPotential').value) $('fPotential').value = (o * s).toFixed(2);
  });
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
    const extracted = extractFromText(data.text || '');
    if (extracted.odds && $('fOdds')) $('fOdds').value = extracted.odds;
    if (extracted.stake && $('fStake')) $('fStake').value = extracted.stake;
    if (extracted.potential && $('fPotential')) $('fPotential').value = extracted.potential;
    if (extracted.freebet && $('fFreebet')) $('fFreebet').checked = true;
    safeText('ocrStatus', 'Extraction terminée.');
    safeText('ocrExtract', [
      extracted.odds ? `Cote ${fmtOdds(extracted.odds)}` : '',
      extracted.stake ? `Mise ${fmt(extracted.stake)}` : '',
      extracted.potential ? `Gain ${fmt(extracted.potential)}` : '',
      extracted.freebet ? 'Freebet détecté' : ''
    ].filter(Boolean).join(' · '));
  } catch {
    safeText('ocrStatus', 'OCR indisponible, complète à la main.');
  }
});

function extractFromText(text) {
  const norm = text.replace(/,/g, '.').replace(/\s+/g, ' ');
  const moneys = [...norm.matchAll(/(\d+(?:\.\d{1,2})?)\s*€/g)].map(m => +m[1]);
  const decimals = [...norm.matchAll(/\b(\d+\.\d{2})\b/g)].map(m => +m[1]);
  const odds = decimals.find(n => n >= 1.05 && n <= 50);
  const stake = moneys[0] || decimals.find(n => n > 0.5 && n <= 2000 && n !== odds);
  const potential = moneys.find(n => n !== stake && n > 0) || decimals.find(n => n > (stake || 0) && n !== odds);
  return { odds: odds || '', stake: stake || '', potential: potential || '', freebet: /free ?bet|bonus|gratuit/i.test(text) };
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
    loadDashboard();
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
    safeText('detailTitle', b.title);
    safeHTML('detailBody', `
      <div class="bet-figures" style="margin-bottom:var(--space-4)">
        <div class="fig-box"><span>Cote</span><strong>${fmtOdds(b.odds)}</strong></div>
        <div class="fig-box"><span>Mise</span><strong>${fmt(b.stake)}</strong></div>
        <div class="fig-box"><span>Gain potentiel</span><strong>${fmt(b.potential_payout)}</strong></div>
        <div class="fig-box"><span>Type</span><strong>${b.is_freebet ? 'Freebet' : 'Cash'}</strong></div>
      </div>`);
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
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
if ($('fDate')) $('fDate').value = today();
navigate('dashboard');
