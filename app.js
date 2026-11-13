/* Reading Inbox: private reader for articles kept in a private GitHub repo.
   This page holds no article content. Everything is fetched from the GitHub API
   with a read-only token that stays in this browser's local storage. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
    }
    kids.forEach(k => n.append(k));
    return n;
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('ri.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('ri.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem('ri.' + k); } catch { /* ignore */ } },
  };

  // ---------- layout settings ----------
  const LAYOUT_DEFAULTS = { width: 75, size: 18, line: 1.6, font: 'serif', theme: 'auto', align: 'center', wrap: true };
  const FULL_WIDTH = 165;
  let layout = { ...LAYOUT_DEFAULTS, ...store.get('layout', {}) };
  const root = document.documentElement;
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');

  function applyLayout() {
    root.style.setProperty('--w', layout.width + 'ch');
    root.style.setProperty('--fs', layout.size + 'px');
    root.style.setProperty('--lh', layout.line);
    root.toggleAttribute('data-full', layout.width >= FULL_WIDTH);
    root.toggleAttribute('data-wrap', !!layout.wrap);
    root.dataset.font = layout.font;
    root.dataset.align = layout.align;
    root.dataset.theme = layout.theme === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : layout.theme;
    $('#s-width').value = layout.width; $('#o-width').textContent = layout.width >= FULL_WIDTH ? 'Full' : layout.width + ' chars';
    $('#s-size').value = layout.size; $('#o-size').textContent = layout.size + ' px';
    $('#s-line').value = layout.line; $('#o-line').textContent = Number(layout.line).toFixed(2);
    $('#s-font').value = layout.font; $('#s-theme').value = layout.theme; $('#s-align').value = layout.align;
    $('#s-wrap').checked = !!layout.wrap;
  }
  function bindLayout() {
    const set = (k, v) => { layout[k] = v; store.set('layout', layout); applyLayout(); };
    $('#s-width').oninput = e => set('width', +e.target.value);
    $('#s-size').oninput = e => set('size', +e.target.value);
    $('#s-line').oninput = e => set('line', +e.target.value);
    $('#s-font').onchange = e => set('font', e.target.value);
    $('#s-theme').onchange = e => set('theme', e.target.value);
    $('#s-align').onchange = e => set('align', e.target.value);
    $('#s-wrap').onchange = e => set('wrap', e.target.checked);
    $('#s-reset').onclick = () => { layout = { ...LAYOUT_DEFAULTS }; store.set('layout', layout); applyLayout(); };
    darkQuery.addEventListener('change', applyLayout);
  }

  // ---------- GitHub access + offline cache ----------
  const CONN_DEFAULTS = { owner: '', repo: '', branch: 'main', token: '' };
  const conn = () => ({ ...CONN_DEFAULTS, ...store.get('conn', {}) });
  const CACHE = 'articles-v1';
  const cacheKey = path => { const c = conn(); return `https://cache.invalid/${c.owner}/${c.repo}/${c.branch}/${path}`; };
  const hasCache = 'caches' in window;
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', avif: 'image/avif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };

  class AuthError extends Error {}
  async function fromNetwork(path) {
    const c = conn();
    const url = `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/` +
      path.split('/').map(encodeURIComponent).join('/') + `?ref=${encodeURIComponent(c.branch)}`;
    const res = await fetch(url, { headers: {
      Accept: 'application/vnd.github.raw+json', Authorization: 'Bearer ' + c.token, 'X-GitHub-Api-Version': '2022-11-28' } });
    if (res.status === 401 || res.status === 403) throw new AuthError('GitHub refused the token (HTTP ' + res.status + ').');
    if (res.status === 404) throw new Error('Not found: ' + path + ' in ' + c.owner + '/' + c.repo + ' (' + c.branch + '). GitHub answers this way when the token cannot see the repository: check that the token lists this repository under Only select repositories and has Contents: Read-only, then re-enter it under the gear icon.');
    if (!res.ok) throw new Error('GitHub error ' + res.status + ' for ' + path);
    const blob = await res.blob();
    if (hasCache) { try { await (await caches.open(CACHE)).put(cacheKey(path), new Response(blob)); } catch { /* quota */ } }
    return blob;
  }
  async function fromCache(path) {
    if (!hasCache) return null;
    const hit = await (await caches.open(CACHE)).match(cacheKey(path));
    return hit ? hit.blob() : null;
  }
  /** mode 'fresh': network, fall back to offline copy. mode 'stored': offline copy, else network. */
  async function load(path, mode) {
    if (mode === 'stored') return (await fromCache(path)) || fromNetwork(path);
    try { return await fromNetwork(path); }
    catch (err) {
      if (err instanceof AuthError) throw err;
      const hit = await fromCache(path);
      if (hit) { status('Offline copy shown. ' + (navigator.onLine ? err.message : 'No connection.')); return hit; }
      throw err;
    }
  }

  // ---------- small UI helpers ----------
  const view = $('#view');
  function status(msg) { const s = $('#status'); s.textContent = msg || ''; s.hidden = !msg; }
  function chrome({ title, article }) {
    $('#bar-title').textContent = title; document.title = title === 'Reading Inbox' ? title : title + ' | Reading Inbox';
    $('#back').hidden = !article; $('#toc-btn').hidden = !article;
    $('#progress-fill').style.width = '0';
    closePanels();
  }
  function closePanels() { $('#toc').hidden = true; $('#layout').hidden = true; }
  function togglePanel(id) { const p = $(id); const open = p.hidden; closePanels(); p.hidden = !open; }
  let objectUrls = [];
  function freeUrls() { objectUrls.forEach(URL.revokeObjectURL); objectUrls = []; }
  const fmtDate = d => { const t = d ? new Date(d) : null; return t && !isNaN(t) ? t.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''; };

  // ---------- views ----------
  function showSetup(message) {
    chrome({ title: 'Reading Inbox' }); freeUrls(); status(message || '');
    const c = conn();
    const f = (id, label, value, type = 'text') => [el('label', { for: id, text: label }),
      el('input', { id, type, value, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' })];
    const box = el('div', { class: 'col setup' },
      el('h1', { text: 'Connect to your articles' }),
      el('p', { text: 'This page contains no articles. It reads them from your private GitHub repository using a read-only token that is stored only in this browser.' }),
      el('ol', {},
        el('li', { text: 'On GitHub: Settings, Developer settings, Personal access tokens, Fine-grained tokens, Generate new token.' }),
        el('li', { text: 'Repository access: Only select repositories, then choose the articles repository.' }),
        el('li', { text: 'Permissions: Repository permissions, Contents: Read-only. Nothing else.' }),
        el('li', { text: 'Paste the token below. Repeat once on each device.' })),
      ...f('c-owner', 'Owner', c.owner), ...f('c-repo', 'Repository', c.repo), ...f('c-branch', 'Branch', c.branch),
      ...f('c-token', 'Access token', c.token, 'password'));
    const save = el('button', { class: 'btn primary', text: 'Save and open' });
    save.onclick = () => {
      const v = id => $(id).value.trim();
      if (!v('#c-owner') || !v('#c-repo') || !v('#c-token')) { status('Enter the owner, repository and token first.'); return; }
      store.set('conn', { owner: v('#c-owner'), repo: v('#c-repo'), branch: v('#c-branch') || 'main', token: v('#c-token') });
      location.hash = '#/'; route();
    };
    const forget = el('button', { class: 'btn', text: 'Forget token and offline copies' });
    forget.onclick = async () => {
      store.del('conn'); store.del('pos');
      if (hasCache) await caches.delete(CACHE);
      showSetup('Token and offline copies removed from this device.');
    };
    box.append(el('div', { class: 'row' }, save, forget));
    view.replaceChildren(box);
  }

  async function showList() {
    chrome({ title: 'Reading Inbox' }); freeUrls(); status('');
    view.replaceChildren(el('div', { class: 'col' }, el('p', { class: 'meta', text: 'Loading…' })));
    const index = JSON.parse(await (await load('articles/index.json', 'fresh')).text());
    const items = (index.articles || []).slice().sort((a, b) => (b.fetched || '').localeCompare(a.fetched || '') || a.title.localeCompare(b.title));
    const search = el('input', { type: 'search', placeholder: 'Filter ' + items.length + ' article' + (items.length === 1 ? '' : 's'), 'aria-label': 'Filter articles' });
    const saveAll = el('button', { class: 'btn', text: 'Save all offline' });
    const listBox = el('div');
    const cards = [];
    for (const a of items) {
      const meta = [fmtDate(a.published), a.words ? '~' + Math.max(1, Math.round(a.words / 230)) + ' min' : '',
        a.words ? a.words.toLocaleString() + ' words' : ''].filter(Boolean).join(' · ');
      const badge = el('span', { class: 'badge', text: 'offline', hidden: '' });
      fromCache(`articles/${a.slug}/article.md`).then(hit => { if (hit) badge.hidden = false; });
      const card = el('a', { class: 'card', href: '#/a/' + encodeURIComponent(a.slug) },
        el('h2', { text: a.title }), el('div', { class: 'meta' }, meta, badge));
      cards.push({ card, text: (a.title + ' ' + a.slug).toLowerCase(), a, badge });
      listBox.append(card);
    }
    if (!items.length) listBox.append(el('p', { class: 'meta', text: 'No articles yet. Add a URL to articles.txt in the repository.' }));
    search.oninput = () => { const q = search.value.trim().toLowerCase(); cards.forEach(c => { c.card.hidden = !!q && !c.text.includes(q); }); };
    saveAll.onclick = async () => {
      saveAll.disabled = true;
      try {
        for (const [i, c] of cards.entries()) {
          status(`Saving ${i + 1} of ${cards.length}: ${c.a.title}`);
          const md = await (await load(`articles/${c.a.slug}/article.md`, 'fresh')).text();
          for (const m of new Set(md.match(/\]\((media\/[^)\s]+)\)/g) || [])) await load(`articles/${c.a.slug}/${m.slice(2, -1)}`, 'stored');
          c.badge.hidden = false;
        }
        status('All articles saved for offline reading on this device.');
      } catch (err) { fail(err); }
      saveAll.disabled = false;
    };
    view.replaceChildren(el('div', { class: 'col' }, el('div', { class: 'tools' }, search, saveAll), listBox));
  }

  function splitFrontMatter(md) {
    const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
    const fm = {};
    if (m) for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1'); }
    return { fm, body: m ? md.slice(m[0].length) : md };
  }

  async function showArticle(slug) {
    chrome({ title: 'Loading…', article: true }); freeUrls(); status('');
    view.replaceChildren(el('div', { class: 'col' }, el('p', { class: 'meta', text: 'Loading…' })));
    const base = `articles/${slug}/`;
    const { fm, body } = splitFrontMatter(await (await load(base + 'article.md', 'fresh')).text());
    const html = DOMPurify.sanitize(marked.parse(body, { gfm: true }), {
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'], FORBID_ATTR: ['style', 'srcset'] });
    const art = el('article');
    art.innerHTML = html;
    chrome({ title: fm.title || slug, article: true });

    const src = el('div', { class: 'src' });
    if (fm.published) src.append('Published ' + fmtDate(fm.published) + ' · ');
    if (fm.fetched) src.append('Saved ' + fmtDate(fm.fetched) + ' · ');
    if (/^https?:\/\//.test(fm.source || '')) src.append(el('a', { href: fm.source, target: '_blank', rel: 'noopener noreferrer', text: 'Original article' }));
    const h1 = art.querySelector('h1'); if (h1) h1.after(src); else art.prepend(src);

    art.querySelectorAll('table').forEach(t => { const w = el('div', { class: 'table-wrap' }); t.replaceWith(w); w.append(t); });
    art.querySelectorAll('thead tr').forEach(tr => {   // titled box: let the title span the whole table
      const ths = [...tr.children];
      if (ths.length > 1 && ths[0].textContent.trim() && ths.slice(1).every(th => !th.textContent.trim())) {
        ths[0].colSpan = ths.length; ths.slice(1).forEach(th => th.remove());
      }
    });
    const isLocal = u => !!u && !/^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(u);
    const blobUrl = async rel => {
      const blob = await load(base + decodeURIComponent(rel), 'stored');
      const typed = new Blob([blob], { type: MIME[rel.split('.').pop().toLowerCase()] || blob.type });
      const u = URL.createObjectURL(typed); objectUrls.push(u); return u;
    };
    art.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (isLocal(href)) {
        a.addEventListener('click', async e => { e.preventDefault(); try { window.open(await blobUrl(href), '_blank'); } catch (err) { fail(err); } });
      } else if (!href.startsWith('#')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    });
    art.querySelectorAll('img').forEach(img => {
      const rel = img.getAttribute('src');
      img.loading = 'lazy';
      if (!isLocal(rel)) return;
      img.removeAttribute('src'); img.classList.add('pending');
      blobUrl(rel).then(u => { img.src = u; img.classList.remove('pending'); img.addEventListener('click', () => window.open(u, '_blank')); })
        .catch(() => { img.alt = (img.alt || 'Image') + ' (could not load ' + rel + ')'; });
    });

    const toc = $('#toc-list'); toc.replaceChildren();
    art.querySelectorAll('h2, h3').forEach((h, i) => {
      h.id = 'sec-' + i;
      const a = el('a', { href: '#', class: h.tagName === 'H3' ? 'l3' : 'l2', text: h.textContent });
      a.onclick = e => { e.preventDefault(); closePanels(); h.scrollIntoView({ behavior: 'smooth' }); };
      toc.append(a);
    });
    view.replaceChildren(el('div', { class: 'col' }, art));

    const pos = store.get('pos', {})[slug];
    requestAnimationFrame(() => window.scrollTo(0, pos ? pos * (document.documentElement.scrollHeight - innerHeight) : 0));
    currentSlug = slug;
  }

  // ---------- reading progress ----------
  let currentSlug = null, saveTimer = 0;
  addEventListener('scroll', () => {
    if (!currentSlug) return;
    const max = document.documentElement.scrollHeight - innerHeight;
    const frac = max > 0 ? Math.min(1, scrollY / max) : 0;
    $('#progress-fill').style.width = (frac * 100).toFixed(1) + '%';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { const p = store.get('pos', {}); p[currentSlug] = +frac.toFixed(4); store.set('pos', p); }, 400);
  }, { passive: true });

  // ---------- routing ----------
  function fail(err) {
    console.error(err);
    if (err instanceof AuthError) { showSetup(err.message + ' Check that the token is valid, not expired, and has Contents: Read-only on this repository.'); return; }
    status(err.message || String(err));
  }
  async function route() {
    currentSlug = null;
    const hash = location.hash || '#/';
    try {
      if (!conn().token || hash === '#/setup') return showSetup();
      const m = hash.match(/^#\/a\/(.+)$/);
      if (m) await showArticle(decodeURIComponent(m[1])); else { await showList(); window.scrollTo(0, 0); }
    } catch (err) { fail(err); }
  }

  $('#back').onclick = () => { location.hash = '#/'; };
  $('#menu-btn').onclick = () => { if (location.hash === '#/setup') route(); else location.hash = '#/setup'; };
  $('#layout-btn').onclick = () => togglePanel('#layout');
  $('#toc-btn').onclick = () => togglePanel('#toc');
  document.querySelectorAll('.panel .close').forEach(b => { b.onclick = closePanels; });
  addEventListener('keydown', e => { if (e.key === 'Escape') closePanels(); });
  addEventListener('hashchange', route);
  bindLayout(); applyLayout(); route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
