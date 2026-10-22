/* MDVIEW — section-wise markdown viewer & editor */

const $ = sel => document.querySelector(sel);

const state = {
  path: null,       // current file path
  sections: [],     // [{level, title, body}]  level 0 = preamble (no heading)
  frontmatter: null,// raw YAML text between --- fences (without fences)
  dirty: false,
  editing: -1,      // index being edited, -1 = none
  // folder / skill mode
  mode: 'file',     // 'file' | 'skill' | 'root' | 'tree'
  root: null,       // folder being explored
  tree: [],         // file tree of root
  skills: [],       // skills found in root
  skillsRoot: null, // the root folder the skills list came from
  viewRaw: null,    // {type:'code'|'image', path, content} for non-md files
  refd: null,       // Set of referenced file paths (skill analysis)
};

marked.setOptions({ gfm: true, breaks: false });
// ==highlight== support
marked.use({
  extensions: [{
    name: 'highlight', level: 'inline',
    start(src) { return src.indexOf('=='); },
    tokenizer(src) {
      const m = /^==([^=\n]+)==/.exec(src);
      if (m) return { type: 'highlight', raw: m[0], text: m[1] };
    },
    renderer(t) { return '<mark>' + t.text + '</mark>'; },
  }],
});

/* ---------------- parsing & serializing ---------------- */

function extractFrontmatter(md) {
  const txt = md.replace(/^﻿/, '');
  if (!txt.startsWith('---')) return { fm: null, body: md };
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: null, body: md };
  return { fm: m[1].replace(/\r\n/g, '\n'), body: txt.slice(m[0].length) };
}

function parseFmFields(fm) {
  const out = {};
  if (!fm) return out;
  for (const line of fm.split('\n')) {
    const m = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function parseSections(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let cur = { level: 0, title: null, body: [] };
  let inFence = false;

  for (const line of lines) {
    if (/^(```|~~~)/.test(line.trim())) inFence = !inFence;
    const m = !inFence && line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      if (cur.title !== null || cur.body.some(l => l.trim() !== '')) sections.push(cur);
      cur = { level: m[1].length, title: m[2].trim(), body: [] };
    } else {
      cur.body.push(line);
    }
  }
  sections.push(cur);
  return sections.map(s => ({ ...s, body: s.body.join('\n').replace(/^\n+|\n+$/g, '') }));
}

function serialize() {
  const fmBlock = state.frontmatter != null ? '---\n' + state.frontmatter + '\n---\n\n' : '';
  return fmBlock + state.sections.map(s => {
    const head = s.title !== null ? '#'.repeat(Math.max(1, s.level)) + ' ' + s.title : '';
    return [head, s.body].filter(x => x !== '').join('\n\n');
  }).join('\n\n') + '\n';
}

/* ---------------- rendering ---------------- */

const HCOLORS = ['var(--accent)', 'var(--h1)', 'var(--h2)', 'var(--h3)', 'var(--h4)', 'var(--h5)', 'var(--h6)'];

function render() {
  const wrap = $('#sections');
  wrap.innerHTML = '';
  const hasContent = state.path !== null || state.mode === 'root';
  $('#empty').classList.toggle('hidden', hasContent);
  $('#fileBar').classList.toggle('hidden', !hasContent);
  $('#fileName').textContent = state.root && state.path
    ? baseOf(state.root) + state.path.slice(state.root.length)
    : (state.path || state.root || '');
  $('#dirtyDot').classList.toggle('hidden', !state.dirty);
  $('#saveBtn').disabled = !state.dirty;

  renderSkillsSidebar();
  renderTreeSidebar();

  if (state.mode === 'root') {           // skills landing page
    renderSkillsLanding(wrap);
    renderOutline();
    return;
  }
  if (state.mode === 'skill' && state.tree.length) renderOverviewStrip(wrap);

  if (state.viewRaw) {                   // non-markdown file view
    if (state.viewRaw.type === 'image') {
      const d = document.createElement('div');
      d.className = 'img-view';
      d.innerHTML = `<img src="/api/raw?path=${encodeURIComponent(state.viewRaw.path)}" alt="${baseOf(state.viewRaw.path)}">`;
      wrap.appendChild(d);
    } else {
      const d = document.createElement('div');
      d.className = 'code-view';
      const pre = document.createElement('pre');
      pre.textContent = state.viewRaw.content;
      d.innerHTML = `<div class="cv-head">⚙ ${baseOf(state.viewRaw.path)}</div>`;
      d.appendChild(pre);
      wrap.appendChild(d);
    }
    renderOutline();
    return;
  }

  renderFrontmatter(wrap);

  state.sections.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'section-card';
    card.id = 'sec-' + i;
    card.style.setProperty('--hcolor', HCOLORS[s.level]);

    if (state.editing === i) {
      card.appendChild(buildEditor(s, i));
    } else {
      if (s.title !== null) {
        const head = document.createElement('div');
        head.className = 'section-head';
        head.innerHTML = `<span class="lvl-badge">H${s.level}</span>`;
        const h = document.createElement('h' + s.level);
        h.className = 'section-title';
        h.textContent = s.title;
        head.appendChild(h);
        head.appendChild(buildTools(i));
        card.appendChild(head);
      } else {
        const head = document.createElement('div');
        head.className = 'section-head';
        head.innerHTML = `<span class="lvl-badge" style="background:var(--muted)">TOP</span><span class="section-title" style="color:var(--muted);font-size:13px">preamble</span>`;
        head.appendChild(buildTools(i));
        card.appendChild(head);
      }
      const body = document.createElement('div');
      body.className = 'section-body';
      body.innerHTML = s.body ? marked.parse(s.body) : '<p style="color:var(--muted);font-style:italic">— empty section —</p>';
      card.appendChild(body);
    }
    wrap.appendChild(card);
  });

  // relative links open inside the viewer; relative images resolve to disk
  if (state.path) {
    const baseDir = dirOf(state.path);
    wrap.querySelectorAll('.section-body a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (/^[a-z]+:/i.test(href)) { a.target = '_blank'; return; }  // external
      if (href.startsWith('#')) return;                             // anchor
      a.onclick = e => { e.preventDefault(); openPath(resolveRel(baseDir, href)); };
    });
    wrap.querySelectorAll('.section-body img[src]').forEach(img => {
      const src = img.getAttribute('src');
      if (/^[a-z]+:/i.test(src) || src.startsWith('/')) return;
      img.src = '/api/raw?path=' + encodeURIComponent(resolveRel(baseDir, src));
    });
  }

  renderOutline();
}

function buildTools(i) {
  const t = document.createElement('div');
  t.className = 'section-tools';
  const btns = [
    ['✏️', 'Edit section', () => startEdit(i)],
    ['⛶', 'Edit in large popup', () => openEditorModal(i)],
    ['＋', 'Add section below', () => addSection(i + 1)],
    ['↑', 'Move up', () => moveSection(i, -1)],
    ['↓', 'Move down', () => moveSection(i, +1)],
    ['H−', 'Promote heading (H3→H2)', () => changeLevel(i, -1)],
    ['H＋', 'Demote heading (H2→H3)', () => changeLevel(i, +1)],
    ['⎘', 'Duplicate section', () => duplicateSection(i)],
    ['🗑', 'Delete section', () => deleteSection(i)],
  ];
  for (const [label, title, fn] of btns) {
    const b = document.createElement('button');
    b.textContent = label; b.title = title;
    b.onclick = fn;
    t.appendChild(b);
  }
  return t;
}

function renderOutline() {
  const ul = $('#outline');
  ul.innerHTML = '';
  const titled = state.sections.map((s, i) => ({ s, i })).filter(x => x.s.title !== null);
  if (!titled.length) {
    ul.innerHTML = '<li class="side-empty">no headings</li>';
    return;
  }
  for (const { s, i } of titled) {
    const li = document.createElement('li');
    li.style.paddingLeft = (8 + (s.level - 1) * 12) + 'px';
    li.innerHTML = `<span class="lvl">H${s.level}</span>`;
    li.appendChild(document.createTextNode(s.title));
    li.title = s.title;
    li.onclick = () => $('#sec-' + i)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    ul.appendChild(li);
  }
}

/* ---------------- section operations ---------------- */

function markDirty() { state.dirty = true; }

function startEdit(i) {
  state.editing = i;
  render();
  $('#sec-' + i)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function addSection(at, level = 2) {
  state.sections.splice(at, 0, { level, title: 'New section', body: '' });
  markDirty();
  startEdit(at);
}

function moveSection(i, d) {
  const j = i + d;
  if (j < 0 || j >= state.sections.length) return;
  [state.sections[i], state.sections[j]] = [state.sections[j], state.sections[i]];
  markDirty();
  render();
}

function changeLevel(i, d) {
  const s = state.sections[i];
  if (s.title === null) return toast('Preamble has no heading');
  s.level = Math.min(6, Math.max(1, s.level + d));
  markDirty();
  render();
}

function duplicateSection(i) {
  state.sections.splice(i + 1, 0, JSON.parse(JSON.stringify(state.sections[i])));
  markDirty();
  render();
}

function deleteSection(i) {
  const s = state.sections[i];
  if (!confirm(`Delete section "${s.title ?? 'preamble'}"?`)) return;
  state.sections.splice(i, 1);
  if (!state.sections.length) state.sections.push({ level: 0, title: null, body: '' });
  markDirty();
  render();
}

/* ---------------- editor ---------------- */

const MD_TOOLS = [
  ['B',      'Bold',            t => wrapSel(t, '**', '**', 'bold')],
  ['I',      'Italic',          t => wrapSel(t, '*', '*', 'italic')],
  ['S̶',     'Strikethrough',   t => wrapSel(t, '~~', '~~', 'gone')],
  ['`x`',    'Inline code',     t => wrapSel(t, '`', '`', 'code')],
  ['```',    'Code block',      t => insertBlock(t, '```\ncode here\n```')],
  ['🔗',     'Link',            t => wrapSel(t, '[', '](https://)', 'link text')],
  ['🖼',     'Image',           t => insertBlock(t, '![alt text](image.png)')],
  ['• list', 'Bullet list',     t => insertBlock(t, '- item 1\n- item 2\n- item 3')],
  ['1. list','Numbered list',   t => insertBlock(t, '1. first\n2. second\n3. third')],
  ['☑',      'Task list',       t => insertBlock(t, '- [ ] todo\n- [x] done')],
  ['❝',      'Blockquote',      t => insertBlock(t, '> quote text')],
  ['⊞',      'Table',           t => insertBlock(t, '| Col A | Col B |\n|-------|-------|\n| a1    | b1    |\n| a2    | b2    |')],
  ['―',      'Horizontal rule', t => insertBlock(t, '---')],
];

function wrapSel(ta, pre, post, placeholder) {
  const { selectionStart: a, selectionEnd: b, value: v } = ta;
  const sel = v.slice(a, b) || placeholder;
  ta.value = v.slice(0, a) + pre + sel + post + v.slice(b);
  ta.focus();
  ta.setSelectionRange(a + pre.length, a + pre.length + sel.length);
}

function insertBlock(ta, block) {
  const { selectionStart: a, value: v } = ta;
  const needsNL = a > 0 && v[a - 1] !== '\n' ? '\n\n' : '';
  ta.value = v.slice(0, a) + needsNL + block + '\n' + v.slice(a);
  ta.focus();
  const pos = a + needsNL.length + block.length + 1;
  ta.setSelectionRange(pos, pos);
}

function openEditorModal(i, draft) {
  state.editing = -1; // close any inline editor
  render();
  const s = state.sections[i];
  const src = draft ? Object.assign({}, s, draft) : s;
  const body = $('#editModalBody');
  body.innerHTML = '';
  body.appendChild(buildEditor(src, i, true));
  $('#editModalTitle').innerHTML = `<b>Edit section</b> — ${src.title ?? 'preamble'}`;
  $('#editModal').classList.remove('hidden');
  body.querySelector('textarea')?.focus();
}
function closeEditorModal() { $('#editModal').classList.add('hidden'); }

function buildEditor(s, i, inModal) {
  const wrap = document.createElement('div');
  wrap.className = 'edit-area';

  const head = document.createElement('div');
  head.className = 'edit-head';
  const lvlSel = document.createElement('select');
  if (s.title === null) {
    lvlSel.innerHTML = '<option value="0">TOP</option>';
    lvlSel.disabled = true;
  } else {
    lvlSel.innerHTML = [1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${n === s.level ? 'selected' : ''}>H${n}</option>`).join('');
  }
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.placeholder = s.title === null ? '(preamble — no heading)' : 'Section heading…';
  titleInput.value = s.title ?? '';
  titleInput.disabled = s.title === null;
  head.append(lvlSel, titleInput);
  wrap.appendChild(head);

  const toolbar = document.createElement('div');
  toolbar.className = 'md-toolbar';
  wrap.appendChild(toolbar);

  const ta = document.createElement('textarea');
  ta.value = s.body;
  ta.spellcheck = false;
  wrap.appendChild(ta);

  for (const [label, title, fn] of MD_TOOLS) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => fn(ta);
    const info = findTagInfo(title === 'Table' ? 'Table 2×2' : title);
    if (info) {
      b.addEventListener('mouseenter', () => showTagTip(b, title, info));
      b.addEventListener('mouseleave', hideTagTip);
    } else {
      b.title = title;
    }
    toolbar.appendChild(b);
  }
  const more = document.createElement('button');
  more.textContent = '🧰 more…';
  more.title = 'All markdown elements';
  more.onclick = () => { buildInsertPanel(); $('#insertModal').classList.remove('hidden'); };
  toolbar.appendChild(more);

  const actions = document.createElement('div');
  actions.className = 'edit-actions';
  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.onclick = () => {
    if (inModal) return closeEditorModal();
    state.editing = -1;
    render();
  };
  const save = document.createElement('button');
  save.textContent = '✓ Apply';
  save.className = 'primary';
  save.onclick = () => {
    const target = state.sections[i]; // in modal, s may be a draft copy
    if (target.title !== null) {
      target.title = titleInput.value.trim() || 'Untitled';
      target.level = parseInt(lvlSel.value, 10);
    }
    target.body = ta.value.replace(/^\n+|\n+$/g, '');
    state.editing = -1;
    if (inModal) closeEditorModal();
    markDirty();
    render();
  };
  if (!inModal) {
    const pop = document.createElement('button');
    pop.textContent = '⛶ Popup';
    pop.title = 'Continue editing in a large popup';
    pop.onclick = () => openEditorModal(i, {
      title: s.title !== null ? titleInput.value : null,
      level: parseInt(lvlSel.value, 10) || s.level,
      body: ta.value,
    });
    actions.append(pop);
  }
  actions.append(cancel, save);
  wrap.appendChild(actions);

  ta.addEventListener('keydown', e => {
    if (e.key === 'Escape') cancel.onclick();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save.onclick();
  });

  return wrap;
}

/* ---------------- file I/O ---------------- */

/* ---- remember & restore last location across refreshes ---- */
let restoring = false;

function persistLast() {
  try {
    localStorage.setItem('mdview-last', JSON.stringify({
      mode: state.mode, path: state.path, root: state.root, skillsRoot: state.skillsRoot,
    }));
  } catch {}
}

async function restoreLast() {
  let last = null;
  try { last = JSON.parse(localStorage.getItem('mdview-last')); } catch {}
  if (!last || (!last.path && !last.root && !last.skillsRoot)) return;
  restoring = true;
  try {
    if (last.mode === 'skill' && last.root) {
      if (last.skillsRoot) {
        const r = await fetch('/api/skills?dir=' + encodeURIComponent(last.skillsRoot));
        const d = await r.json();
        if (r.ok) { state.skills = d.skills; state.skillsRoot = last.skillsRoot; }
      }
      await loadSkill(last.root);
      if (last.path && !/skill\.md$/i.test(last.path)) await openFile(last.path, true);
    } else if (last.mode === 'root' && last.skillsRoot) {
      await openFolder(last.skillsRoot);
    } else if (last.mode === 'tree' && last.root) {
      await openFolder(last.root);
    } else if (last.path) {
      await openFile(last.path);
    }
  } catch {}
  restoring = false;
}

/* ---- path helpers (client-side, windows + url separators) ---- */
function dirOf(p) { return p.replace(/[\\/][^\\/]*$/, ''); }
function baseOf(p) { return p.split(/[\\/]/).pop(); }
function resolveRel(baseDir, rel) {
  rel = decodeURIComponent(rel).replace(/\//g, '\\').replace(/^\.\\/, '');
  const parts = baseDir.split('\\');
  for (const seg of rel.split('\\')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('\\');
}
const isMd = p => /\.(md|markdown|mdx|mdc|txt|cursorrules)$/i.test(p);
const isImg = p => /\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i.test(p);

async function openPath(p) {
  try {
    const r = await fetch('/api/stat?path=' + encodeURIComponent(p));
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    if (data.kind === 'dir') return openFolder(data.path);
    return openFile(data.path);
  } catch (e) { toast('⚠ ' + e.message); }
}

async function openFile(p, keepFolder) {
  if (state.dirty && !confirm('Unsaved changes will be lost. Open anyway?')) return;
  if (!keepFolder) { state.mode = 'file'; state.root = null; state.tree = []; state.skills = []; state.skillsRoot = null; state.refd = null; }
  state.viewRaw = null;

  if (!isMd(p) && state.root) {
    // non-markdown file inside a skill folder → code or image view
    state.path = p;
    state.sections = []; state.frontmatter = null; state.dirty = false; state.editing = -1;
    if (isImg(p)) {
      state.viewRaw = { type: 'image', path: p };
      render();
    } else {
      try {
        const r = await fetch('/api/raw?path=' + encodeURIComponent(p));
        state.viewRaw = { type: 'code', path: p, content: await r.text() };
      } catch { state.viewRaw = { type: 'code', path: p, content: '(could not read file)' }; }
      render();
    }
    persistLast();
    return;
  }

  try {
    const r = await fetch('/api/file?path=' + encodeURIComponent(p) + (restoring ? '&record=0' : ''));
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    state.path = data.path;
    const { fm, body } = extractFrontmatter(data.content);
    state.frontmatter = fm;
    state.sections = parseSections(body);
    state.dirty = false;
    state.editing = -1;
    $('#pathInput').value = state.root || data.path;
    render();
    loadPaths();
    persistLast();
    if (!restoring) toast('Opened ' + baseOf(data.path));
  } catch (e) {
    toast('⚠ ' + e.message);
  }
}

async function saveFile() {
  if (!state.path) return;
  if (state.editing !== -1) return toast('Apply or cancel the open editor first');
  if (!$('#editModal').classList.contains('hidden')) return toast('Apply or cancel the popup editor first');
  try {
    const r = await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.path, content: serialize() }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    state.dirty = false;
    render();
    loadPaths();
    toast('💾 Saved');
  } catch (e) {
    toast('⚠ ' + e.message);
  }
}

/* ---------------- folder & skill mode ---------------- */

async function openFolder(dir) {
  if (state.dirty && !confirm('Unsaved changes will be lost. Open anyway?')) return;
  try {
    const r = await fetch('/api/skills?dir=' + encodeURIComponent(dir));
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);

    if (!restoring) {
      fetch('/api/paths/touch', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dir, bump: true }) }).then(loadPaths);
    }

    if (data.self) {                                 // the folder IS a skill
      if (!state.skills.some(s => s.path === data.self.path)) { state.skills = []; state.skillsRoot = null; }
      return loadSkill(data.self.path);
    }
    state.root = dir;
    state.skills = data.skills;
    state.tree = []; state.refd = null;
    state.path = null; state.sections = []; state.frontmatter = null; state.viewRaw = null;
    state.dirty = false; state.editing = -1;
    $('#pathInput').value = dir;

    if (data.skills.length) {                        // skills root → landing list
      state.mode = 'root';
      state.skillsRoot = dir;
      render();
      persistLast();
      if (!restoring) toast(data.skills.length + ' skills found');
    } else {                                         // plain folder → tree browse
      state.mode = 'tree';
      const t = await (await fetch('/api/tree?dir=' + encodeURIComponent(dir))).json();
      state.tree = t.tree || [];
      render();
      persistLast();
      if (!restoring) toast('No SKILL.md here — showing file tree');
    }
  } catch (e) { toast('⚠ ' + e.message); }
}

async function loadSkill(dir) {
  state.mode = 'skill';
  state.root = dir;
  // keep state.skills — the sidebar list stays, with this skill expanded
  try {
    const t = await (await fetch('/api/tree?dir=' + encodeURIComponent(dir))).json();
    state.tree = t.tree || [];
  } catch { state.tree = []; }
  await analyzeSkill();
  await openFile(dir + '\\SKILL.md', true);
}

function flatFiles(nodes, out = []) {
  for (const n of nodes) {
    if (n.kind === 'file') out.push(n);
    else flatFiles(n.children, out);
  }
  return out;
}

/* which files does the skill's markdown actually reference? */
async function analyzeSkill() {
  state.refd = null;
  if (!state.root) return;
  const files = flatFiles(state.tree);
  const mdFiles = files.filter(f => isMd(f.name)).slice(0, 40);
  const refd = new Set();
  await Promise.all(mdFiles.map(async f => {
    try {
      const txt = await (await fetch('/api/raw?path=' + encodeURIComponent(f.path))).text();
      const re = /(?:\]\(|\]:\s*|href="|src=")([^)\s"#][^)\s"]*)/g;
      let m;
      while ((m = re.exec(txt))) {
        const t = m[1];
        if (/^[a-z]+:/i.test(t)) continue; // http:, mailto:, etc.
        refd.add(resolveRel(dirOf(f.path), t).toLowerCase());
      }
    } catch {}
  }));
  state.refd = refd;
}

function renderSkillsSidebar() {
  const block = $('#skillsBlock'), ul = $('#skillsList');
  const show = state.skills.length > 0 && (state.mode === 'root' || state.mode === 'skill');
  block.classList.toggle('hidden', !show);
  if (!show) return;
  ul.innerHTML = '';
  state.skills.forEach((sk, idx) => {
    const li = document.createElement('li');
    li.className = 'skill-entry';
    const isActive = state.mode === 'skill' && state.root === sk.path;
    const row = document.createElement('div');
    row.className = 'skill-row' + (isActive ? ' active' : '');
    row.innerHTML = `<span class="num">${idx + 1}</span><span class="badge">SKILL</span>`;
    row.appendChild(document.createTextNode(' ' + sk.name));
    row.title = (idx + 1) + '. ' + (sk.description || sk.name);
    // click: expand this skill; click again on the active one: collapse back to the list
    row.onclick = () => isActive && state.skillsRoot ? openFolder(state.skillsRoot) : loadSkill(sk.path);
    li.appendChild(row);
    if (isActive && state.tree.length) {
      const tw = document.createElement('div');
      tw.className = 'skill-tree';
      tw.appendChild(buildTreeUl(state.tree));
      li.appendChild(tw);
    }
    ul.appendChild(li);
  });
}

function renderTreeSidebar() {
  const block = $('#treeBlock');
  // separate Files block only when there is no skills list (skill opened directly, or plain folder)
  const show = (state.mode === 'skill' || state.mode === 'tree') && state.tree.length && !state.skills.length;
  block.classList.toggle('hidden', !show);
  if (!show) return;
  $('#treeTitle').textContent = '📁 ' + baseOf(state.root);
  const wrap = $('#fileTree');
  wrap.innerHTML = '';
  wrap.appendChild(buildTreeUl(state.tree));
}

function buildTreeUl(nodes) {
  const ul = document.createElement('ul');
  for (const n of nodes) {
    const li = document.createElement('li');
    const div = document.createElement('div');
    div.className = 'node';
    if (n.kind === 'dir') {
      div.innerHTML = '📁 ';
      div.appendChild(document.createTextNode(n.name));
      const childUl = buildTreeUl(n.children);
      div.onclick = () => childUl.classList.toggle('hidden');
      li.appendChild(div);
      li.appendChild(childUl);
    } else {
      const icon = /skill\.md$/i.test(n.name) ? '⭐' : isMd(n.name) ? '📄' : isImg(n.name) ? '🖼' : '⚙';
      div.innerHTML = icon + ' ';
      div.appendChild(document.createTextNode(n.name));
      if (state.path && n.path.toLowerCase() === state.path.toLowerCase()) div.classList.add('active');
      if (state.refd && !state.refd.has(n.path.toLowerCase()) && !/skill\.md$/i.test(n.name) && isMd(n.name))
        { div.classList.add('orphan'); div.title = 'Not referenced by any markdown file in this skill'; }
      const sz = document.createElement('span');
      sz.className = 'sz';
      sz.textContent = n.size > 1024 ? Math.round(n.size / 1024) + 'k' : n.size + 'b';
      div.appendChild(sz);
      div.onclick = () => openFile(n.path, true);
      li.appendChild(div);
    }
    ul.appendChild(li);
  }
  return ul;
}

function renderSkillsLanding(wrap) {
  const head = document.createElement('div');
  head.className = 'overview-strip';
  head.innerHTML = `<span class="chip">📁 ${state.root}</span><span class="chip">${state.skills.length} skills — click one to analyse</span>`;
  wrap.appendChild(head);
  const grid = document.createElement('div');
  grid.className = 'skill-grid';
  for (const sk of state.skills) {
    const card = document.createElement('div');
    card.className = 'skill-card';
    card.innerHTML = `<h3><span style="color:var(--muted);font-size:13px">${state.skills.indexOf(sk) + 1}.</span> ⭐ ${sk.name}</h3>` +
      `<div style="font-size:11px;color:var(--muted);font-family:Consolas,monospace;margin-bottom:6px;overflow-wrap:anywhere">${sk.folder}</div>` +
      `<p>${sk.description ? sk.description.replace(/</g, '&lt;') : '<i>no description</i>'}</p>`;
    card.onclick = () => loadSkill(sk.path);
    grid.appendChild(card);
  }
  wrap.appendChild(grid);
}

function renderOverviewStrip(wrap) {
  const files = flatFiles(state.tree);
  const totalKb = Math.round(files.reduce((a, f) => a + (f.size || 0), 0) / 1024);
  const orphans = state.refd
    ? files.filter(f => isMd(f.name) && !/skill\.md$/i.test(f.name) && !state.refd.has(f.path.toLowerCase())).length
    : 0;
  const strip = document.createElement('div');
  strip.className = 'overview-strip';
  strip.innerHTML =
    `<span class="chip">⭐ ${baseOf(state.root)}</span>` +
    `<span class="chip">${files.length} files · ${totalKb} KB</span>` +
    (orphans ? `<span class="chip">⚠ ${orphans} unreferenced .md file${orphans > 1 ? 's' : ''} (dimmed in tree)</span>` : '') +
    `<button id="backToRoot" title="Back to skills list">⬑ skills root</button>`;
  wrap.appendChild(strip);
  const btn = strip.querySelector('#backToRoot');
  btn.onclick = () => openFolder(state.skillsRoot || dirOf(state.root));
}

/* frontmatter properties card with validation */
const FM_HINTS = {
  name: 'skill identifier — kebab-case; the model matches requests against it',
  description: 'THE triggering contract — the model decides from this alone whether to load the skill (≤1024 chars)',
  globs: 'cursor rule: file patterns this rule auto-attaches to',
  alwaysApply: 'cursor rule: true = injected into every conversation',
  'allowed-tools': 'tools the skill may use without asking',
  license: 'license identifier for the skill',
};

function renderFrontmatter(wrap) {
  if (state.frontmatter == null) return;
  const fields = parseFmFields(state.frontmatter);
  const card = document.createElement('div');
  card.className = 'fm-card';
  const isSkill = /skill\.md$/i.test(state.path || '');
  const isRule = /\.(mdc|cursorrules)$/i.test(state.path || '');
  card.innerHTML = `<h4>${isSkill ? '⭐ Skill frontmatter' : isRule ? '📏 Rule frontmatter' : 'Front matter'}
    <button class="fm-edit" style="float:right;padding:2px 8px;font-size:11px">✏️ edit</button></h4>`;
  card.querySelector('.fm-edit').onclick = () => {
    const ta = document.createElement('textarea');
    ta.value = state.frontmatter || '';
    ta.style.cssText = 'width:100%;min-height:90px;font-family:Consolas,monospace;font-size:13px;margin-top:6px';
    ta.spellcheck = false;
    const apply = document.createElement('button');
    apply.textContent = '✓ Apply';
    apply.style.marginTop = '6px';
    apply.onclick = () => {
      state.frontmatter = ta.value.trim() || null;
      markDirty();
      render();
    };
    card.innerHTML = '<h4>Edit front matter (raw YAML)</h4>';
    card.append(ta, apply);
    ta.focus();
  };
  const grid = document.createElement('div');
  grid.className = 'fm-grid';
  for (const [k, v] of Object.entries(fields)) {
    const kd = document.createElement('div'); kd.className = 'k'; kd.textContent = k;
    const vd = document.createElement('div'); vd.className = 'v'; vd.textContent = v;
    if (FM_HINTS[k]) { const h = document.createElement('span'); h.className = 'fm-hint'; h.textContent = '— ' + FM_HINTS[k]; vd.appendChild(h); }
    grid.append(kd, vd);
  }
  if (!Object.keys(fields).length) grid.innerHTML = '<div class="v" style="grid-column:1/-1;color:var(--muted)">empty front matter</div>';
  card.appendChild(grid);

  if (isSkill) {
    const checks = document.createElement('div');
    checks.className = 'fm-checks';
    const add = (cls, txt) => { const c = document.createElement('span'); c.className = 'chk ' + cls; c.textContent = txt; checks.appendChild(c); };
    if (!fields.name) add('fail', '✗ name missing');
    else if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fields.name)) add('warn', '△ name not kebab-case');
    else add('ok', '✓ name');
    if (!fields.description) add('fail', '✗ description missing — skill will never trigger');
    else if (fields.description.length > 1024) add('fail', `✗ description ${fields.description.length}/1024 chars`);
    else add('ok', `✓ description (${fields.description.length}/1024)`);
    card.appendChild(checks);
  }
  wrap.appendChild(card);
}

/* ---------------- path memory ---------------- */

async function loadPaths() {
  const r = await fetch('/api/paths');
  const { recent, frequent } = await r.json();
  fillPathList($('#recentList'), recent);
  fillPathList($('#frequentList'), frequent);
}

function fillPathList(ul, items) {
  ul.innerHTML = '';
  if (!items.length) {
    ul.innerHTML = '<li class="side-empty">nothing yet</li>';
    return;
  }
  for (const it of items) {
    const li = document.createElement('li');
    li.title = it.path;
    const badge = it.kind === 'dir'
      ? (it.skill ? ['', 'SKILL'] : it.root ? ['root', 'ROOT'] : ['dir', 'DIR'])
      : it.rule ? ['rule', 'RULE'] : it.skill ? ['', 'SKILL'] : null;
    if (badge) {
      const b = document.createElement('span');
      b.className = ('badge ' + badge[0]).trim();
      b.textContent = badge[1];
      li.appendChild(b);
    }
    const name = document.createElement('span');
    name.className = 'fname';
    name.textContent = it.path.split(/[\\/]/).pop();
    li.appendChild(name);
    if (it.count) {
      const c = document.createElement('span');
      c.className = 'count';
      c.textContent = '×' + it.count;
      li.appendChild(c);
    }
    const x = document.createElement('button');
    x.className = 'forget';
    x.textContent = '✕';
    x.title = 'Forget this path';
    x.onclick = async e => {
      e.stopPropagation();
      await fetch('/api/paths/forget', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: it.path }),
      });
      loadPaths();
    };
    li.appendChild(x);
    li.onclick = () => openPath(it.path);
    ul.appendChild(li);
  }
}

/* ---------------- folder browser ---------------- */

async function browse(dir) {
  const r = await fetch('/api/browse' + (dir ? '?dir=' + encodeURIComponent(dir) : ''));
  const data = await r.json();
  if (!r.ok) return toast('⚠ ' + data.error);
  $('#browserDir').textContent = data.dir;
  const ul = $('#browserList');
  ul.innerHTML = '';
  if (data.parent) {
    const li = document.createElement('li');
    li.textContent = '⬑ ..';
    li.onclick = () => browse(data.parent);
    ul.appendChild(li);
  }
  for (const d of data.dirs) {
    const li = document.createElement('li');
    li.textContent = '📁 ' + d;
    li.onclick = () => browse(data.dir.replace(/[\\/]$/, '') + '\\' + d);
    ul.appendChild(li);
  }
  for (const f of data.files) {
    const li = document.createElement('li');
    li.textContent = '📄 ' + f;
    li.onclick = () => {
      $('#browserModal').classList.add('hidden');
      openFile(data.dir.replace(/[\\/]$/, '') + '\\' + f);
    };
    ul.appendChild(li);
  }
  $('#browserModal').classList.remove('hidden');
}

/* ---------------- insert panel (all MD tags) ---------------- */

const H_LEVEL_INFO = [
  ['The document title. One single # at the top.',
   'Once per file, at the very top. The name of the whole document.',
   'Defines what the entire file is about; everything else nests under it.',
   'Systems: page title, SEO title, filename for exports, root of the outline tree. Humans: "this is the subject of the document".'],
  ['A major section / chapter heading.',
   'For the big divisions of a document: Features, Installation, API, FAQ.',
   'The backbone of document structure; TOC generators build mainly from H2s.',
   'Systems: outline nodes, anchor links, navigation sidebars. Humans: "a new major topic starts here".'],
  ['A subsection inside an H2.',
   'To break a major section into parts: under "Installation" → "Windows", "Linux".',
   'Keeps long sections scannable without flattening the hierarchy.',
   'Systems: nested TOC level, parent-child relation to the H2 above. Humans: "a sub-topic of the current section".'],
  ['A sub-subsection (level 4).',
   'Deep detail inside an H3 — edge cases, variants, step groups.',
   'Useful in reference docs; in prose, needing H4 often means the doc should be split.',
   'Systems: deeper outline nesting; usually hidden in collapsed TOCs. Humans: fine-grained detail marker.'],
  ['A minor heading (level 5).',
   'Rare — very deep reference material or generated docs.',
   'Mostly visual: slightly bolder than text; signals "small labelled chunk".',
   'Systems: still an outline node, but most renderers style it barely larger than body text.'],
  ['The deepest heading (level 6).',
   'Almost never by hand — mostly tooling or auto-generated API docs.',
   'If you reach H6, restructure: split files or flatten levels.',
   'Systems: last outline level; renders smallest. Humans: often mistaken for bold text.'],
];

const INSERT_ITEMS = [
  { cat: 'Headings', items: [1, 2, 3, 4, 5, 6].map(n => (
    { name: 'Heading ' + n, pv: '#'.repeat(n) + ' Heading', kind: 'heading', level: n,
      info: { what: H_LEVEL_INFO[n-1][0], when: H_LEVEL_INFO[n-1][1], why: H_LEVEL_INFO[n-1][2], conveys: H_LEVEL_INFO[n-1][3] } }
  ))},
  { cat: 'Text styles', items: [
    { name: 'Bold', pv: '**text**', kind: 'wrap', pre: '**', post: '**', ph: 'bold',
      info: { what: 'Strong emphasis — renders as <strong>.',
        when: 'Key terms, warnings, the one thing a reader must not miss.',
        why: 'Readers scan a page by its bold words before reading anything.',
        conveys: 'Systems: <strong> — screen readers stress it, converters keep it. Humans: "this matters most in this sentence".' } },
    { name: 'Italic', pv: '*text*', kind: 'wrap', pre: '*', post: '*', ph: 'italic',
      info: { what: 'Mild emphasis — renders as <em>.',
        when: 'New terms on first use, titles of books/papers, gentle stress.',
        why: 'Adds nuance without the shouting effect of bold.',
        conveys: 'Systems: <em> — spoken with changed intonation by screen readers. Humans: "note the tone or term here".' } },
    { name: 'Bold + Italic', pv: '***text***', kind: 'wrap', pre: '***', post: '***', ph: 'both',
      info: { what: 'Strongest emphasis — <strong><em> combined.',
        when: 'Very rarely — a critical warning inside already-emphasised text.',
        why: 'Overuse makes it meaningless; one per document is plenty.',
        conveys: 'Systems: nested strong+em. Humans: "absolute maximum emphasis".' } },
    { name: 'Strikethrough', pv: '~~text~~', kind: 'wrap', pre: '~~', post: '~~', ph: 'gone',
      info: { what: 'Crossed-out text — renders as <del>.',
        when: 'Outdated info kept for history, corrected prices, completed plans.',
        why: 'Shows the change itself — deleting would hide that something changed.',
        conveys: 'Systems: <del> — semantically "removed content". Humans: "this was true, it no longer is".' } },
    { name: 'Highlight', pv: '==text==', kind: 'wrap', pre: '==', post: '==', ph: 'marked',
      info: { what: 'Marker-pen highlight — renders as <mark> (MDVIEW/Obsidian extension, not core MD).',
        when: 'Review notes, exam prep, pointing at the relevant words in a long quote.',
        why: 'Draws the eye without changing the sentence\'s voice like bold does.',
        conveys: 'Systems: <mark> — "relevant in the current context", e.g. search hits. Humans: "look exactly here".' } },
    { name: 'Inline code', pv: '`code`', kind: 'wrap', pre: '`', post: '`', ph: 'code',
      info: { what: 'Monospace literal text — renders as <code>.',
        when: 'Variable names, commands, file paths, API fields inside a sentence.',
        why: 'Separates literal computer text from prose; stops MD from formatting it.',
        conveys: 'Systems: <code> — "do not interpret, do not translate, copy exactly". Humans: "type/read this verbatim".' } },
    { name: 'Underline', pv: '<u>text</u>', kind: 'wrap', pre: '<u>', post: '</u>', ph: 'under',
      info: { what: 'Underlined text via inline HTML (MD has no native underline).',
        when: 'Almost never on the web — reserved cases like marking misspellings or legal names.',
        why: 'Readers assume underline = link; use bold/italic instead for emphasis.',
        conveys: 'Systems: <u> — "unarticulated annotation". Humans: usually "is this a link?" — hence use with care.' } },
    { name: 'Subscript', pv: 'H<sub>2</sub>O', kind: 'wrap', pre: '<sub>', post: '</sub>', ph: '2',
      info: { what: 'Lowered small text via <sub> HTML.',
        when: 'Chemical formulas (H₂O), math indexes (x₁), footnote-style marks.',
        why: 'Correct notation — "H2O" reads as wrong chemistry.',
        conveys: 'Systems: <sub> — typographic baseline shift, kept by exporters. Humans: scientific/mathematical notation.' } },
    { name: 'Superscript', pv: 'x<sup>2</sup>', kind: 'wrap', pre: '<sup>', post: '</sup>', ph: '2',
      info: { what: 'Raised small text via <sup> HTML.',
        when: 'Exponents (x²), ordinals (1st), trademark marks, footnote numbers.',
        why: 'Math and references read correctly only with proper raising.',
        conveys: 'Systems: <sup>. Humans: "power/ordinal/reference mark", not normal text.' } },
    { name: 'Keyboard key', pv: '<kbd>Ctrl</kbd>', kind: 'wrap', pre: '<kbd>', post: '</kbd>', ph: 'Ctrl',
      info: { what: 'A keyboard key rendered as a keycap — <kbd> HTML.',
        when: 'Shortcuts and key sequences in tutorials: <kbd>Ctrl</kbd>+<kbd>S</kbd>.',
        why: 'Visually separates "press this key" from surrounding prose.',
        conveys: 'Systems: <kbd> — semantically "user input". Humans: "physically press this".' } },
    { name: 'Line break', pv: 'line␣␣⏎', kind: 'block', snippet: 'line one  \nline two',
      info: { what: 'A hard line break inside one paragraph: two trailing spaces + newline.',
        when: 'Poems, addresses, song lyrics — lines that belong together but must wrap.',
        why: 'A single newline alone is ignored by MD; blank line starts a whole new paragraph.',
        conveys: 'Systems: <br> without closing the paragraph. Humans: "new line, same thought".' } },
    { name: 'Escaped char', pv: '\\*literal\\*', kind: 'wrap', pre: '\\*', post: '\\*', ph: 'not italic',
      info: { what: 'Backslash before a special char (\\* \\_ \\# \\`) shows it literally.',
        when: 'Writing about markdown itself, or text like *required that must not italicise.',
        why: 'Without it MD silently eats the char and reformats your sentence.',
        conveys: 'Systems: "render this char, do not parse it". Humans: see the actual symbol.' } },
  ]},
  { cat: 'Blocks', items: [
    { name: 'Blockquote', pv: '> quote', kind: 'block', snippet: '> quote text',
      info: { what: 'An indented quoted block — renders as <blockquote>.',
        when: 'Quoting a person, a document, an email — or setting apart an aside.',
        why: 'Visually and semantically separates borrowed words from your own.',
        conveys: 'Systems: <blockquote> — "content from another source". Humans: "someone else said this / side note".' } },
    { name: 'Nested quote', pv: '> outer >> inner', kind: 'block', snippet: '> outer quote\n>\n> > nested quote',
      info: { what: 'A quote inside a quote (stacked > markers).',
        when: 'Email-thread style replies, quoting someone who quoted someone.',
        why: 'Keeps attribution layers straight when conversations are replayed.',
        conveys: 'Systems: nested <blockquote> levels. Humans: depth = how many speakers back.' } },
    { name: 'Note callout', pv: '> **Note:** …', kind: 'block', snippet: '> **Note:** important information here.',
      info: { what: 'A quote styled as a Note/Warning/Tip box (convention; GitHub also supports > [!NOTE]).',
        when: 'Caveats, tips, prerequisites the reader should not skip.',
        why: 'Pulls critical info out of the text flow so it cannot be missed.',
        conveys: 'Systems: blockquote, some renderers show coloured admonition boxes. Humans: "stop and read this box".' } },
    { name: 'Code block', pv: '```lang … ```', kind: 'block', snippet: '```js\n// code here\n```',
      info: { what: 'A fenced multi-line code block with a language tag.',
        when: 'Any code, config, terminal output or log longer than one phrase.',
        why: 'Preserves whitespace exactly; the language tag enables syntax highlighting.',
        conveys: 'Systems: <pre><code class="language-js"> — highlighters and copy-buttons key off the tag. Humans: "literal code, copy as-is".' } },
    { name: 'Horizontal rule', pv: '---', kind: 'block', snippet: '---',
      info: { what: 'A horizontal divider line — renders as <hr>.',
        when: 'Between unrelated topics, before a footer, as a scene break.',
        why: 'Signals a thematic shift without forcing a new heading.',
        conveys: 'Systems: <hr> = "thematic break"; slide tools often split slides on it. Humans: "topic changes here".' } },
    { name: 'Collapsible', pv: '<details>…', kind: 'block', snippet: '<details>\n<summary>Click to expand</summary>\n\nhidden content here\n\n</details>',
      info: { what: 'A click-to-expand section via <details>/<summary> HTML.',
        when: 'Long logs, optional deep-dives, spoilers, big FAQ answers.',
        why: 'Keeps the page short while the detail stays one click away.',
        conveys: 'Systems: native expand/collapse, closed by default; works on GitHub. Humans: "optional detail, open if you care".' } },
    { name: 'HTML comment', pv: '<!-- note -->', kind: 'block', snippet: '<!-- invisible note -->',
      info: { what: 'A note that is never rendered — visible only in the raw file.',
        when: 'TODOs for authors, editorial notes, hiding a draft paragraph.',
        why: 'Lets authors talk to each other inside the file without readers seeing.',
        conveys: 'Systems: ignored by renderers, seen by diff tools. Humans (readers): nothing — that is the point.' } },
    { name: 'Front matter', pv: '--- yaml ---', kind: 'block', snippet: '---\ntitle: Document\ntags: [notes]\n---',
      info: { what: 'A YAML metadata block between --- fences at the very top of the file.',
        when: 'First lines of the file only — title, date, tags, author, draft status.',
        why: 'Machine-readable metadata without polluting the visible document.',
        conveys: 'Systems: Jekyll/Hugo/Obsidian read it for routing, tags, templates — never render it. Humans: file properties.' } },
  ]},
  { cat: 'Lists', items: [
    { name: 'Bullet list', pv: '- item', kind: 'block', snippet: '- item 1\n- item 2\n- item 3',
      info: { what: 'An unordered list — renders as <ul>.',
        when: 'Items with no sequence: features, ingredients, options.',
        why: 'Far more scannable than a comma-run sentence.',
        conveys: 'Systems: <ul><li> — screen readers announce item count. Humans: "set of parallel items, order irrelevant".' } },
    { name: 'Numbered list', pv: '1. item', kind: 'block', snippet: '1. first\n2. second\n3. third',
      info: { what: 'An ordered list — renders as <ol>.',
        when: 'Steps, rankings, anything where sequence matters.',
        why: 'Renderers renumber automatically — insert a step without renumbering by hand.',
        conveys: 'Systems: <ol> — "sequence is meaningful". Humans: "do these in this order".' } },
    { name: 'Task list', pv: '- [ ] todo', kind: 'block', snippet: '- [ ] todo\n- [x] done',
      info: { what: 'A checklist with checkboxes — GFM extension.',
        when: 'TODOs, release checklists, PR acceptance criteria.',
        why: 'State lives in the file; GitHub shows progress (3/5) and lets you tick boxes.',
        conveys: 'Systems: checkbox inputs, progress counts in issues/PRs. Humans: "work items, [x] = done".' } },
    { name: 'Nested list', pv: '- a ∙ - b', kind: 'block', snippet: '- parent\n  - child\n    - grandchild',
      info: { what: 'Lists inside lists — indentation (2+ spaces) creates levels.',
        when: 'Hierarchies: org structures, file trees, grouped options.',
        why: 'Shows parent-child relations that a flat list loses.',
        conveys: 'Systems: nested <ul>/<ol> trees. Humans: indent depth = belongs to the item above.' } },
    { name: 'Definition list', pv: '<dl>…', kind: 'block', snippet: '<dl>\n<dt>Term</dt>\n<dd>Definition of the term.</dd>\n</dl>',
      info: { what: 'Term + definition pairs via <dl>/<dt>/<dd> HTML (core MD has none).',
        when: 'Glossaries, API parameter docs, FAQ-style term explanations.',
        why: 'Semantically pairs each term with its meaning — stronger than a bullet with a dash.',
        conveys: 'Systems: <dl> — machine-readable term↔definition binding. Humans: dictionary-style layout.' } },
  ]},
  { cat: 'Links & media', items: [
    { name: 'Link', pv: '[text](url)', kind: 'wrap', pre: '[', post: '](https://)', ph: 'link text',
      info: { what: 'An inline hyperlink: [visible text](destination).',
        when: 'Pointing to docs, sources, related files — anywhere.',
        why: 'The text should say what the target is — "click here" wastes it.',
        conveys: 'Systems: <a href> — crawlers and SEO read the anchor text as the target\'s description. Humans: "more here".' } },
    { name: 'Link + title', pv: '[text](url "tip")', kind: 'wrap', pre: '[', post: '](https:// "hover tip")', ph: 'link text',
      info: { what: 'A link with an extra title shown as a hover tooltip.',
        when: 'When the anchor text alone needs a little extra context.',
        why: 'Adds context without lengthening the visible sentence.',
        conveys: 'Systems: title attribute on <a>. Humans: bonus hint on hover (invisible on touch devices — don\'t hide essentials there).' } },
    { name: 'Reference link', pv: '[text][1] … [1]:', kind: 'block', snippet: 'See [the docs][1] for details.\n\n[1]: https://example.com',
      info: { what: 'A link whose URL is defined elsewhere in the file by a label.',
        when: 'Long URLs used multiple times, or academic-style writing.',
        why: 'Keeps paragraphs readable in raw form; change the URL once, every use updates.',
        conveys: 'Systems: identical <a> output to inline links. Humans (raw file): clean prose with footnote-like refs.' } },
    { name: 'Autolink', pv: '<https://…>', kind: 'block', snippet: '<https://example.com>',
      info: { what: 'A bare URL in angle brackets that becomes clickable.',
        when: 'Quick notes where the URL itself is the information.',
        why: 'Fastest way to drop a working link; no anchor text to invent.',
        conveys: 'Systems: <a> with URL as text. Humans: "the address itself matters — copy or visit it".' } },
    { name: 'Section anchor', pv: '[↪](#heading)', kind: 'wrap', pre: '[', post: '](#section-name)', ph: 'jump to section',
      info: { what: 'A link to a heading inside the same document (#slug of the heading).',
        when: 'Tables of contents, "see the Installation section above".',
        why: 'Readers jump instead of scrolling; the doc becomes navigable.',
        conveys: 'Systems: fragment link — the slug is the lowercased, hyphenated heading. Humans: "jump within this page".' } },
    { name: 'Image', pv: '![alt](img)', kind: 'block', snippet: '![alt text](image.png)',
      info: { what: 'An embedded image: ![alt text](path-or-url).',
        when: 'Screenshots, diagrams, photos that support the text.',
        why: 'The alt text is not decoration — it IS the image when the image fails.',
        conveys: 'Systems: <img alt> — screen readers speak the alt, search indexes it. Humans: visual; alt appears if loading breaks.' } },
    { name: 'Linked image', pv: '[![alt](img)](url)', kind: 'block', snippet: '[![alt text](image.png)](https://example.com)',
      info: { what: 'An image that is also a clickable link (image nested in a link).',
        when: 'Thumbnails opening full size, banners linking to a site, video stills → video.',
        why: 'Combines preview and navigation in one element.',
        conveys: 'Systems: <a><img></a>. Humans: "click the picture to go somewhere".' } },
    { name: 'Badge', pv: 'shields.io', kind: 'block', snippet: '![status](https://img.shields.io/badge/status-active-success)',
      info: { what: 'A small status image (shields.io) — build, version, license, coverage.',
        when: 'Top of a README, right under the title.',
        why: 'Project health at a glance before anyone reads a word.',
        conveys: 'Systems: just an <img>, often auto-updated by CI. Humans: "is this project alive, tested, licensed?"' } },
  ]},
  { cat: 'Tables', items: [
    { name: 'Table 2×2', pv: '| a | b |', kind: 'block', snippet: '| Col A | Col B |\n|-------|-------|\n| a1    | b1    |\n| a2    | b2    |',
      info: { what: 'A pipe-and-dash table (GFM) — header row, separator, data rows.',
        when: 'Comparisons, specs, option matrices — short, enumerable facts.',
        why: 'Rows+columns show relations prose has to spell out clumsily.',
        conveys: 'Systems: <table> — parsers can extract it as structured data. Humans: "look up the cell where row meets column".' } },
    { name: 'Table aligned', pv: ':--- :---: ---:', kind: 'block', snippet: '| Left | Center | Right |\n|:-----|:------:|------:|\n| a    | b      | c     |',
      info: { what: 'A table with per-column alignment set by colons in the separator row.',
        when: ':--- left for text, ---: right for numbers, :---: center for labels.',
        why: 'Right-aligned numbers line up by place value — instantly comparable.',
        conveys: 'Systems: text-align per column. Humans: tidy columns = scannable data.' } },
  ]},
  { cat: 'Advanced', items: [
    { name: 'Footnote', pv: 'text[^1]', kind: 'block', snippet: 'A claim.[^1]\n\n[^1]: The footnote text.',
      info: { what: 'A numbered side note: [^1] in text, [^1]: definition elsewhere.',
        when: 'Citations, caveats, tangents that would derail the paragraph.',
        why: 'The main text stays clean; detail waits at the bottom for those who want it.',
        conveys: 'Systems: GitHub/Obsidian render linked notes at the end (MDVIEW shows raw syntax). Humans: "optional aside, see below".' } },
    { name: 'Emoji', pv: '✅ 🔥 ⭐', kind: 'block', snippet: '✅ done · ⚠️ warning · 🔥 hot · ⭐ star · 💡 idea',
      info: { what: 'Unicode emoji placed directly in the text.',
        when: 'Status markers (✅/❌), changelogs, informal docs.',
        why: 'A consistent emoji scheme is scannable faster than words — but overuse turns a doc into noise.',
        conveys: 'Systems: plain unicode — survives everywhere, screen readers speak the emoji name. Humans: instant status/tone cue.' } },
    { name: 'Math block', pv: '$$ … $$', kind: 'block', snippet: '$$\nE = mc^2\n$$',
      info: { what: 'A LaTeX math block between $$ fences ($…$ for inline).',
        when: 'Formulas, equations, scientific notation.',
        why: 'Real typeset math instead of ASCII approximations.',
        conveys: 'Systems: GitHub/Obsidian/Jupyter render via KaTeX/MathJax (MDVIEW shows raw LaTeX). Humans: publication-quality formulas.' } },
    { name: 'Mermaid diagram', pv: '```mermaid', kind: 'block', snippet: '```mermaid\nflowchart LR\n  A --> B --> C\n```',
      info: { what: 'A text-described diagram in a mermaid code fence.',
        when: 'Flowcharts, sequence diagrams, gantt charts, state machines.',
        why: 'Diagram-as-code: diffable, reviewable, no image files to keep in sync.',
        conveys: 'Systems: GitHub/Obsidian render the drawing (MDVIEW shows the code). Humans: process/structure as a picture.' } },
  ]},
];

/* ---------------- context-aware items: skills & cursor rules ---------------- */

function detectDocType() {
  if (!state.path) return 'md';
  if (/skill\.md$/i.test(state.path)) return 'skill';
  if (/\.(mdc|cursorrules)$/i.test(state.path)) return 'mdc';
  return 'md';
}

const SKILL_ITEMS = { cat: '⭐ Skill elements', items: [
  { name: 'Skill frontmatter', pv: '--- name, description ---', kind: 'fm',
    fm: 'name: my-skill\ndescription: Use this skill when the user wants to <trigger>. Covers <scope>.',
    info: { what: 'The YAML header every SKILL.md must have: name + description.',
      when: 'Very first thing in the file — a skill without it is invisible.',
      why: 'This is the ONLY part the model reads before deciding to load the skill.',
      conveys: 'Systems: skill registry entry. Humans: what this skill is for.' } },
  { name: 'description field', pv: 'description: Use when…', kind: 'fm', fm: 'description: Use this skill when the user asks to <trigger>.',
    info: { what: 'The triggering contract (≤1024 chars) in the frontmatter.',
      when: 'Always — write it as "Use this skill when…" with concrete trigger phrases.',
      why: 'Too vague → never triggers; too broad → triggers wrongly. The most important line of the whole skill.',
      conveys: 'Systems: matched against every user request. Humans: the skill\'s job description.' } },
  { name: 'allowed-tools field', pv: 'allowed-tools: Bash, Read', kind: 'fm', fm: 'allowed-tools: Read, Grep, Bash',
    info: { what: 'Frontmatter list of tools the skill may use without prompting.',
      when: 'When the skill\'s workflow needs specific tools pre-approved.',
      why: 'Reduces permission prompts mid-skill; scopes what the skill can touch.',
      conveys: 'Systems: permission pre-grant. Humans: the skill\'s blast radius.' } },
  { name: 'Trigger section', pv: '## When to use', kind: 'block',
    snippet: '## When to use this skill\n\n- When the user asks to <X>\n- When the task involves <Y>\n- NOT for <Z> — use <other-skill> instead',
    info: { what: 'A section spelling out when the skill applies (and when not).',
      when: 'Near the top of SKILL.md body.',
      why: 'The description triggers the load; this section stops wrong usage after load.',
      conveys: 'Systems: post-load guidance. Humans: scope boundaries.' } },
  { name: 'Instructions section', pv: '## Instructions', kind: 'block',
    snippet: '## Instructions\n\n1. First, <step>\n2. Then <step>\n3. Finally <step>',
    info: { what: 'Numbered step-by-step procedure for the model to follow.',
      when: 'The core of most skills — after the trigger section.',
      why: 'Models follow numbered steps far more faithfully than prose paragraphs.',
      conveys: 'Systems: an execution plan. Humans: the workflow.' } },
  { name: 'Reference link', pv: '[…](references/x.md)', kind: 'block',
    snippet: 'For details, read [the reference](references/details.md).',
    info: { what: 'A relative link to a file in references/ loaded on demand.',
      when: 'For material too long for SKILL.md — API docs, schemas, long examples.',
      why: 'Keeps SKILL.md small (fast to load every trigger); detail loads only when needed.',
      conveys: 'Systems: progressive disclosure — the model fetches it when relevant. Humans: "more detail here".' } },
  { name: 'Script reference', pv: 'scripts/run.py', kind: 'block',
    snippet: 'Run the helper script:\n\n```bash\npython scripts/helper.py <args>\n```',
    info: { what: 'Pointing the model at a bundled executable script.',
      when: 'For deterministic work better done by code than token-by-token generation.',
      why: 'Scripts are exact and cheap; model-generated code varies per run.',
      conveys: 'Systems: the model executes it instead of improvising. Humans: the skill\'s tooling.' } },
  { name: 'Examples section', pv: '## Examples', kind: 'block',
    snippet: '## Examples\n\n**User asks:** "<request>"\n**Do:** <action>\n\n**User asks:** "<other request>"\n**Do:** <other action>',
    info: { what: 'Concrete request→action pairs.',
      when: 'When trigger wording or output format needs disambiguation.',
      why: 'One example beats three paragraphs of description for steering model behavior.',
      conveys: 'Systems: few-shot patterns to imitate. Humans: what using the skill looks like.' } },
]};

const MDC_ITEMS = { cat: '📏 Rule elements (.mdc)', items: [
  { name: 'Rule frontmatter', pv: '--- description, globs ---', kind: 'fm',
    fm: 'description: <when this rule should apply>\nglobs: src/**/*.ts\nalwaysApply: false',
    info: { what: 'The .mdc header: description + globs + alwaysApply.',
      when: 'Top of every .mdc rule file.',
      why: 'These three fields decide WHEN the rule is injected into context.',
      conveys: 'Systems: attach conditions. Humans: the rule\'s scope.' } },
  { name: 'globs field', pv: 'globs: src/**/*.ts', kind: 'fm', fm: 'globs: **/*.py',
    info: { what: 'File patterns this rule auto-attaches to.',
      when: 'For rules tied to a language/folder: tests, API layer, styles.',
      why: 'Scoped rules keep context lean — the rule appears only where relevant.',
      conveys: 'Systems: pattern match against open/edited files. Humans: which part of the codebase this governs.' } },
  { name: 'alwaysApply field', pv: 'alwaysApply: true', kind: 'fm', fm: 'alwaysApply: true',
    info: { what: 'true = rule injected into every conversation regardless of files.',
      when: 'Project-wide conventions only: naming, commit style, core constraints.',
      why: 'Every always-on rule costs context in every chat — keep these few and short.',
      conveys: 'Systems: unconditional injection. Humans: "house rules".' } },
  { name: 'Guideline bullets', pv: '- Always… - Never…', kind: 'block',
    snippet: '- Always <do this>\n- Never <do that>\n- Prefer <X> over <Y>',
    info: { what: 'Short imperative rules as bullets.',
      when: 'The body of most rules — terse beats thorough here.',
      why: 'Rules compete for context; models follow short imperatives best.',
      conveys: 'Systems: direct behavioral constraints. Humans: the team\'s conventions.' } },
  { name: 'Good/bad example', pv: '✅ / ❌ code', kind: 'block',
    snippet: '```ts\n// ✅ Good\nconst user = await getUser(id);\n\n// ❌ Bad\nvar user = getUser(id).then(...)\n```',
    info: { what: 'A contrasting pair showing the wanted and unwanted pattern.',
      when: 'When the rule is about code style or API usage.',
      why: 'Models pattern-match examples more reliably than they parse prose rules.',
      conveys: 'Systems: imitate ✅, avoid ❌. Humans: instant clarity on intent.' } },
]};

/* How AI (LLMs, RAG pipelines, agents) treats each tag */
const AI_NOTES = {
  'Heading 1': 'AI treats the H1 as the document\'s identity — summaries, titles and topic classification anchor on it. RAG pipelines prepend it to every chunk\'s context.',
  'Heading 2': 'The most common chunk boundary: RAG splitters cut documents at H2s, so each H2 section should stand alone — an AI may see it without the rest of the file.',
  'Heading 3': 'Gives AI the hierarchy path (H1 > H2 > H3) used as breadcrumb context in retrieval; helps models answer "where in the doc is this?"',
  'Heading 4': 'Deep levels still guide AI outline parsing, but weakly — models may merge H4+ content into the parent section when summarising.',
  'Heading 5': 'Nearly invisible to AI chunkers; most treat H5 content as body text of the section above.',
  'Heading 6': 'Same as H5 — AI rarely preserves this depth; structure this deep is usually flattened in model understanding.',
  'Bold': 'Models weight **bold** phrases as salient — they surface disproportionately in AI summaries and extracted key points. Bolding the wrong words skews what AI thinks matters.',
  'Italic': 'Mild signal: AI reads *italics* as term introduction or titles, useful for glossary extraction, but far weaker salience than bold.',
  'Bold + Italic': 'Maximum emphasis signal — AI treats it like bold, slightly stronger; rare enough that models notice it.',
  'Strikethrough': 'Critical nuance: good models read ~~struck text~~ as negated/outdated and exclude it from answers — delete the markers and the AI believes it again.',
  'Highlight': '==Highlight== is non-standard, so many models just see the == characters; assume no special AI meaning outside Obsidian-aware tools.',
  'Inline code': 'A strong "literal token" signal: AI won\'t paraphrase, translate or "correct" `code spans` — vital for commands, IDs and API names in prompts and docs.',
  'Underline': 'The <u> tag carries no semantic weight for AI — models learn nothing from it; use bold if you want AI to notice.',
  'Subscript': 'AI reads the HTML tags and usually interprets the notation correctly (H2O chemistry), but sub/sup can be lost when text is extracted to plain text.',
  'Superscript': 'Same as subscript — understood in HTML form, fragile through plain-text extraction; write x^2 in math blocks when precision matters.',
  'Keyboard key': '<kbd> tells AI "user input" — assistants generating tutorials preserve and imitate it; extraction pipelines keep the key sequence intact.',
  'Line break': 'Invisible to most AI: two trailing spaces often get stripped by editors and tokenizers; models treat the lines as one flow either way.',
  'Escaped char': 'Prevents AI markdown renderers from mis-formatting output; models echo the literal char. Unescaped * in data can silently italicise half an AI\'s answer.',
  'Blockquote': 'AI reads > quotes as attributed/external voice — important for not confusing someone\'s quoted claim with the document\'s own claims in summarisation.',
  'Nested quote': 'Models track quote depth to reconstruct who-said-what in threads; flattening the nesting makes AI misattribute statements.',
  'Note callout': 'Callouts (> **Note:**, > [!WARNING]) get elevated attention — AI summaries almost always keep warnings and prerequisites from callouts.',
  'Code block': 'The strongest boundary in markdown for AI: fenced code is parsed as code (never prose), the language tag selects how the model reasons about it, and good models quote it verbatim rather than paraphrase.',
  'Horizontal rule': 'A weak topic-shift signal; some chunkers split on --- . In AI-generated slides/docs it often means "new slide/section".',
  'Collapsible': 'Caution: AI reads <details> content fully even though humans see it collapsed — hidden-from-humans is NOT hidden-from-AI. Never "hide" sensitive text this way.',
  'HTML comment': 'Humans never see comments, but AI processing the raw file reads them — which is why prompt-injection attacks hide instructions in <!-- comments -->. Treat comments in untrusted files with suspicion.',
  'Front matter': 'Structured gold for AI: YAML front matter is parsed as metadata (title, tags, date) and often drives retrieval filters; agents read it to route and classify files without reading the body.',
  'Bullet list': 'Lists are extraction-friendly: AI reliably turns bullets into arrays/JSON, and answers built from bulleted facts hallucinate less than ones from dense prose.',
  'Numbered list': 'AI preserves the ordering as procedure semantics — step 3 depends on step 2. Agents executing instructions follow numbered lists far more faithfully than paragraphs.',
  'Task list': 'Machine-readable state: AI agents parse - [ ] / - [x] as todo/done, can report progress, and plan next actions from the unchecked items.',
  'Nested list': 'Indentation becomes a tree in the model\'s reading — AI uses it to infer parent-child and part-of relations when building structured output.',
  'Definition list': '<dl> pairs are ideal for AI glossary/entity extraction: term↔definition binding is explicit, so models map them into key-value structures cleanly.',
  'Link': 'AI reads the anchor text as the description of the target and may follow links when browsing; descriptive anchors improve an agent\'s decision of which link to open.',
  'Link + title': 'The title attribute is extra context AI does read (humans on touch devices don\'t) — a small free hint to models.',
  'Reference link': 'Semantically identical to inline links for AI after parsing; the [1]-style labels also mimic citation format, which models recognise.',
  'Autolink': 'A bare URL tells AI the address itself is the payload; browsing agents treat it as a direct fetch target.',
  'Section anchor': 'Models use #anchors to navigate and cite within long docs ("see #installation"); RAG answers can deep-link users to the exact section.',
  'Image': 'The alt text is what a text-only AI "sees" of the image — write alt text as if describing the image to the model, because that is literally what happens.',
  'Linked image': 'AI reads it as alt text + destination URL; vision models additionally analyse the pixels, but the alt remains the retrieval key.',
  'Badge': 'AI parses the badge URL/label as project status signals (build passing, version) — agents scanning READMEs read badges as structured facts.',
  'Table 2×2': 'Tables are the most machine-readable prose structure: AI converts them to records/JSON almost losslessly, and answers questions by row-column lookup instead of guessing.',
  'Table aligned': 'Alignment colons are formatting-only for AI — ignored semantically, but a well-formed separator row is what makes a parser accept the table at all.',
  'Footnote': 'Models link [^1] marks to their definitions and treat them as supporting evidence/citations — footnoted claims read as sourced claims to AI.',
  'Emoji': 'Emoji are real tokens with learned meaning: ✅/❌ parse as pass/fail state, ⚠️ raises caution in AI summaries. Consistent emoji schemes become a status protocol AI follows.',
  'Math block': 'The $$ fence tells AI "this is LaTeX" — models parse and manipulate the formula symbolically instead of reading it as broken prose.',
  'Mermaid diagram': 'Diagram-as-code is fully legible to AI: models read, explain, and modify mermaid graphs, and can reason about the flow it encodes — unlike an image of the same diagram.',
  // skill elements
  'Skill frontmatter': 'At trigger time the model sees ONLY name + description — the body loads after. If the description doesn\'t sell the match, the rest of the skill never gets read.',
  'description field': 'This string is compared against every user request in every conversation. Concrete verbs and nouns ("merge PDF", "fill form") match; abstractions ("document operations") don\'t.',
  'allowed-tools field': 'The agent reads this as its permission envelope while the skill runs — tools listed here execute without asking the user each time.',
  'Trigger section': 'Read at load time (not trigger time) — the model uses it to self-check "should I actually be using this skill for this request?" and to hand off to a better skill.',
  'Instructions section': 'Agents execute numbered instructions as a plan, step by step, and report progress against them. Ambiguity in a step = improvisation at that step.',
  'Reference link': 'Progressive disclosure: the model loads SKILL.md cheaply every time, and fetches references/ only when the task needs that depth — keep hot content in SKILL.md, cold in references/.',
  'Script reference': 'The model prefers running a bundled script over writing fresh code when told so — deterministic, testable, and cheaper than generating the logic each time.',
  'Examples section': 'Few-shot anchors: the model imitates the request→action mapping shown, including output format and tone. Wrong examples teach wrong behavior permanently.',
  // rule elements
  'Rule frontmatter': 'Decides injection: description (agent-requested rules), globs (file-scoped auto-attach), alwaysApply (unconditional). The model never sees rules that don\'t attach.',
  'globs field': 'The editor attaches the rule when a matching file is in context — the model then treats it as binding for those files only.',
  'alwaysApply field': 'Injected into every conversation = permanent context tax. Models weight always-on rules heavily, so stale ones actively cause wrong behavior.',
  'Guideline bullets': 'Models treat imperative bullets ("Always X", "Never Y") as hard constraints and follow them more consistently than paragraph-style policy text.',
  'Good/bad example': 'The ✅/❌ pair becomes a pattern template — the model reproduces the good shape and flags/avoids the bad one in review and generation.',
};

/* rich hover tooltip */
const tagTip = document.createElement('div');
tagTip.id = 'tagTip';
tagTip.style.display = 'none';
document.body.appendChild(tagTip);

function showTagTip(el, name, info) {
  if (!info) return;
  tagTip.innerHTML =
    `<h5>${name}</h5>` +
    `<div class="row"><span class="lbl">What it is</span>${info.what}</div>` +
    `<div class="row"><span class="lbl">When &amp; where</span>${info.when}</div>` +
    `<div class="row"><span class="lbl">Why it matters</span>${info.why}</div>` +
    `<div class="row"><span class="lbl">What humans &amp; systems read</span>${info.conveys}</div>` +
    (AI_NOTES[name] ? `<div class="row ai"><span class="lbl">🤖 How AI reads it</span>${AI_NOTES[name]}</div>` : '');
  tagTip.style.display = 'block';
  const r = el.getBoundingClientRect();
  const tw = tagTip.offsetWidth, th = tagTip.offsetHeight;
  let x = r.right + 10;
  if (x + tw > window.innerWidth - 8) x = r.left - tw - 10;
  if (x < 8) x = Math.min(r.left, window.innerWidth - tw - 8);
  let y = r.top;
  if (y + th > window.innerHeight - 8) y = window.innerHeight - th - 8;
  if (y < 8) y = 8;
  tagTip.style.left = x + 'px';
  tagTip.style.top = y + 'px';
}
function hideTagTip() { tagTip.style.display = 'none'; }

function findTagInfo(name) {
  for (const g of INSERT_ITEMS)
    for (const it of g.items)
      if (it.name === name) return it.info;
  return null;
}

function buildInsertPanel() {
  const panel = $('#insertPanel');
  panel.innerHTML = '';
  const doc = detectDocType();
  const groups = doc === 'skill' ? [SKILL_ITEMS, ...INSERT_ITEMS]
               : doc === 'mdc'   ? [MDC_ITEMS, ...INSERT_ITEMS]
               : INSERT_ITEMS;
  for (const group of groups) {
    const div = document.createElement('div');
    div.className = 'insert-cat';
    div.innerHTML = `<h4>${group.cat}</h4>`;
    const grid = document.createElement('div');
    grid.className = 'insert-grid';
    for (const it of group.items) {
      const card = document.createElement('div');
      card.className = 'insert-item';
      card.innerHTML = `<div class="nm">${it.name}</div><div class="pv">${it.pv.replace(/</g, '&lt;')}</div>`;
      card.onclick = () => { hideTagTip(); insertItem(it); };
      card.addEventListener('mouseenter', () => showTagTip(card, it.name, it.info));
      card.addEventListener('mouseleave', hideTagTip);
      grid.appendChild(card);
    }
    div.appendChild(grid);
    panel.appendChild(div);
  }
}

function insertItem(it) {
  $('#insertModal').classList.add('hidden');

  if (it.kind === 'fm') {
    // frontmatter field(s): merge into the file's front matter, skip keys that already exist
    if (!state.path) return toast('Open a file first');
    const existing = parseFmFields(state.frontmatter);
    const add = it.fm.split('\n').filter(l => {
      const k = l.split(':')[0].trim();
      return !(k in existing);
    });
    if (!add.length) return toast('Those frontmatter fields already exist');
    state.frontmatter = state.frontmatter ? state.frontmatter.replace(/\n+$/, '') + '\n' + add.join('\n') : add.join('\n');
    markDirty();
    render();
    toast('Added to front matter — review the values');
    return;
  }

  const ta = document.querySelector('.edit-area textarea');

  if (ta) {
    // insert into the open editor at cursor
    if (it.kind === 'wrap') wrapSel(ta, it.pre, it.post, it.ph);
    else if (it.kind === 'heading') insertBlock(ta, '#'.repeat(it.level) + ' Heading text');
    else insertBlock(ta, it.snippet);
    return;
  }

  if (!state.path) return toast('Open a file first');

  // no editor open → create a new section holding this element
  if (it.kind === 'heading') {
    addSection(state.sections.length, it.level);
    return;
  }
  const body = it.kind === 'wrap' ? it.pre + it.ph + it.post : it.snippet;
  state.sections.push({ level: 2, title: it.name, body });
  markDirty();
  startEdit(state.sections.length - 1);
}

$('#editModalClose').onclick = closeEditorModal;
$('#insertBtn').onclick = () => { buildInsertPanel(); $('#insertModal').classList.remove('hidden'); };
$('#insertClose').onclick = () => $('#insertModal').classList.add('hidden');
$('#insertModal').addEventListener('click', e => { if (e.target.id === 'insertModal') $('#insertModal').classList.add('hidden'); });
buildInsertPanel();

/* ---------------- file type info popup ---------------- */

const FILE_INFO = {
  skill: {
    title: '⭐ SKILL.md — an Agent Skill',
    sub: 'A packaged capability for an AI agent (Claude Code and compatible tools)',
    definition: 'A SKILL.md file is the heart of a skill: a folder of instructions, references and scripts that teaches an AI agent how to perform a specific kind of task. The agent discovers it by its frontmatter, loads the body when triggered, and follows it as its working procedure.',
    uses: [
      'Teach the agent a repeatable workflow (deploys, reviews, document formats)',
      'Package team conventions so every session behaves the same way',
      'Bundle helper scripts the agent runs instead of improvising code',
      'Share expertise — a skill folder is portable and versionable in git',
    ],
    parts: [
      { name: 'frontmatter: name', imp: 'high', desc: 'The skill\'s identifier (kebab-case). How the skill is addressed and invoked (/name).',
        ai: 'Sits in the model\'s skill index of EVERY conversation — the model matches "/name" invocations and weighs the name itself when choosing between skills.' },
      { name: 'frontmatter: description', imp: 'high', desc: 'THE triggering contract (≤1024 chars). The model reads ONLY this to decide whether to load the skill — if it doesn\'t match the user\'s request wording, the skill never fires. Write it as "Use this skill when…" with concrete triggers.',
        ai: 'At trigger time this is ALL the AI sees — it compares the user\'s request against this text. Concrete verbs/nouns ("merge PDFs", "fill form") match; vague abstractions never do.' },
      { name: 'Body instructions', imp: 'high', desc: 'The procedure the agent follows once triggered — numbered steps work best. This is what actually shapes the agent\'s behavior.',
        ai: 'Loaded into context after trigger and treated as the agent\'s operating procedure — it executes numbered steps as a plan and reports progress against them. Ambiguity here = improvisation.' },
      { name: 'When to use / scope section', imp: 'med', desc: 'Stops wrong usage after loading: what this skill is NOT for, and which skill to use instead.',
        ai: 'The model self-checks against it after loading ("should I really use this here?") and uses the NOT-for lines to hand off to a better skill instead of forcing a bad fit.' },
      { name: 'references/ folder', imp: 'med', desc: 'Progressive disclosure: long material (API docs, schemas) the agent loads only when needed. Keeps SKILL.md small and cheap to load on every trigger.',
        ai: 'The AI reads these lazily — only when a step says to or the task demands depth. Content here costs zero context until fetched, so cold detail belongs here, hot rules in SKILL.md.' },
      { name: 'scripts/ folder', imp: 'med', desc: 'Deterministic helpers the agent executes instead of generating code each time — exact, testable, repeatable.',
        ai: 'The agent runs these instead of writing fresh code when SKILL.md says so — same result every run, no token cost for logic, no generation variance.' },
      { name: 'Examples section', imp: 'med', desc: 'Request→action pairs the model imitates. One good example beats paragraphs of description.',
        ai: 'Acts as few-shot conditioning: the model copies the shown request→action mapping, including format and tone. A wrong example teaches wrong behavior more strongly than prose can correct.' },
      { name: 'assets/, templates', imp: 'norm', desc: 'Static files the skill uses: templates, images, config samples.',
        ai: 'The agent copies or fills these verbatim — it treats them as ground truth artifacts, not as text to rewrite.' },
      { name: 'frontmatter: allowed-tools, license', imp: 'norm', desc: 'Optional: pre-approved tools (fewer permission prompts) and licensing info.',
        ai: 'allowed-tools defines the agent\'s permission envelope while the skill runs — listed tools execute without asking the user each time.' },
    ],
  },
  mdc: {
    title: '📏 .mdc — a Cursor Rule',
    sub: 'Persistent instructions injected into the AI\'s context in Cursor',
    definition: 'An .mdc file is a rule: standing instructions that get attached to AI conversations automatically. Its frontmatter decides WHEN it attaches (by file patterns, always, or on demand); its body tells the model HOW to behave while it is attached.',
    uses: [
      'Enforce coding conventions (naming, patterns, libraries) per language or folder',
      'Keep project context the AI should always know (architecture, constraints)',
      'Encode review standards the AI applies to generated code',
      'Scope different behavior to different parts of a codebase via globs',
    ],
    parts: [
      { name: 'frontmatter: description', imp: 'high', desc: 'What the rule covers — used when the agent decides to fetch a rule on demand. Vague description = rule never picked.',
        ai: 'For agent-requested rules, the AI scans descriptions to decide which rule to pull in — this line competes against every other rule\'s description.' },
      { name: 'frontmatter: globs', imp: 'high', desc: 'File patterns (src/**/*.ts) that auto-attach the rule when matching files are in play. This is the scoping mechanism — the model never sees rules that don\'t attach.',
        ai: 'Controls what the AI knows per file: while editing a matching file the rule is binding context; on any other file the AI has no idea the rule exists.' },
      { name: 'Guideline body', imp: 'high', desc: 'The rules themselves. Short imperative bullets ("Always X", "Never Y") are followed far more consistently than prose policy.',
        ai: 'Injected as standing instructions — the model treats "Always/Never" bullets as hard constraints on every generation and review while attached.' },
      { name: 'frontmatter: alwaysApply', imp: 'med', desc: 'true = injected into EVERY conversation — a permanent context tax. Keep always-on rules few, short, and current; a stale one actively causes wrong behavior.',
        ai: 'The AI carries this rule in every single chat and weights it heavily — an outdated always-on rule actively steers the model wrong everywhere at once.' },
      { name: '✅/❌ examples', imp: 'med', desc: 'Good/bad code pairs. The model pattern-matches these more reliably than it parses abstract rules.',
        ai: 'The model internalises the ✅ shape as the template to reproduce and the ❌ shape as a pattern to avoid and flag — stronger steering than the prose around them.' },
      { name: 'Referenced files (@file)', imp: 'norm', desc: 'Files pulled in as extra context when the rule attaches.',
        ai: 'Fetched into context alongside the rule — the AI reads them as supporting ground truth (schemas, configs) for the rule\'s instructions.' },
    ],
  },
  md: {
    title: '📄 .md — a Markdown document',
    sub: 'Plain-text writing with lightweight, machine-readable formatting',
    definition: 'Markdown is a plain-text format where simple punctuation (#, *, -, `) encodes structure. It stays readable as raw text, renders as rich HTML, diffs cleanly in git, and has become the native document format of developers, wikis, READMEs — and AI systems.',
    uses: [
      'READMEs, documentation, wikis, notes, blogs',
      'The lingua franca of AI: prompts, agent instructions, RAG knowledge bases',
      'Version-controlled writing — text diffs show exactly what changed',
      'Single source that exports to HTML, PDF, DOCX, slides',
    ],
    parts: [
      { name: 'Headings (#…######)', imp: 'high', desc: 'The document\'s skeleton: outline, navigation, anchors — and where RAG pipelines chunk the file. Bad heading structure = AI sees the document in wrong pieces.',
        ai: 'RAG splitters cut at headings and retrieval carries the heading path as context — a well-headed doc gets found and quoted correctly; a flat one gets retrieved in confusing fragments.' },
      { name: 'Paragraphs & emphasis', imp: 'high', desc: 'The content itself; bold marks what readers and models treat as salient.',
        ai: 'Models over-sample bold phrases into summaries and key points — bolding the wrong words literally skews what AI believes the document says.' },
      { name: 'Code blocks & inline code', imp: 'med', desc: 'Literal text, never reformatted — commands, code, config. The language tag drives syntax highlighting and how AI interprets it.',
        ai: 'The strongest parse boundary for AI: fenced content is quoted verbatim, never paraphrased or "corrected", and the language tag selects how the model reasons about it.' },
      { name: 'Lists (bullet, numbered, task)', imp: 'med', desc: 'Scannable structure; numbered lists read as procedures, task lists carry machine-readable state.',
        ai: 'AI extracts bullets into arrays almost losslessly, follows numbered lists as step-by-step plans, and reads - [x] as completed state it can report and act on.' },
      { name: 'Links & images', imp: 'med', desc: 'Connections to other docs and media; anchor text and alt text are what search engines and AI actually read.',
        ai: 'Browsing agents decide which link to follow from the anchor text alone, and a text-only model\'s entire "view" of an image is its alt text.' },
      { name: 'Tables', imp: 'med', desc: 'Structured facts — the most machine-extractable prose element.',
        ai: 'AI converts tables to records/JSON nearly losslessly and answers by row-column lookup instead of guessing from prose — put comparable facts here, not in sentences.' },
      { name: 'Front matter (--- YAML ---)', imp: 'norm', desc: 'Optional metadata header (title, tags, date) read by site generators and note tools, hidden from rendered view.',
        ai: 'Parsed as structured metadata: retrieval systems filter by its tags/dates, and agents route or classify the file from it without reading the body.' },
      { name: 'Quotes, rules, footnotes', imp: 'norm', desc: 'Attribution, topic breaks, side notes — texture rather than backbone.',
        ai: 'Quotes tell the model "someone else\'s claim, not the document\'s own" — crucial for faithful summarisation; footnote marks read as citations backing a claim.' },
    ],
  },
  script: {
    title: '⚙ Script / code file',
    sub: 'An executable helper inside this folder',
    definition: 'A code file (Python, shell, JS…) bundled with the content — in a skill, these are the deterministic tools the agent runs instead of writing fresh code each time.',
    uses: [
      'Deterministic operations: convert, validate, generate, deploy',
      'Work that must be exact and repeatable across runs',
      'Heavy lifting that would be slow or unreliable token-by-token',
    ],
    parts: [
      { name: 'Entry point / main logic', imp: 'high', desc: 'What the script actually does — the agent (and you) should be able to tell from a quick read.',
        ai: 'Before running, the agent skims this to predict what the script will do — readable logic means the AI uses it correctly; opaque logic means it may avoid or misuse it.' },
      { name: 'Arguments / interface', imp: 'high', desc: 'How it\'s invoked: flags, inputs, outputs. In a skill, SKILL.md should show the exact command.',
        ai: 'The agent constructs the actual command line from this — a documented, stable interface is what lets AI invoke the script without trial-and-error.' },
      { name: 'Imports / dependencies', imp: 'med', desc: 'What must be installed for it to run — undocumented deps are the #1 reason bundled scripts fail.',
        ai: 'On failure the agent reads import errors to self-install or work around deps — declaring them up front saves the AI whole recovery loops.' },
      { name: 'Error handling & messages', imp: 'med', desc: 'Clear failures let the agent recover; silent failures make it guess.',
        ai: 'Agents branch on stderr/exit codes: a specific error message routes the AI straight to the fix; a silent failure sends it debugging in the wrong place.' },
      { name: 'Comments & docstrings', imp: 'norm', desc: 'Context for maintainers; the agent reads these too.',
        ai: 'Read as authoritative intent — the AI trusts a docstring\'s claim about behavior, so a stale comment actively misleads it.' },
    ],
  },
  image: {
    title: '🖼 Image file',
    sub: 'A visual asset in this folder',
    definition: 'An image used by the document or skill — screenshot, diagram, template asset. In markdown it travels with alt text; for AI pipelines the alt text (or a vision model) is how its content becomes readable.',
    uses: [
      'Screenshots and diagrams supporting the docs',
      'Assets a skill inserts into its outputs (logos, templates)',
    ],
    parts: [
      { name: 'The alt text where it\'s embedded', imp: 'high', desc: 'What text-only systems, screen readers and search see. Describe the content, not "image.png".',
        ai: 'For a text-only model the alt text IS the image — write it as if describing the picture to the AI, because that is literally what it receives.' },
      { name: 'Resolution & size', imp: 'med', desc: 'Oversized images bloat repos and slow pages; right-size before committing.',
        ai: 'Vision models downscale large images before reading — tiny text in a huge screenshot becomes unreadable to AI even though humans can zoom.' },
      { name: 'Format choice', imp: 'norm', desc: 'PNG for UI/diagrams, JPG for photos, SVG for scalable line art.',
        ai: 'SVG is text — AI can read and edit its code directly; PNG/JPG need a vision model to be understood at all.' },
    ],
  },
};

/* AI-importance of each part: g = important to AI (dark green ★),
   n = can be helpful (grey ★), r = not important to AI at all (red ★) */
const AI_IMP = {
  'frontmatter: name': 'g', 'frontmatter: description': 'g', 'Body instructions': 'g',
  'references/ folder': 'g', 'Examples section': 'g',
  'When to use / scope section': 'n', 'scripts/ folder': 'n', 'frontmatter: allowed-tools, license': 'n',
  'assets/, templates': 'r',
  'frontmatter: globs': 'g', 'Guideline body': 'g', 'frontmatter: alwaysApply': 'g', '✅/❌ examples': 'g',
  'Referenced files (@file)': 'n',
  'Headings (#…######)': 'g', 'Paragraphs & emphasis': 'g', 'Code blocks & inline code': 'g', 'Tables': 'g',
  'Lists (bullet, numbered, task)': 'n', 'Links & images': 'n', 'Front matter (--- YAML ---)': 'n',
  'Quotes, rules, footnotes': 'n',
  'Entry point / main logic': 'g', 'Arguments / interface': 'g',
  'Imports / dependencies': 'n', 'Error handling & messages': 'n', 'Comments & docstrings': 'n',
  'The alt text where it\'s embedded': 'g', 'Resolution & size': 'n', 'Format choice': 'r',
};

function fileInfoType() {
  if (state.viewRaw) return state.viewRaw.type === 'image' ? 'image' : 'script';
  if (!state.path) return null;
  if (/skill\.md$/i.test(state.path)) return 'skill';
  if (/\.(mdc|cursorrules)$/i.test(state.path)) return 'mdc';
  return 'md';
}

let infoFilter = null; // {kind:'imp'|'ai', val} — active legend filter

function partHtml(p) {
  const impTag = { high: 'highly important', med: 'important', norm: '' };
  return `<div class="part ${p.imp === 'norm' ? '' : p.imp}">` +
    `<span class="pname">${p.name}</span>` +
    (impTag[p.imp] ? `<span class="ptag">${impTag[p.imp]}</span>` : '') +
    `<div class="pdesc">${p.desc}</div>` +
    (p.ai ? `<div class="pai"><span class="star ${AI_IMP[p.name] || 'n'}" title="${
      AI_IMP[p.name] === 'g' ? 'important to AI' : AI_IMP[p.name] === 'r' ? 'not important to AI' : 'can be helpful to AI'
    }">★</span> 🤖 ${p.ai}</div>` : '') +
    `</div>`;
}

function renderInfoParts(inf) {
  const holder = $('#infoParts');
  const f = infoFilter;
  let parts = inf.parts;
  if (f) {
    const match = p => f.kind === 'imp' ? p.imp === f.val : (AI_IMP[p.name] || 'n') === f.val;
    // matching group first, rest dimmed below — same types sit together
    parts = [...inf.parts.filter(match), ...inf.parts.filter(p => !match(p))];
    holder.innerHTML = parts.map(p =>
      (f.kind === 'imp' ? p.imp === f.val : (AI_IMP[p.name] || 'n') === f.val)
        ? partHtml(p)
        : `<div class="part-dim">${partHtml(p)}</div>`
    ).join('');
  } else {
    holder.innerHTML = parts.map(partHtml).join('');
  }
  // legend active states
  document.querySelectorAll('#infoModal .info-legend [data-f]').forEach(el => {
    const [kind, val] = el.dataset.f.split(':');
    el.classList.toggle('active', !!f && f.kind === kind && f.val === val);
  });
}

function openInfoModal() {
  const type = fileInfoType();
  const inf = FILE_INFO[type];
  if (!inf) return toast('Open a file first');
  infoFilter = null;
  const body = $('#infoModalBody');
  $('#infoModalTitle').innerHTML = `<b>${baseOf(state.path || '')}</b>`;
  body.innerHTML =
    `<h2>${inf.title}</h2><div class="sub">${inf.sub}</div>` +
    `<h3>What it is</h3><p>${inf.definition}</p>` +
    `<h3>What it's used for</h3><ul class="uses">${inf.uses.map(u => `<li>${u}</li>`).join('')}</ul>` +
    `<h3>Parts of the file <span class="legend-hint">— click a label below to group that type together</span></h3>` +
    `<div class="info-legend">` +
      `<span class="part high clickable" data-f="imp:high">highly important</span>` +
      `<span class="part med clickable" data-f="imp:med">important</span>` +
      `<span class="part clickable" data-f="imp:norm">supporting</span>` +
    `</div>` +
    `<div class="info-legend">` +
      `<span class="clickable" data-f="ai:g"><span class="star g">★</span> important to AI</span>` +
      `<span class="clickable" data-f="ai:n"><span class="star n">★</span> can be helpful to AI</span>` +
      `<span class="clickable" data-f="ai:r"><span class="star r">★</span> not important to AI</span>` +
    `</div>` +
    `<div id="infoParts"></div>`;
  body.querySelectorAll('[data-f]').forEach(el => {
    el.onclick = () => {
      const [kind, val] = el.dataset.f.split(':');
      infoFilter = (infoFilter && infoFilter.kind === kind && infoFilter.val === val) ? null : { kind, val };
      renderInfoParts(inf);
    };
  });
  renderInfoParts(inf);
  $('#infoModal').classList.remove('hidden');
}

$('#infoBtn').onclick = openInfoModal;
$('#infoModalClose').onclick = () => $('#infoModal').classList.add('hidden');
$('#infoModal').addEventListener('click', e => { if (e.target.id === 'infoModal') $('#infoModal').classList.add('hidden'); });

/* ---------------- toast & wiring ---------------- */

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

$('#openBtn').onclick = () => { const p = $('#pathInput').value.trim(); if (p) openPath(p); };
$('#folderBtn').onclick = async () => {
  try {
    toast('Opening folder dialog…');
    const r = await fetch('/api/pick-dir');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    if (data.path) openFolder(data.path);
  } catch (e) { toast('⚠ ' + e.message); }
};
$('#pathInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#openBtn').onclick(); });
$('#browseBtn').onclick = async () => {
  const dir = state.path ? state.path.replace(/[\\/][^\\/]+$/, '') : null;
  try {
    toast('Opening file dialog…');
    const r = await fetch('/api/pick' + (dir ? '?dir=' + encodeURIComponent(dir) : ''));
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    if (data.path) openFile(data.path);
  } catch {
    browse(dir); // fallback: in-app folder browser
  }
};
$('#browserClose').onclick = () => $('#browserModal').classList.add('hidden');
$('#browserModal').addEventListener('click', e => { if (e.target.id === 'browserModal') $('#browserModal').classList.add('hidden'); });
$('#saveBtn').onclick = saveFile;
$('#addSectionBtn').onclick = () => {
  if (!state.path) return toast('Open a file first');
  addSection(state.sections.length);
};

const fontSel = $('#fontSelect');
fontSel.onchange = () => {
  if (fontSel.value) document.body.style.setProperty('--app-font', fontSel.value);
  else document.body.style.removeProperty('--app-font');
  try { localStorage.setItem('mdview-font', fontSel.value); } catch {}
};
try {
  const savedFont = localStorage.getItem('mdview-font');
  if (savedFont) { fontSel.value = savedFont; document.body.style.setProperty('--app-font', savedFont); }
} catch {}

const themeSel = $('#themeSelect');
themeSel.onchange = () => {
  document.body.dataset.theme = themeSel.value;
  try { localStorage.setItem('mdview-theme', themeSel.value); } catch {}
};
try {
  const saved = localStorage.getItem('mdview-theme');
  if (saved) { themeSel.value = saved; document.body.dataset.theme = saved; }
} catch {}

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveFile(); }
});

window.addEventListener('beforeunload', e => {
  if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});

// collapsible sidebar sections (state remembered per section)
document.querySelectorAll('.side-block').forEach(block => {
  const h3 = block.querySelector('h3');
  const key = 'mdview-collapse-' + h3.textContent.trim().toLowerCase();
  try { if (localStorage.getItem(key) === '1') block.classList.add('collapsed'); } catch {}
  h3.addEventListener('click', () => {
    block.classList.toggle('collapsed');
    try { localStorage.setItem(key, block.classList.contains('collapsed') ? '1' : '0'); } catch {}
  });
});

loadPaths();
render();

// opened via OS "Open with" → ?open=<path>; otherwise restore the last location
const qOpen = new URLSearchParams(location.search).get('open');
if (qOpen) {
  history.replaceState(null, '', '/');
  openPath(qOpen);
} else {
  restoreLast();
}
