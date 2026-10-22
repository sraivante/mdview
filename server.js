const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 4200;
const PATHS_DB = path.join(__dirname, 'paths.json');

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/marked.min.js', (req, res) =>
  res.sendFile(path.join(__dirname, 'node_modules', 'marked', 'marked.min.js'))
);

// ---------- path memory (recent 10 + frequent 10) ----------
function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(PATHS_DB, 'utf8'));
  } catch {
    return { recent: [], freq: {} };
  }
}
function saveDb(db) {
  fs.writeFileSync(PATHS_DB, JSON.stringify(db, null, 2));
}
function rememberPath(p, bump) {
  const db = loadDb();
  db.recent = [p, ...db.recent.filter(x => x !== p)].slice(0, 10);
  if (bump) db.freq[p] = (db.freq[p] || 0) + 1; // count opens only, not saves
  saveDb(db);
}

function annotate(p) {
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (fs.existsSync(path.join(p, 'SKILL.md'))) return { kind: 'dir', skill: true };
      // skills root = contains skill folders (nested allowed)
      const found = findSkills(p, 2, p, []);
      return { kind: 'dir', root: found.length > 0 };
    }
    return { kind: 'file', rule: /\.mdc$/i.test(p) || /\.cursorrules$/i.test(p), skill: /skill\.md$/i.test(p) };
  } catch { return { kind: 'missing' }; }
}

app.get('/api/paths', (req, res) => {
  const db = loadDb();
  const frequent = Object.entries(db.freq)
    .filter(([, count]) => count >= 2) // frequent = opened more than once
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([p, count]) => ({ path: p, count, ...annotate(p) }));
  res.json({ recent: db.recent.map(p => ({ path: p, ...annotate(p) })), frequent });
});

app.post('/api/paths/forget', (req, res) => {
  const { path: p } = req.body;
  const db = loadDb();
  db.recent = db.recent.filter(x => x !== p);
  delete db.freq[p];
  saveDb(db);
  res.json({ ok: true });
});

// ---------- file operations ----------
app.get('/api/file', (req, res) => {
  const p = req.query.path;
  if (!p) return res.status(400).json({ error: 'path required' });
  const abs = path.resolve(p);
  fs.readFile(abs, 'utf8', (err, data) => {
    if (err) return res.status(404).json({ error: err.message });
    if (req.query.record !== '0') rememberPath(abs, true);
    res.json({ path: abs, content: data });
  });
});

app.post('/api/file', (req, res) => {
  const { path: p, content } = req.body;
  if (!p) return res.status(400).json({ error: 'path required' });
  const abs = path.resolve(p);
  fs.writeFile(abs, content, 'utf8', err => {
    if (err) return res.status(500).json({ error: err.message });
    rememberPath(abs, false);
    res.json({ ok: true, path: abs });
  });
});

// ---------- folder mode: stat, tree, skills scan, raw files ----------
const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build']);

app.get('/api/stat', (req, res) => {
  const p = req.query.path;
  if (!p) return res.status(400).json({ error: 'path required' });
  const abs = path.resolve(p);
  fs.stat(abs, (err, st) => {
    if (err) return res.status(404).json({ error: err.message });
    res.json({ path: abs, kind: st.isDirectory() ? 'dir' : 'file', size: st.size });
  });
});

app.post('/api/paths/touch', (req, res) => {
  const { path: p, bump } = req.body;
  if (p) rememberPath(path.resolve(p), !!bump);
  res.json({ ok: true });
});

function walkTree(dir, depth) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.cursorrules') continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push({ name: e.name, path: full, kind: 'dir', children: depth > 0 ? walkTree(full, depth - 1) : [] });
    } else {
      let size = 0;
      try { size = fs.statSync(full).size; } catch {}
      out.push({ name: e.name, path: full, kind: 'file', size });
    }
  }
  return out;
}

app.get('/api/tree', (req, res) => {
  if (!req.query.dir) return res.status(400).json({ error: 'dir required' });
  const dir = path.resolve(req.query.dir);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'not found' });
  res.json({ dir, tree: walkTree(dir, 6) });
});

function readFrontmatter(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    if (!txt.startsWith('---')) return {};
    const end = txt.indexOf('\n---', 3);
    if (end < 0) return {};
    const fm = {};
    for (const line of txt.slice(3, end).split('\n')) {
      const m = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
      if (m) fm[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
    return fm;
  } catch { return {}; }
}

// recursively find skill folders (dirs containing SKILL.md) up to a few levels deep
function findSkills(dir, depth, base, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const sub = path.join(dir, e.name);
    const sk = path.join(sub, 'SKILL.md');
    if (fs.existsSync(sk)) {
      const fm = readFrontmatter(sk);
      out.push({ path: sub, folder: path.relative(base, sub), name: fm.name || e.name, description: fm.description || '' });
    } else if (depth > 0) {
      findSkills(sub, depth - 1, base, out);
    }
    if (out.length >= 200) break;
  }
  return out;
}

// scan a root folder for skills (nested up to 4 levels), or the folder itself
app.get('/api/skills', (req, res) => {
  if (!req.query.dir) return res.status(400).json({ error: 'dir required' });
  const dir = path.resolve(req.query.dir);
  const result = { dir, self: null, skills: [] };
  const selfSkill = path.join(dir, 'SKILL.md');
  if (fs.existsSync(selfSkill)) {
    const fm = readFrontmatter(selfSkill);
    result.self = { path: dir, name: fm.name || path.basename(dir), description: fm.description || '' };
    return res.json(result);
  }
  result.skills = findSkills(dir, 4, dir, []).sort((a, b) => a.name.localeCompare(b.name));
  res.json(result);
});

// raw file serve (images, scripts) — content type by extension
app.get('/api/raw', (req, res) => {
  const p = req.query.path;
  if (!p) return res.status(400).json({ error: 'path required' });
  res.sendFile(path.resolve(p), err => { if (err && !res.headersSent) res.status(404).end(); });
});

// ---------- directory browse (for the file picker) ----------
app.get('/api/browse', (req, res) => {
  const dir = req.query.dir ? path.resolve(req.query.dir) : path.parse(process.cwd()).root;
  fs.readdir(dir, { withFileTypes: true }, (err, entries) => {
    if (err) return res.status(400).json({ error: err.message });
    const dirs = [];
    const files = [];
    for (const e of entries) {
      if (e.name.startsWith('$') || e.name === 'System Volume Information') continue;
      if (e.isDirectory()) dirs.push(e.name);
      else if (/\.(md|markdown|mdx|mdc|txt)$/i.test(e.name)) files.push(e.name);
    }
    dirs.sort((a, b) => a.localeCompare(b));
    files.sort((a, b) => a.localeCompare(b));
    res.json({ dir, parent: path.dirname(dir) !== dir ? path.dirname(dir) : null, dirs, files });
  });
});

// ---------- native OS file picker (Windows) ----------
app.get('/api/pick', (req, res) => {
  if (process.platform !== 'win32') return res.status(501).json({ error: 'native picker is Windows-only' });
  const initDir = req.query.dir ? path.resolve(req.query.dir).replace(/'/g, "''") : '';
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Filter = 'Markdown & rules (*.md;*.markdown;*.mdx;*.mdc;*.txt)|*.md;*.markdown;*.mdx;*.mdc;*.txt|All files (*.*)|*.*'
$f.Title = 'Open Markdown file'
${initDir ? `$f.InitialDirectory = '${initDir}'` : ''}
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; WindowState = 'Minimized'; ShowInTaskbar = $false }
if ($f.ShowDialog($owner) -eq 'OK') { Write-Output $f.FileName }
$owner.Dispose()`;
  execFile('powershell', ['-NoProfile', '-STA', '-Command', ps], { timeout: 300000 }, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
    const picked = stdout.trim();
    res.json({ path: picked || null });
  });
});

// native folder picker (Windows)
app.get('/api/pick-dir', (req, res) => {
  if (process.platform !== 'win32') return res.status(501).json({ error: 'Windows-only' });
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = 'Open a skill folder or a skills root folder'
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; WindowState = 'Minimized'; ShowInTaskbar = $false }
if ($f.ShowDialog($owner) -eq 'OK') { Write-Output $f.SelectedPath }
$owner.Dispose()`;
  execFile('powershell', ['-NoProfile', '-STA', '-Command', ps], { timeout: 300000 }, (err, stdout) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ path: stdout.trim() || null });
  });
});

// bind to localhost only — this server reads/writes local files and must never be exposed
app.listen(PORT, '127.0.0.1', () => {
  console.log(`MDVIEW running at http://localhost:${PORT}`);
});
