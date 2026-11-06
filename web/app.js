/* Offline reference browser. No remote requests or persistent search history. */
(() => {
  'use strict';
  const DB = JSON.parse(document.getElementById('risk-data').textContent);
  const RULES = JSON.parse(document.getElementById('handling-rules').textContent);
  const PINYIN = JSON.parse(document.getElementById('pinyin-table').textContent).table;
  const SLANG = JSON.parse(document.getElementById('slang-terms').textContent);
  const BANNED = JSON.parse(document.getElementById('banned-terms').textContent);
  const updatedAt = DB.updated_at || '未提供';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const num = value => value.toLocaleString('en-US');
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const unique = values => [...new Set(values.filter(Boolean))];
  const localeSort = values => values.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const records = DB.records.map(r => {
    const names = unique([r.name, ...(r.variants || [])]);
    return {...r, companies:r.companies || [], labels:r.labels || [],
      registrations:r.registrations || [], names,
      exact: [...names, ...(r.companies || [])].map(norm),
      haystack:norm([r.id, ...names, ...(r.companies || []), r.category, r.object_type,
        ...(r.labels || []), ...(r.registrations || [])].join(' '))};
  });
  // ===== 伪装名识别：镜像 scripts/disguise.py =====
  const SYLLABLES = new Set(Object.values(PINYIN));
  const LONGEST = Math.max(...[...SYLLABLES].map(s => s.length));
  const FILLERS = ['的', '全套', '课程', '网课', '资料', '视频', '教程', '合集', '打包', '完整版', '最新版', '最新', '高清', '系列'];
  const MIN_FULL = 4, MIN_INITIALS = 3;
  const isHan = c => c >= '\u4e00' && c <= '\u9fff';
  const isLatin = c => /[A-Za-z]/.test(c);
  function segmentLatin(run) {
    const out = []; let i = 0;
    while (i < run.length) {
      let found = false;
      for (let size = Math.min(LONGEST, run.length - i); size > 0; size--) {
        if (SYLLABLES.has(run.slice(i, i + size))) { out.push(run.slice(i, i + size)); i += size; found = true; break; }
      }
      if (!found) return [run];
    }
    return out;
  }
  function tokenize(text, withSpans=false) {
    text = String(text ?? '').normalize('NFKC');
    const tokens = []; let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (isHan(c)) { tokens.push([PINYIN[c] || c, i, i + 1]); i++; }
      else if (isLatin(c)) {
        let j = i; while (j < text.length && isLatin(text[j])) j++;
        let pos = i;
        for (const part of segmentLatin(text.slice(i, j).toLowerCase())) { tokens.push([part, pos, pos + part.length]); pos += part.length; }
        i = j;
      } else if (/[0-9]/.test(c)) { let j = i; while (j < text.length && /[0-9]/.test(text[j])) j++; tokens.push([text.slice(i, j), i, j]); i = j; }
      else i++;
    }
    return withSpans ? tokens : tokens.map(t => t[0]);
  }
  function stripFillers(text) { let t = String(text ?? '').normalize('NFKC'); for (const f of FILLERS) t = t.split(f).join(' '); return t; }
  function forms(text) {
    const full = tokenize(text), core = tokenize(stripFillers(text));
    const raw = String(text ?? ''), hasHan = [...raw].some(isHan), hasLatin = [...raw].some(isLatin);
    return {full, core, initials: full.map(t => t[0]).join(''), latinOnly: full.length > 0 && !hasHan, mixed: hasHan && hasLatin};
  }
  const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  function containsList(hay, needle) {
    if (!needle.length || needle.length > hay.length) return false;
    for (let i = 0; i + needle.length <= hay.length; i++) if (sameList(hay.slice(i, i + needle.length), needle)) return true;
    return false;
  }
  function isDisguise(q, n) {
    if (q.full.join('').length < MIN_INITIALS) return false;
    if (q.full.length >= MIN_FULL && sameList(q.full, n.full)) return true;
    if (q.mixed && q.full.length >= 2 && sameList(q.full, n.full)) return true;
    const [shorter, longer] = q.core.length <= n.core.length ? [q.core, n.core] : [n.core, q.core];
    if (shorter.length >= MIN_FULL && containsList(longer, shorter)) return true;
    if (q.latinOnly) { const letters = q.full.join(''); if (letters.length >= MIN_INITIALS && letters === n.initials && n.full.length >= MIN_INITIALS) return true; }
    return false;
  }
  for (const r of records) r.dforms = r.names.map(forms).filter(f => f.full.length >= 2);
  const disguisedFor = query => { const qf = forms(query); return new Set(records.filter(r => r.dforms.some(f => isDisguise(qf, f))).map(r => r.id)); };
  const byId = new Map(records.map(r => [r.id, r]));
  const categories = localeSort(unique(records.map(r => r.category)));
  const companies = localeSort(unique(records.flatMap(r => r.companies)));
  const labels = localeSort(unique(records.flatMap(r => r.labels)));
  const tabNames = {all:'全部名单', registered:'登记作品', company:'公司关联', lint:'标题体检'};
  const inTab = (r, tab) => tab === 'registered' ? r.object_type === '登记作品' :
    tab === 'company' ? r.companies.length > 0 || r.object_type === '公司名称' : true;
  const sortOrders = ['default', 'name', 'name-desc'];
  const defaults = {q:'', category:'', company:'', label:'', tab:'all', exact:false, sort:'default', page:1, text:''};
  let state = {...defaults};
  let results = [];
  let openId = null;
  let debounce, toastTimer;
  const pageSize = 20;
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function highlight(value) {
    const text = String(value ?? '');
    const terms = unique(state.q.trim().split(/\s+/).filter(Boolean)).sort((a,b) => b.length-a.length);
    if (!terms.length) return esc(text);
    const expression = new RegExp('(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'giu');
    return text.split(expression).map((part, i) => i % 2 ? `<mark>${esc(part)}</mark>` : esc(part)).join('');
  }

  function labelClass(label) { return label.includes('登记') ? 'reg' : 'risk'; }
  function labelTags(r) {
    if (r.labels.length) return r.labels.map(label => `<span class="b ${labelClass(label)}">${highlight(label)}</span>`).join('');
    return `<span class="b ${r.registrations.length ? 'reg' : 'wait'}">${r.registrations.length ? '附登记资料' : '待核对线索'}</span>`;
  }

  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    state = {...defaults};
    state.q = (params.get('q') || '').slice(0, 500);
    state.text = (params.get('text') || '').slice(0, 500);
    for (const [key, allowed] of Object.entries({category:categories, company:companies, label:labels,
      tab:Object.keys(tabNames), sort:sortOrders})) {
      if (allowed.includes(params.get(key))) state[key] = params.get(key);
    }
    state.exact = params.get('exact') === '1';
    const page = Number(params.get('page'));
    if (Number.isSafeInteger(page) && page > 0) state.page = page;
    const id = params.get('id');
    openId = id && byId.has(id) ? id : null;
  }

  function saveHash() {
    const params = new URLSearchParams();
    Object.keys(defaults).forEach(key => {
      if (state[key] !== defaults[key]) params.set(key, key === 'exact' ? '1' : String(state[key]));
    });
    if (openId) params.set('id', openId);
    const hash = params.toString();
    // File URLs support a fragment even on browsers that restrict History API.
    try { history.replaceState(null, '', location.pathname + location.search + (hash ? '#' + hash : '')); }
    catch (_) { if (location.hash.slice(1) !== hash) location.replace('#' + hash); }
  }

  function moveIndicator() {
    const active = document.querySelector('.tabs button.on');
    const ind = document.querySelector('.tabs .ind');
    if (!active || !ind) return;
    ind.style.width = active.offsetWidth + 'px';
    ind.style.transform = `translateX(${active.offsetLeft - 3}px)`;
  }

  function syncControls() {
    if ($('search').value !== state.q) $('search').value = state.q;
    $('exact-match').checked = state.exact;
    for (const key of ['company','label']) $(key + '-filter').value = state[key];
    document.querySelectorAll('[data-category]').forEach(button => {
      const active = button.dataset.category === state.category;
      button.classList.toggle('on', active);
      if (active) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-tab]').forEach(button => {
      const active = button.dataset.tab === state.tab;
      button.classList.toggle('on', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    const th = document.querySelector('th[data-sort="name"]');
    th.classList.toggle('on', state.sort !== 'default');
    th.querySelector('.ar').classList.toggle('up', state.sort === 'name-desc');
    th.setAttribute('aria-sort', state.sort === 'name' ? 'ascending' : state.sort === 'name-desc' ? 'descending' : 'none');
    moveIndicator();
  }

  function render() {
    clearTimeout(debounce);
    const query = norm(state.q), terms = query.split(' ').filter(Boolean);
    const lintMode = state.tab === 'lint';
    document.body.classList.toggle('lint-mode', lintMode);
    if (lintMode) { syncControls(); saveHash(); $('results-title').textContent = tabNames.lint; renderLint(); return; }
    const disguised = query && !state.exact ? disguisedFor(state.q) : new Set();
    results = records.filter(r => inTab(r, state.tab) && (!state.category || r.category === state.category) &&
      (!state.company || r.companies.includes(state.company)) && (!state.label || r.labels.includes(state.label)) &&
      (!query || (state.exact ? r.exact.includes(query) : terms.every(term => r.haystack.includes(term)) || disguised.has(r.id))));
    const viaDisguise = r => disguised.has(r.id) && !terms.every(term => r.haystack.includes(term));
    if (state.sort === 'name') results.sort((a,b) => a.name.localeCompare(b.name, 'zh-CN'));
    else if (state.sort === 'name-desc') results.sort((a,b) => b.name.localeCompare(a.name, 'zh-CN'));
    else if (query) results.sort((a,b) => Number(b.exact.includes(query))-Number(a.exact.includes(query)) || Number(viaDisguise(a))-Number(viaDisguise(b)) || a.id.localeCompare(b.id));
    const pages = Math.max(1, Math.ceil(results.length/pageSize));
    state.page = Math.min(state.page, pages);
    syncControls();
    saveHash();
    $('results-title').textContent = state.category || tabNames[state.tab];
    $('result-count').textContent = `找到 ${num(results.length)} 条 · 共 ${num(records.length)} 条资料`;
    const mini = [`<span class="ms"><b>${num(results.length)}</b>条</span>`];
    const regN = results.filter(r => r.registrations.length).length, compN = unique(results.flatMap(r => r.companies)).length;
    if (regN) mini.push(`<span class="ms vio"><b>${num(regN)}</b>附登记</span>`);
    if (compN) mini.push(`<span class="ms amb"><b>${num(compN)}</b>关联公司</span>`);
    if (!state.category && state.tab === 'all' && !query) mini.push(`<span class="ms"><b>${categories.length}</b>领域</span>`);
    $('mini-stats').innerHTML = mini.join('');
    $('empty-state').hidden = results.length > 0;
    const scoped = state.category || state.company || state.label || state.tab !== 'all';
    const globalHits = (!results.length && query && scoped) ? records.filter(r => state.exact ? r.exact.includes(query) : terms.every(term => r.haystack.includes(term)) || disguised.has(r.id)).length : 0;
    $('empty-hint').hidden = !globalHits;
    if (globalHits) $('empty-hint').innerHTML = `当前筛选范围内没有结果，<b>全部名单里有 ${num(globalHits)} 条匹配</b>。<button class="btn dark" id="empty-scope">去掉筛选，查全库</button>`;
    $('table-wrap').hidden = results.length === 0;
    const shown = results.slice((state.page-1)*pageSize, state.page*pageSize);
    const body = $('results-body');
    body.classList.remove('anim');
    body.innerHTML = shown.map((r, i) => {
      const note = r.companies.join('、') || r.object_type || '名称线索';
      return `<tr class="r${r.id === openId ? ' sel' : ''}" data-record="${esc(r.id)}" style="--i:${i}" tabindex="0" aria-label="查看${esc(r.name)}详情">
        <td class="t"><span class="name">${highlight(r.name)}</span>${viaDisguise(r) ? '<span class="b dis" title="输入疑似为该名称的谐音、拼音或拆写">疑似伪装</span>' : ''}<span class="mt" title="${esc(note)}">${esc(note)}</span><span class="mcat">${esc(r.category)}</span></td>
        <td class="c-cat"><span class="b cat">${esc(r.category)}</span></td>
        <td class="t">${labelTags(r)}</td>
        <td class="num c-reg">${r.registrations.length ? `<span class="mono">${num(r.registrations.length)}</span>` : '<span class="none-mark">—</span>'}</td>
        <td class="c-go"><span class="go">${icon('chevron')}</span></td></tr>`;
    }).join('');
    if (!reduceMotion()) body.classList.add('anim');
    const chips = [];
    for (const [key, prefix] of [['q','搜索'],['category','领域'],['company','公司'],['label','标签']]) {
      if (state[key]) chips.push(`<button class="chip rm" data-clear="${key}" aria-label="移除${prefix}筛选">${prefix}：${esc(state[key])}${icon('close')}</button>`);
    }
    if (state.exact) chips.push(`<button class="chip rm" data-clear="exact">精确匹配${icon('close')}</button>`);
    $('active-filters').innerHTML = chips.join('');
    $('page-description').textContent = results.length ? `第 ${num((state.page-1)*pageSize+1)}–${num(Math.min(state.page*pageSize,results.length))} 条 / 共 ${num(results.length)} 条` : '暂无结果';
    $('previous-page').disabled = state.page <= 1;
    $('next-page').disabled = state.page >= pages;
    const numbers = unique([1, state.page-1, state.page, state.page+1, pages].filter(n => n >= 1 && n <= pages)).sort((a,b) => a-b);
    $('page-buttons').innerHTML = numbers.map((n,i) => (i && n-numbers[i-1]>1 ? '<span class="dots">…</span>' : '') + `<button class="${n===state.page?'cur':''}" data-page="${n}" ${n===state.page?'aria-current="page"':''} aria-label="第${n}页">${n}</button>`).join('');
  }

  function update(changes, scroll=false) {
    state = {...state, page:1, ...changes};
    render();
    if (scroll) $('results-title').scrollIntoView({block:'start', behavior:reduceMotion()?'instant':'smooth'});
  }

  // 查版权永远全库搜：清掉领域、公司、标签与材料类型筛选；确认查询且精确命中时直接打开详情。
  function search(q, commit=false) {
    q = String(q || '').slice(0, 500);
    update({q, category:'', company:'', label:'', tab:'all'}, commit);
    const nq = norm(q);
    if (commit && results.length && results[0].exact.includes(nq)) openDetails(results[0].id);
    else if (openId && !results.some(r => r.id === openId)) closeDetails();  // 上一条详情不在新结果里就关掉
  }

  // Mirrors scripts/handling.py: status × category × labels → handling card. Pure table lookup.
  function advise(status, r) {
    r = r || {};
    const labels = r.labels || [], regs = r.registrations || [];
    const groups = status === 'no_match' ? [] : RULES.label_groups.filter(g => g.match.some(t => labels.some(l => l.includes(t))));
    let score = RULES.status[status].base;
    if (groups.length) score += Math.max(...groups.map(g => g.weight));
    else if (regs.length && status !== 'no_match') score += RULES.registration_weight;
    score = Math.max(0, Math.min(100, score));
    const level = score >= RULES.levels.red.min ? 'red' : score >= RULES.levels.amber.min ? 'amber' : 'green';
    const cat = RULES.categories[r.category] || RULES.categories._default;
    const card = {level, levelName:RULES.levels[level].name, score, headline:RULES.status[status].headline, title:RULES.levels[level].title,
      meaning:groups.map(g => g.meaning), actions:[], docs:[], alternatives:[], platforms:RULES.platform_notes[cat.platform] || {}, checklist:RULES.checklist || [], notice:RULES.notice};
    const objectNote = (RULES.object_types || {})[r.object_type || ''];
    if (status !== 'no_match' && objectNote) card.meaning.push(objectNote);
    if (!groups.length && regs.length && status !== 'no_match') card.meaning.push((RULES.label_groups.find(g => g.id === 'registered') || {}).meaning || '');
    if (status === 'no_match') { card.actions = RULES.no_match.actions; card.platforms = {}; card.meaning = []; }
    else if (status === 'candidates' || status === 'disguised') { card.actions = [...RULES[status].actions, ...cat.forms.slice(0,1)]; card.docs = unique(groups.flatMap(g => g.docs)); card.alternatives = cat.alternatives || []; if (status === 'disguised') card.meaning.unshift('输入疑似为伪装写法（谐音、拼音、拆字或中英混写），命中是候选不是结论。'); }
    else { card.actions = unique([...groups.flatMap(g => g.actions), ...cat.forms]); card.docs = unique([...groups.flatMap(g => g.docs), ...(cat.docs || [])]); card.alternatives = cat.alternatives || []; }
    card.meaning = unique(card.meaning);
    return card;
  }

  function cardHTML(card, compact=false) {
    const top = card.actions.slice(0, 3), rest = card.actions.slice(3);
    const chips = (items, cls) => items.map(d => `<span class="b ${cls}">${esc(d)}</span>`).join('');
    const fold = (title, body, open=false) => body ? `<details class="fold"${open ? ' open' : ''}><summary>${esc(title)}${icon('chevron')}</summary><div class="fold-body">${body}</div></details>` : '';
    const platforms = Object.entries(card.platforms || {});
    return `<div class="verdict ${card.level}">
        <div class="v-row"><span class="v-lv">${esc(card.levelName)}</span><span class="v-score"><b>${card.score}</b><small>/100</small></span></div>
        <div class="v-title">${esc(card.title)}</div>
        <div class="v-line">${esc(card.headline)}${card.meaning.length ? '，' + esc(card.meaning[0]) : ''}</div>
      </div>
      ${top.length ? `<div class="todo"><span class="lab">${compact ? '接下来做' : '先做这三件'}</span>${top.map((a, i) => `<div class="todo-item"><span class="n">${i + 1}</span><span>${esc(a)}</span></div>`).join('')}</div>` : ''}
      <div class="folds">
        ${fold('为什么这么判', card.meaning.length > 1 ? `<ul>${card.meaning.slice(1).map(m => `<li>${esc(m)}</li>`).join('')}</ul>` : '')}
        ${fold('更多做法', rest.length ? `<ol start="4">${rest.map(a => `<li>${esc(a)}</li>`).join('')}</ol>` : '')}
        ${fold('上架前要拿到', card.docs.length ? `<div class="vars">${chips(card.docs, 'p')}</div>` : '')}
        ${fold('换个方向', card.alternatives.length ? `<div class="vars">${chips(card.alternatives, 'reg')}</div>` : '')}
        ${!compact ? fold('平台提示', platforms.length ? `<ul class="plat-list">${platforms.map(([k,v]) => `<li><b>${esc(k)}</b>${esc(v)}</li>`).join('')}</ul>` : '') : ''}
        ${!compact ? fold('合规四查', `<ul class="checks">${card.checklist.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`) : ''}
      </div>
      <p class="cd-note">${esc(card.notice)}</p>`;
  }

  // ===== 标题体检：镜像 scripts/lint_listing.py =====
  const lnorm = v => String(v ?? '').normalize('NFKC').toLowerCase();
  const variantOk = v => v.length > 1 && !/^[a-z0-9]{1,3}$/.test(v);
  const NAME_INDEX = (() => {
    const items = [];
    for (const r of records) {
      for (const term of r.names) { const lt = lnorm(term); if (lt.length >= 2) items.push([lt, r, term, 'exact_name']); }
      for (const c of r.companies) { const lc = lnorm(c); if (lc.length >= 3) items.push([lc, r, c, 'exact_company']); }
    }
    return items.sort((a, b) => b[0].length - a[0].length);
  })();
  const SLANG_INDEX = (() => { const items = []; for (const t of SLANG.terms) for (const v of t.variants) { const lv = lnorm(v); if (variantOk(lv)) items.push([lv, t, v]); } return items.sort((a, b) => b[0].length - a[0].length); })();
  const BANNED_INDEX = BANNED.terms.map(t => [lnorm(t.term), t]).sort((a, b) => b[0].length - a[0].length);
  const DISGUISE_INDEX = records.flatMap(r => r.names.map(term => [r, term, forms(term)]).filter(x => x[2].full.length >= 2));
  const MODE_NAMES = {exact_name:'名称精确命中', exact_company:'公司精确关联', partial_candidate:'部分匹配候选', disguised_candidate:'疑似伪装命中'};
  const LIVE = {killed:'拦截词', watching:'抽检', active:'可搜'};
  const RISKN = {danger:'高危', warning:'警告', safe:'一般'};
  const LEVEL_NAMES = {red:'红灯', amber:'黄灯', green:'绿灯'};
  function place(taken, s, e) { if (taken.some(([a, b]) => a < e && s < b)) return false; taken.push([s, e]); return true; }
  function findAll(hay, needle) { const out = []; let i = hay.indexOf(needle); while (i >= 0) { out.push(i); i = hay.indexOf(needle, i + 1); } return out; }
  function scanDisguised(text) {
    const spans = tokenize(text, true), tokens = spans.map(t => t[0]), raw = String(text).normalize('NFKC'), hits = [];
    const mixed = (s, e) => { const p = raw.slice(s, e); return [...p].some(isHan) && [...p].some(isLatin); };
    for (const [r, term, f] of DISGUISE_INDEX) {
      const pattern = f.core.length >= MIN_FULL ? f.core : f.full, n = pattern.length;
      if (n >= 2) for (let i = 0; i + n <= tokens.length; i++) {
        if (sameList(tokens.slice(i, i + n), pattern)) { const s = spans[i][1], e = spans[i + n - 1][2]; if (n >= MIN_FULL || mixed(s, e)) { hits.push([s, e, r, term]); break; } }
      }
      if (f.initials.length >= MIN_INITIALS && f.full.length >= MIN_INITIALS) {
        for (const m of raw.matchAll(/[A-Za-z]{3,}/g)) if (m[0].toLowerCase() === f.initials) { hits.push([m.index, m.index + m[0].length, r, term]); break; }
      }
    }
    return hits;
  }
  function adviseCopyright(h) {
    const cat = RULES.categories[h.record.category] || RULES.categories._default;
    const alt = (cat.alternatives || []).slice(0, 2).join('、') || '描述性说法';
    if (h.match_type === 'disguised_candidate') return `疑似「${h.matched_term}」的伪装写法；改写躲不过稽查，去掉该名称，改为：${alt}。`;
    if (h.match_type === 'exact_company') return `命中公司「${h.matched_term}」；不要在标题提公司名，改为：${alt}。`;
    return `命中版权名「${h.matched_term}」（${h.record.labels.join('；') || '待核对'}）；去掉名称，改为：${alt}。`;
  }
  function adviseSlang(h) {
    let base = `暗语「${h.variant}」＝${h.name}`;
    if (h.liveness === 'killed') base += '；已被平台拦截，写上会被下架'; else if (h.liveness === 'watching') base += '；平台抽检限流';
    if (h.risk === 'danger' || h.policy === 'grey') return base + '；该题材高危，不提供替代词，建议不做。';
    if ((h.liveness === 'killed' || h.liveness === 'watching') && h.successors.length) return base + '；可换：' + h.successors.slice(0, 3).join('、') + '。';
    if (h.liveness === 'active') return base + '；当前可搜，但暗语本身说明该品类受审核关注，建议用正常描述。';
    return base + '；建议用正常描述替代。';
  }
  function lint(text) {
    text = String(text ?? '').normalize('NFKC').slice(0, 2000);
    const low = lnorm(text), taken = [], hits = [];
    for (const [lt, r, term, mode] of NAME_INDEX) for (const i of findAll(low, lt)) if (place(taken, i, i + lt.length)) { hits.push({fragment:text.slice(i, i + lt.length), start:i, kind:'copyright', match_type:mode, matched_term:term, record:r}); break; }
    for (const [s, e, r, term] of scanDisguised(text)) if (place(taken, s, e)) hits.push({fragment:text.slice(s, e), start:s, kind:'copyright', match_type:'disguised_candidate', matched_term:term, record:r});
    for (const [lv, t, v] of SLANG_INDEX) for (const i of findAll(low, lv)) if (place(taken, i, i + lv.length)) { hits.push({fragment:text.slice(i, i + lv.length), start:i, kind:'slang', variant:v, name:t.name, category:t.category_name, liveness:t.liveness || '', risk:t.risk || '', policy:t.policy || '', explanation:t.explanation || '', successors:t.successors || []}); break; }
    for (const [lt, t] of BANNED_INDEX) for (const i of findAll(low, lt)) if (place(taken, i, i + lt.length)) { const g = BANNED.groups[t.group]; hits.push({fragment:text.slice(i, i + lt.length), start:i, kind:'banned', term:t.term, group:t.group, group_name:g.name, level:g.level, advice:t.replace || g.advice}); break; }
    for (const h of hits) { if (h.kind === 'copyright') h.advice = adviseCopyright(h); else if (h.kind === 'slang') h.advice = adviseSlang(h); }
    hits.sort((a, b) => a.start - b.start);
    let level = 'green'; const reasons = [];
    const bump = (to, why) => { if (to === 'red' || level !== 'red') level = to === 'red' ? 'red' : (level === 'red' ? 'red' : 'amber'); reasons.push(why); };
    for (const h of hits) {
      if (h.kind === 'copyright') bump(['exact_name', 'exact_company'].includes(h.match_type) ? 'red' : 'amber', ['exact_name', 'exact_company'].includes(h.match_type) ? '版权精确命中' : '版权候选');
      else if (h.kind === 'slang') bump(h.liveness === 'killed' || h.risk === 'danger' || h.policy === 'grey' ? 'red' : 'amber', h.liveness === 'killed' || h.risk === 'danger' || h.policy === 'grey' ? '拦截词或高危暗语' : '暗语');
      else bump(h.level === 'red' ? 'red' : 'amber', h.level === 'red' ? '售假高频词' : h.group_name);
    }
    const rank = {exact_name:0, exact_company:1, partial_candidate:2, disguised_candidate:3};
    let worst = null; for (const h of hits) if (h.kind === 'copyright' && (!worst || rank[h.match_type] < rank[worst.match_type])) worst = h;
    const card = worst ? advise(rank[worst.match_type] < 2 ? 'matched' : rank[worst.match_type] === 2 ? 'candidates' : 'disguised', worst.record) : advise('no_match');
    return {text, level, levelName:LEVEL_NAMES[level], reasons:unique(reasons), hits, card};
  }
  function renderLint() {
    const area = $('lint-text');
    if (area.value !== state.text) area.value = state.text;
    const out = $('lint-result');
    if (!state.text.trim()) { out.innerHTML = `<div class="none"><b>粘贴标题或详情，点“体检”</b><p>本地扫描版权名、伪装写法、平台暗语与违禁词，给出改写建议。不联网，不保存文本。</p></div>`; return; }
    const res = lint(state.text);
    const row = h => {
      let verdict, cls;
      if (h.kind === 'copyright') { verdict = `${MODE_NAMES[h.match_type]}：${esc(h.record.name)}`; cls = h.match_type.startsWith('exact') ? 'red' : 'amber'; }
      else if (h.kind === 'slang') { verdict = `${LIVE[h.liveness] || '暗语'}（${RISKN[h.risk] || '未分级'}）：${esc(h.name)}`; cls = (h.liveness === 'killed' || h.risk === 'danger' || h.policy === 'grey') ? 'red' : 'amber'; }
      else { verdict = esc(h.group_name); cls = h.level; }
      return `<tr><td class="t"><span class="frag ${cls}">${esc(h.fragment)}</span></td><td class="t">${verdict}</td><td class="t adv">${esc(h.advice)}</td></tr>`;
    };
    out.innerHTML = `<div class="card ${res.level} lint-sum"><div class="cd-head"><span class="lv ${res.level}">${esc(res.levelName)}</span><span class="cd-title">${res.reasons.length ? esc(res.reasons.join('、')) : '未发现版权、暗语或违禁词命中'}</span><span class="cd-score mono">${res.hits.length} 处</span></div><p class="cd-line">${esc(res.text)}</p></div>
      ${res.hits.length ? `<div class="tbl"><table class="lint-table"><thead><tr><th>片段</th><th>判定</th><th>建议</th></tr></thead><tbody>${res.hits.map(row).join('')}</tbody></table></div>` : ''}
      <section class="lint-card"><h5 class="lab">运营处置建议</h5><div class="card ${res.card.level}">${cardHTML(res.card)}</div></section>
      <p class="cd-note">${esc(SLANG.notice)}</p>`;
  }

  function relatedRecords(r) {
    const pool = records.filter(x => x.id !== r.id && (
      (r.companies.length && x.companies.some(c => r.companies.includes(c))) ||
      (x.category === r.category && r.labels.length && x.labels.some(l => r.labels.includes(l)))));
    return pool.slice(0, 6);
  }

  function renderDetails() {
    const det = $('det');
    const main = $('main');
    const r = openId ? byId.get(openId) : null;
    document.querySelectorAll('tr.r').forEach(row => row.classList.toggle('sel', row.dataset.record === openId));
    if (!r) { det.classList.remove('show'); main.classList.remove('open'); det.innerHTML = ''; return; }
    const field = (title, value) => `<div>${esc(title)}</div><div>${value || '<span class="sm">未提供</span>'}</div>`;
    const related = r.names.filter(name => name !== r.name);
    const similar = relatedRecords(r);
    const card = advise('matched', r);
    const chips = (items, cls) => items.map(d => `<span class="b ${cls}">${esc(d)}</span>`).join('');
    const tagsHTML = r.labels.length ? r.labels.map(l => `<span class="b ${labelClass(l)} big">${esc(l)}</span>`).join('')
      : `<span class="b ${r.registrations.length ? 'reg' : 'wait'} big">${r.registrations.length ? '附登记资料' : '待核对线索'}</span>`;
    const qterms = norm(state.q).split(' ').filter(Boolean);
    const hitLabel = (qterms.length && !state.exact && !qterms.every(t => r.haystack.includes(t)) && disguisedFor(state.q).has(r.id)) ? '疑似伪装命中' : '名单命中';
    const platforms = Object.entries(card.platforms || {});
    det.innerHTML = `<div class="in">
      <div class="hd"><div><h2>${esc(r.name)}</h2><div class="path">${esc(r.category)} <span class="dot">·</span> ${esc(r.object_type || '名称线索')}</div></div><button class="x" id="close-detail" aria-label="关闭详情">${icon('close')}</button></div>

      <section class="blk primary">
        <div class="blk-h"><span class="blk-t">版权查询结果</span><span class="hit">${esc(hitLabel)}</span></div>
        <div class="facts">
          <div class="fact wide"><span class="lab">风险标签</span><div class="fv">${tagsHTML}</div></div>
          <div class="fact"><span class="lab">产品领域</span><div class="fv">${esc(r.category)}</div></div>
          <div class="fact"><span class="lab">材料类型</span><div class="fv">${esc(r.object_type || '名称线索')}</div></div>
          <div class="fact wide"><span class="lab">关联公司</span><div class="fv">${r.companies.length ? r.companies.map(c => `<button class="chip rm" data-company="${esc(c)}" title="筛选该公司">${esc(c)}</button>`).join('') : '<span class="sm">未提供</span>'}</div></div>
          ${r.registrations.length ? `<div class="fact wide"><span class="lab">作品登记号 <i>${r.registrations.length}</i></span><ul class="reglist">${r.registrations.map(reg => `<li>${esc(reg)}</li>`).join('')}</ul></div>` : ''}
          ${related.length ? `<div class="fact wide"><span class="lab">名称变体 <i>${related.length}</i></span><div class="vars">${chips(related, 'p')}</div></div>` : ''}
        </div>
        <p class="note-line">历史风险线索，未外部核验。收录不表示该主体存在违法行为，请核对实际内容与转售授权。</p>
        ${similar.length ? `<details class="fold"><summary>同公司或同标签的其他条目 <i>${similar.length}</i>${icon('chevron')}</summary><div class="fold-body">${similar.map(x => `<button class="rel" data-record="${esc(x.id)}"><span class="tt">${esc(x.name)}</span><span class="rd">${esc(x.companies[0] || x.category)}</span></button>`).join('')}</div></details>` : ''}
      </section>

      <section class="blk secondary ${card.level}">
        <div class="blk-h"><span class="blk-t">运营建议</span><span class="lv-mini ${card.level}">${esc(card.levelName)}<i style="--w:${card.score}%"></i><b>${card.score}</b></span></div>
        <div class="adv-verdict"><div class="adv-title">${esc(card.title)}</div>${card.meaning.length ? `<p class="adv-why">${card.meaning.map(esc).join(' ')}</p>` : ''}</div>
        <div class="adv-steps">${card.actions.map((a, i) => `<div class="step"><span class="n">${i + 1}</span><span class="t">${esc(a)}</span></div>`).join('')}</div>
        ${card.docs.length || card.alternatives.length ? `<div class="adv-panels">
          ${card.docs.length ? `<div class="panel"><div class="p-h">${icon('info')}上架前要拿到</div><ul>${card.docs.map(d => `<li>${esc(d)}</li>`).join('')}</ul></div>` : ''}
          ${card.alternatives.length ? `<div class="panel alt"><div class="p-h">${icon('chevron')}换个方向</div><ul>${card.alternatives.map(d => `<li>${esc(d)}</li>`).join('')}</ul></div>` : ''}
        </div>` : ''}
        ${platforms.length ? `<div class="adv-plat">${platforms.map(([k,v]) => `<div class="pl"><span class="pl-tag pl-${k === '闲鱼' ? 'xy' : k === '小红书' ? 'xhs' : 'tb'}">${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>` : ''}
        <div class="adv-checks">${card.checklist.map(c => { const [k, v] = c.split('：'); const done = v === '已查'; return `<div class="ck${done ? ' done' : ''}"><span class="box">${done ? '✓' : ''}</span><span class="k">${esc(k)}</span><span class="v">${esc(v || '')}</span></div>`; }).join('')}</div>
        <p class="cd-note">${esc(card.notice)} 规则表 ${esc(RULES.version)}。</p>
      </section>
    </div>`;
    main.classList.add('open');
    det.scrollTop = 0;
    requestAnimationFrame(() => det.classList.add('show'));
  }

  function openDetails(id) {
    if (!byId.has(id)) return;
    openId = id;
    saveHash();
    renderDetails();
  }

  function closeDetails() {
    openId = null;
    saveHash();
    renderDetails();
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('visible');
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3500);
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme) root.setAttribute('data-theme', theme); else root.removeAttribute('data-theme');
    const dark = theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    $('theme').textContent = dark ? '浅色' : '深色';
  }

  function init() {
    let saved = null;
    try { saved = localStorage.getItem('radar-theme'); } catch (_) {}
    applyTheme(saved === 'dark' || saved === 'light' ? saved : null);
    $('theme').addEventListener('click', () => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (!document.documentElement.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
      const next = dark ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem('radar-theme', next); } catch (_) {}
    });

    $('empty-advice').innerHTML = cardHTML(advise('no_match'), true);
    const companyNames = unique([...companies,...records.filter(r=>r.object_type==='公司名称').map(r=>r.name)]);
    $('about-scale').textContent = `${num(records.length)} 条名称与关键词 · ${categories.length} 个产品领域 · ${num(companyNames.length)} 个公司名称线索 · ${num(records.filter(r => r.registrations.length).length)} 条附作品登记资料 · 暗语与违禁词 ${num(SLANG.terms.length + BANNED.terms.length)} 条`;
    $('all-stats').addEventListener('click', () => $('about-dialog').showModal());
    for (const id of ['snapshot-date','footer-date','about-date']) $(id).textContent = updatedAt;
    $('category-list').innerHTML = categories.map(category=>`<button class="it${category.includes('待')?' pending':''}" data-category="${esc(category)}"><span>${esc(category)}</span></button>`).join('');
    for (const [id, values] of [['company-filter',companies],['label-filter',labels]]) {
      $(id).insertAdjacentHTML('beforeend', values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join(''));
    }
    $('lint-button').addEventListener('click', () => update({text:$('lint-text').value.slice(0, 500)}));
    $('lint-text').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); update({text:$('lint-text').value.slice(0, 500)}); } });
    $('lint-clear').addEventListener('click', () => update({text:''}));
    document.querySelectorAll('[data-lint-example]').forEach(b => b.addEventListener('click', () => update({tab:'lint', text:b.dataset.lintExample})));

    document.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) {
        const row = event.target.closest('tr[data-record]');
        if (row) openDetails(row.dataset.record);
        return;
      }
      if (button.hasAttribute('data-record')) openDetails(button.dataset.record);
      else if (button.hasAttribute('data-company')) update({company:button.dataset.company, tab:'all', category:''}, true);
      else if (button.hasAttribute('data-category')) { const c = button.dataset.category; update({category: c && c === state.category ? '' : c, tab: state.tab === 'lint' ? 'all' : state.tab}); }  // 再点一次已选领域即取消；在标题体检页点领域则回到名单浏览
      else if (button.hasAttribute('data-tab')) update({tab:button.dataset.tab});
      else if (button.hasAttribute('data-example')) { state.exact = false; search(button.dataset.example, true); }
      else if (button.id === 'search-button') search($('search').value, true);
      else if (button.id === 'empty-scope') search($('search').value, true);
      else if (button.hasAttribute('data-clear')) update({[button.dataset.clear]:defaults[button.dataset.clear]});
      else if (button.hasAttribute('data-page')) update({page:Number(button.dataset.page)},true);
      else if (button.id === 'close-detail') closeDetails();
      else if (button.classList.contains('close-dialog')) button.closest('dialog').close();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target.matches('tr[data-record]')) openDetails(event.target.dataset.record);
    });
    document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();openId=null;update({...defaults});renderDetails();});
    document.querySelector('th[data-sort="name"]').addEventListener('click',()=>{
      const next = sortOrders[(sortOrders.indexOf(state.sort)+1)%sortOrders.length];
      update({sort:next});
    });
    $('search').addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(()=>search($('search').value),180);});
    $('search').addEventListener('keydown',event=>{if(event.key==='Enter')search($('search').value,true);else if(event.key==='Escape'&&$('search').value){event.preventDefault();$('search').value='';update({q:''});}});
    $('exact-match').addEventListener('change',()=>update({q:$('search').value.slice(0,500),exact:$('exact-match').checked}));
    for (const key of ['company','label']) $(key+'-filter').addEventListener('change',()=>update({[key]:$(key+'-filter').value}));
    for (const id of ['reset-button','empty-reset']) $(id).addEventListener('click',()=>update({...defaults}));
    $('previous-page').addEventListener('click',()=>update({page:state.page-1},true));
    $('next-page').addEventListener('click',()=>update({page:state.page+1},true));
    for(const id of ['about-button','footer-about']) $(id).addEventListener('click',()=>$('about-dialog').showModal());
    document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();}}));
    $('tabs').addEventListener('keydown',event=>{
      const tabs=[...document.querySelectorAll('[data-tab]')];
      const index=tabs.indexOf(document.activeElement);
      if(index<0 || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
      update({tab:tabs[next].dataset.tab});tabs[next].focus();
    });
    document.addEventListener('keydown',event=>{
      if(event.key==='/' && !event.ctrlKey && !event.metaKey && state.tab!=='lint' && !['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName) && !document.querySelector('dialog[open]')){event.preventDefault();$('search').focus();}
      else if(event.key==='Escape' && openId && !document.querySelector('dialog[open]') && document.activeElement !== $('search')) closeDetails();
    });
    window.addEventListener('resize', moveIndicator);
    window.addEventListener('hashchange',()=>{readHash();render();renderDetails();});
    readHash();render();renderDetails();
  }
  init();
})();
