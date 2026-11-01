/* Offline reference browser. No remote requests or persistent search history. */
(() => {
  'use strict';
  const DB = JSON.parse(document.getElementById('risk-data').textContent);
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
  const byId = new Map(records.map(r => [r.id, r]));
  const categories = localeSort(unique(records.map(r => r.category)));
  const companies = localeSort(unique(records.flatMap(r => r.companies)));
  const labels = localeSort(unique(records.flatMap(r => r.labels)));
  const tabNames = {all:'全部名单', registered:'登记作品', company:'公司关联'};
  const inTab = (r, tab) => tab === 'registered' ? r.object_type === '登记作品' :
    tab === 'company' ? r.companies.length > 0 || r.object_type === '公司名称' : true;
  const defaults = {q:'', category:'', company:'', label:'', tab:'all', exact:false, sort:'default', page:1};
  let state = {...defaults};
  let results = [];
  let debounce, toastTimer;
  const pageSize = 20;

  function highlight(value) {
    const text = String(value ?? '');
    const terms = unique(state.q.trim().split(/\s+/).filter(Boolean)).sort((a,b) => b.length-a.length);
    if (!terms.length) return esc(text);
    const expression = new RegExp('(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'giu');
    return text.split(expression).map((part, i) => i % 2 ? `<mark>${esc(part)}</mark>` : esc(part)).join('');
  }

  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    state = {...defaults};
    state.q = (params.get('q') || '').slice(0, 500);
    for (const [key, allowed] of Object.entries({category:categories, company:companies, label:labels,
      tab:Object.keys(tabNames), sort:['default','name']})) {
      if (allowed.includes(params.get(key))) state[key] = params.get(key);
    }
    state.exact = params.get('exact') === '1';
    const page = Number(params.get('page'));
    if (Number.isSafeInteger(page) && page > 0) state.page = page;
  }

  function saveHash() {
    const params = new URLSearchParams();
    Object.keys(defaults).forEach(key => {
      if (state[key] !== defaults[key]) params.set(key, key === 'exact' ? '1' : String(state[key]));
    });
    const hash = params.toString();
    // File URLs support a fragment even on browsers that restrict History API.
    try { history.replaceState(null, '', location.pathname + location.search + (hash ? '#' + hash : '')); }
    catch (_) { if (location.hash.slice(1) !== hash) location.replace('#' + hash); }
  }

  function syncControls() {
    $('search').value = state.q;
    $('exact-match').checked = state.exact;
    for (const key of ['company','label']) $(key + '-filter').value = state[key];
    $('sort-order').value = state.sort;
    document.querySelectorAll('[data-category]').forEach(button => {
      const active = button.dataset.category === state.category;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-tab]').forEach(button => {
      const active = button.dataset.tab === state.tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
  }

  function render() {
    clearTimeout(debounce);
    const query = norm(state.q), terms = query.split(' ').filter(Boolean);
    results = records.filter(r => inTab(r, state.tab) && (!state.category || r.category === state.category) &&
      (!state.company || r.companies.includes(state.company)) && (!state.label || r.labels.includes(state.label)) &&
      (!query || (state.exact ? r.exact.includes(query) : terms.every(term => r.haystack.includes(term)))));
    if (state.sort === 'name') results.sort((a,b) => a.name.localeCompare(b.name, 'zh-CN'));
    else if (query) results.sort((a,b) => Number(b.exact.includes(query))-Number(a.exact.includes(query)) || a.id.localeCompare(b.id));
    const pages = Math.max(1, Math.ceil(results.length/pageSize));
    state.page = Math.min(state.page, pages);
    syncControls();
    saveHash();
    $('breadcrumb-current').textContent = state.category || tabNames[state.tab];
    $('results-title').textContent = state.category || tabNames[state.tab];
    $('result-count').textContent = `找到 ${num(results.length)} 条 · 共 ${num(records.length)} 条资料`;
    $('empty-state').hidden = results.length > 0;
    document.querySelector('.table-wrap').hidden = results.length === 0;
    const shown = results.slice((state.page-1)*pageSize, state.page*pageSize);
    $('results-body').innerHTML = shown.map(r => {
      const note = r.companies.join('、') || r.object_type || '名称线索';
      return `<tr class="record-row" data-record="${esc(r.id)}"><td><button class="record-open" data-record="${esc(r.id)}">${highlight(r.name)}</button><div class="record-subtitle"><span title="${esc(note)}">${esc(note)}</span></div></td>
        <td data-label="产品领域"><span class="category-tag">${esc(r.category)}</span></td>
        <td data-label="风险标签">${r.labels.length ? r.labels.map(label => `<span class="risk-tag${label.includes('登记') ? ' neutral' : ''}">${highlight(label)}</span>`).join('') : `<span class="risk-tag neutral">${r.registrations.length ? '附登记资料' : '待核对线索'}</span>`}</td>
        <td><button class="view-button" data-record="${esc(r.id)}" aria-label="查看${esc(r.name)}详情">${icon('chevron')}</button></td></tr>`;
    }).join('');
    const chips = [];
    for (const [key, prefix] of [['q','搜索'],['category','领域'],['company','公司'],['label','标签']]) {
      if (state[key]) chips.push(`<button class="active-filter" data-clear="${key}" aria-label="移除${prefix}筛选">${prefix}：${esc(state[key])}${icon('close')}</button>`);
    }
    if (state.exact) chips.push(`<button class="active-filter" data-clear="exact">精确匹配${icon('close')}</button>`);
    $('active-filters').innerHTML = chips.join('');
    $('active-filters').hidden = !chips.length;
    $('page-description').textContent = results.length ? `第 ${num((state.page-1)*pageSize+1)}–${num(Math.min(state.page*pageSize,results.length))} 条 / 共 ${num(results.length)} 条` : '暂无结果';
    $('previous-page').disabled = state.page <= 1;
    $('next-page').disabled = state.page >= pages;
    const numbers = unique([1, state.page-1, state.page, state.page+1, pages].filter(n => n >= 1 && n <= pages)).sort((a,b) => a-b);
    $('page-buttons').innerHTML = numbers.map((n,i) => (i && n-numbers[i-1]>1 ? '<span class="page-dots">…</span>' : '') + `<button class="page-number${n===state.page?' current':''}" data-page="${n}" ${n===state.page?'aria-current="page"':''} aria-label="第${n}页">${n}</button>`).join('');
  }

  function update(changes, scroll=false) {
    state = {...state, page:1, ...changes};
    render();
    if (scroll) $('results-title').scrollIntoView({block:'start', behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }

  function openDetails(id) {
    const r = byId.get(id);
    if (!r) return;
    $('detail-meta').textContent = r.object_type || '名称线索';
    $('detail-name').textContent = r.name;
    const field = (title, value) => `<dt>${esc(title)}</dt><dd>${esc(value || '未提供')}</dd>`;
    const related = r.names.filter(name => name !== r.name);
    $('detail-content').innerHTML = `<div class="detail-callout">历史风险线索 · 未外部核验<br>请核对实际内容与转售授权。收录不表示该主体存在违法行为。</div>
      <dl class="detail-dl">${field('产品领域',r.category)}${field('关联公司',r.companies.join('、'))}${field('风险标签',r.labels.join('；'))}${related.length?field('名称变体',related.join('；')):''}</dl>
      ${r.registrations.length?`<h3 class="detail-section-title">作品登记号 <small>${r.registrations.length}</small></h3><ul class="registration-list">${r.registrations.map(reg => `<li>${esc(reg)}</li>`).join('')}</ul>`:''}`;
    $('detail-dialog').showModal();
    $('detail-dialog').scrollTop = 0;
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('visible');
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3500);
  }

  function init() {
    $('total-stat').textContent = num(records.length);
    $('all-count').textContent = num(records.length);
    $('category-stat').textContent = categories.length;
    const companyNames = unique([...companies,...records.filter(r=>r.object_type==='公司名称').map(r=>r.name)]);
    $('company-stat').textContent = companyNames.length;
    for (const id of ['snapshot-date','footer-date','about-date']) $(id).textContent = updatedAt;
    $('category-list').innerHTML = categories.map(category=>`<button class="category-item${category.includes('待')?' pending':''}" data-category="${esc(category)}"><span>${esc(category)}</span><b>${num(records.filter(r=>r.category===category).length)}</b></button>`).join('');
    for (const [id, values] of [['company-filter',companies],['label-filter',labels]]) {
      $(id).insertAdjacentHTML('beforeend', values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join(''));
    }
    for (const tab of Object.keys(tabNames)) $(`tab-${tab}`).querySelector('span').textContent = num(records.filter(r=>inTab(r,tab)).length);
    document.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) { const row = event.target.closest('tr[data-record]'); if (row) openDetails(row.dataset.record); return; }
      if (button.hasAttribute('data-record')) openDetails(button.dataset.record);
      else if (button.hasAttribute('data-category')) {
        update({category:button.dataset.category});
        document.querySelector('.sidebar').classList.remove('categories-open');
        $('mobile-categories').setAttribute('aria-expanded','false');
      }
      else if (button.hasAttribute('data-tab')) update({tab:button.dataset.tab});
      else if (button.hasAttribute('data-example')) update({q:button.dataset.example, exact:false}, true);
      else if (button.hasAttribute('data-clear')) update({[button.dataset.clear]:defaults[button.dataset.clear]});
      else if (button.hasAttribute('data-page')) update({page:Number(button.dataset.page)},true);
      else if (button.classList.contains('close-dialog')) button.closest('dialog').close();
    });
    document.querySelector('.brand').addEventListener('click',event=>{event.preventDefault();update({...defaults});});
    $('search').addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(()=>update({q:$('search').value.slice(0,500)}),180);});
    $('search').addEventListener('keydown',event=>{if(event.key==='Enter')update({q:$('search').value.slice(0,500)},true);else if(event.key==='Escape'&&$('search').value){event.preventDefault();$('search').value='';update({q:''});}});
    $('search-button').addEventListener('click',()=>update({q:$('search').value.slice(0,500)},true));
    $('exact-match').addEventListener('change',()=>update({q:$('search').value.slice(0,500),exact:$('exact-match').checked}));
    for (const key of ['company','label']) $(key+'-filter').addEventListener('change',()=>update({[key]:$(key+'-filter').value}));
    $('sort-order').addEventListener('change',()=>update({sort:$('sort-order').value}));
    for (const id of ['reset-button','empty-reset']) $(id).addEventListener('click',()=>update({...defaults}));
    $('previous-page').addEventListener('click',()=>update({page:state.page-1},true));
    $('next-page').addEventListener('click',()=>update({page:state.page+1},true));
    for(const id of ['about-button','footer-about']) $(id).addEventListener('click',()=>$('about-dialog').showModal());
    $('mobile-categories').addEventListener('click',()=>{
      const open=document.querySelector('.sidebar').classList.toggle('categories-open');
      $('mobile-categories').setAttribute('aria-expanded',String(open));
    });
    document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();}}));
    document.querySelector('.workspace-tabs').addEventListener('keydown',event=>{
      const tabs=[...document.querySelectorAll('[data-tab]')];
      const index=tabs.indexOf(document.activeElement);
      if(index<0 || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
      update({tab:tabs[next].dataset.tab});tabs[next].focus();
    });
    document.addEventListener('keydown',event=>{
      if(event.key==='/' && !event.ctrlKey && !event.metaKey && !['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName) && !document.querySelector('dialog[open]')){event.preventDefault();$('search').focus();}
    });
    window.addEventListener('hashchange',()=>{readHash();render();});
    readHash();render();
  }
  init();
})();
