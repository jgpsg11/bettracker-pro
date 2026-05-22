import express from 'express';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const uploadsDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });
app.use('/uploads', express.static(uploadsDir));

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'bets.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    currency TEXT NOT NULL DEFAULT 'EUR',
    starting_bankroll REAL NOT NULL DEFAULT 0,
    default_bookmaker TEXT DEFAULT '',
    default_sport TEXT DEFAULT ''
  );
  INSERT OR IGNORE INTO settings (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS bets (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    bet_date TEXT NOT NULL,
    title TEXT NOT NULL,
    sport TEXT DEFAULT '',
    bookmaker TEXT DEFAULT '',
    odds REAL NOT NULL,
    stake REAL NOT NULL,
    potential_payout REAL,
    is_freebet INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open'
      CHECK (status IN ('open','won','lost','void')),
    notes TEXT DEFAULT '',
    source_image TEXT DEFAULT '',
    settled_at TEXT
  );

  CREATE TABLE IF NOT EXISTS bet_events (
    id TEXT PRIMARY KEY,
    bet_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_date TEXT NOT NULL,
    previous_status TEXT,
    new_status TEXT,
    previous_stake REAL,
    new_stake REAL,
    previous_odds REAL,
    new_odds REAL,
    bankroll_delta REAL NOT NULL DEFAULT 0,
    note TEXT DEFAULT '',
    FOREIGN KEY (bet_id) REFERENCES bets(id)
  );
`);

function calcBankroll() {
  const s = db.prepare('SELECT starting_bankroll FROM settings WHERE id=1').get();
  const e = db.prepare('SELECT SUM(bankroll_delta) as total FROM bet_events').get();
  return (s.starting_bankroll || 0) + (e.total || 0);
}

function computeDelta(bet, status) {
  if (status === 'won') return bet.is_freebet ? (bet.potential_payout||0) : (bet.potential_payout||0) - bet.stake;
  if (status === 'lost') return bet.is_freebet ? 0 : -bet.stake;
  return 0;
}

app.get('/api/settings', (req, res) =>
  res.json(db.prepare('SELECT * FROM settings WHERE id=1').get()));

app.patch('/api/settings', (req, res) => {
  const { starting_bankroll, currency, default_bookmaker, default_sport } = req.body;
  db.prepare(`UPDATE settings SET
    starting_bankroll=COALESCE(?,starting_bankroll),
    currency=COALESCE(?,currency),
    default_bookmaker=COALESCE(?,default_bookmaker),
    default_sport=COALESCE(?,default_sport)
    WHERE id=1`).run(starting_bankroll, currency, default_bookmaker, default_sport);
  res.json(db.prepare('SELECT * FROM settings WHERE id=1').get());
});

app.get('/api/stats', (req, res) => {
  const { sport, bookmaker, period_start, period_end } = req.query;
  const where = ["status!='open'"]; const params = [];
  if (sport)        { where.push('sport=?');    params.push(sport); }
  if (bookmaker)    { where.push('bookmaker=?'); params.push(bookmaker); }
  if (period_start) { where.push('bet_date>=?'); params.push(period_start); }
  if (period_end)   { where.push('bet_date<=?'); params.push(period_end); }
  const clause = 'WHERE ' + where.join(' AND ');
  const closed = db.prepare(`SELECT * FROM bets ${clause} ORDER BY bet_date ASC`).all(...params);
  const all = db.prepare('SELECT * FROM bets ORDER BY bet_date ASC').all();

  let running = db.prepare('SELECT starting_bankroll FROM settings WHERE id=1').get().starting_bankroll || 0;
  const bankroll_points = all.filter(b => b.status !== 'open').map(b => {
    if (b.status === 'won') running += b.is_freebet ? b.potential_payout : b.potential_payout - b.stake;
    if (b.status === 'lost' && !b.is_freebet) running -= b.stake;
    return { date: b.bet_date, title: b.title, value: +running.toFixed(2) };
  });

  const won = closed.filter(b => b.status === 'won').length;
  const oddsArr = closed.map(b => b.odds).filter(Boolean);
  const avgOdds = oddsArr.length ? oddsArr.reduce((s,v)=>s+v,0)/oddsArr.length : 0;
  const pnl = closed.reduce((sum,b) => {
    if (b.status==='won') return sum + (b.is_freebet?b.potential_payout:b.potential_payout-b.stake);
    if (b.status==='lost'&&!b.is_freebet) return sum - b.stake;
    return sum;
  }, 0);

  res.json({
    bankroll: +calcBankroll().toFixed(2),
    filtered_pnl: +pnl.toFixed(2),
    count: closed.length,
    open_count: db.prepare("SELECT COUNT(*) as c FROM bets WHERE status='open'").get().c,
    won_count: won,
    hit_rate: closed.length ? +((won/closed.length)*100).toFixed(1) : 0,
    avg_odds: +avgOdds.toFixed(2),
    bankroll_points,
    sports: [...new Set(all.map(b=>b.sport).filter(Boolean))],
    bookmakers: [...new Set(all.map(b=>b.bookmaker).filter(Boolean))]
  });
});

app.get('/api/bets', (req, res) => {
  const { sport, bookmaker, period_start, period_end, status } = req.query;
  const where = []; const params = [];
  if (sport)        { where.push('sport=?');    params.push(sport); }
  if (bookmaker)    { where.push('bookmaker=?'); params.push(bookmaker); }
  if (period_start) { where.push('bet_date>=?'); params.push(period_start); }
  if (period_end)   { where.push('bet_date<=?'); params.push(period_end); }
  if (status === 'freebet') where.push('is_freebet=1');
  else if (status && status !== 'all') { where.push('status=?'); params.push(status); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  res.json(db.prepare(`SELECT * FROM bets ${clause} ORDER BY bet_date DESC, created_at DESC`).all(...params));
});

app.post('/api/bets', (req, res) => {
  const now = new Date().toISOString(); const id = randomUUID();
  const { title,bet_date,sport,bookmaker,odds,stake,potential_payout,is_freebet,status,notes,source_image } = req.body;
  const pot = potential_payout || +(odds*stake).toFixed(2);
  db.prepare(`INSERT INTO bets (id,created_at,updated_at,bet_date,title,sport,bookmaker,odds,stake,potential_payout,is_freebet,status,notes,source_image) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,now,now,bet_date,title,sport||'',bookmaker||'',odds,stake,pot,is_freebet?1:0,status||'open',notes||'',source_image||'');
  if (status && status !== 'open') {
    const bet = db.prepare('SELECT * FROM bets WHERE id=?').get(id);
    const delta = computeDelta(bet, status);
    db.prepare(`INSERT INTO bet_events (id,bet_id,event_type,event_date,previous_status,new_status,bankroll_delta) VALUES (?,?,?,?,?,?,?)`).run(randomUUID(),id,'created_and_settled',now,'open',status,delta);
    db.prepare('UPDATE bets SET settled_at=? WHERE id=?').run(now, id);
  }
  res.status(201).json(db.prepare('SELECT * FROM bets WHERE id=?').get(id));
});

app.patch('/api/bets/:id', (req, res) => {
  const now = new Date().toISOString();
  const ex = db.prepare('SELECT * FROM bets WHERE id=?').get(req.params.id);
  if (!ex) return res.status(404).json({error:'Not found'});
  const { title,bet_date,sport,bookmaker,odds,stake,potential_payout,is_freebet,status,notes,source_image } = req.body;
  const ns=status||ex.status, nSt=stake??ex.stake, nO=odds??ex.odds;
  const nPot=potential_payout||+(nO*nSt).toFixed(2);
  const nFb=is_freebet!==undefined?(is_freebet?1:0):ex.is_freebet;
  if (ex.status!=='open' && (ns!==ex.status||nSt!==ex.stake||nO!==ex.odds)) {
    const correction = computeDelta({...ex,stake:nSt,potential_payout:nPot,odds:nO,is_freebet:nFb},ns) - computeDelta(ex,ex.status);
    db.prepare(`INSERT INTO bet_events (id,bet_id,event_type,event_date,previous_status,new_status,previous_stake,new_stake,previous_odds,new_odds,bankroll_delta,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),req.params.id,'adjustment',now,ex.status,ns,ex.stake,nSt,ex.odds,nO,correction,'Modification manuelle');
  } else if (ex.status==='open' && ns!=='open') {
    const delta = computeDelta({...ex,stake:nSt,potential_payout:nPot,is_freebet:nFb},ns);
    db.prepare(`INSERT INTO bet_events (id,bet_id,event_type,event_date,previous_status,new_status,bankroll_delta) VALUES (?,?,?,?,?,?,?)`).run(randomUUID(),req.params.id,'settled',now,'open',ns,delta);
    db.prepare('UPDATE bets SET settled_at=? WHERE id=?').run(now, req.params.id);
  }
  db.prepare(`UPDATE bets SET updated_at=?,title=?,bet_date=?,sport=?,bookmaker=?,odds=?,stake=?,potential_payout=?,is_freebet=?,status=?,notes=?,source_image=? WHERE id=?`).run(now,title??ex.title,bet_date??ex.bet_date,sport??ex.sport,bookmaker??ex.bookmaker,nO,nSt,nPot,nFb,ns,notes??ex.notes,source_image??ex.source_image,req.params.id);
  res.json(db.prepare('SELECT * FROM bets WHERE id=?').get(req.params.id));
});

app.delete('/api/bets/:id', (req, res) => {
  const ex = db.prepare('SELECT * FROM bets WHERE id=?').get(req.params.id);
  if (!ex) return res.status(404).json({error:'Not found'});
  if (ex.status !== 'open') {
    const rev = -computeDelta(ex, ex.status);
    if (rev !== 0) db.prepare(`INSERT INTO bet_events (id,bet_id,event_type,event_date,previous_status,new_status,bankroll_delta,note) VALUES (?,?,?,?,?,?,?,?)`).run(randomUUID(),ex.id,'deleted',new Date().toISOString(),ex.status,'deleted',rev,'Suppression');
  }
  db.prepare('DELETE FROM bets WHERE id=?').run(req.params.id);
  res.json({ok:true});
});

app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({error:'No file'});
  res.json({path:`/uploads/${req.file.filename}`});
});

app.get('/api/bets/:id/events', (req, res) =>
  res.json(db.prepare('SELECT * FROM bet_events WHERE bet_id=? ORDER BY event_date ASC').all(req.params.id)));

app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ BetTracker Pro → http://localhost:${PORT}`));