(() => {
  'use strict';
  const asset = (name) => `assets/${name}.webp`;
  const icon = (name, cls = '') => `<svg class="a-icon ${cls}" aria-hidden="true"><use href="#a-${name}"/></svg>`;
  const categories = [
    { id: 'regret', name: '遗憾 · 愤怒', caption: '把没说出口的，也好好安放。' },
    { id: 'joy', name: '心动 · 兴奋', caption: '有些瞬间，想起来仍然会发光。' },
    { id: 'weary', name: '怅然 · 倦怠', caption: '允许自己慢一点，再慢一点。' },
    { id: 'calm', name: '平静 · 满足', caption: '平凡的日常，也有自己的温柔。' },
  ];
  // Fictional records for the design demonstration. Tags reference the same record.
  const seeds = [
    { id: 'rain', title: '九月的第一场雨', date: '3050-09-01', time: '08:06', image: 'memory-rain', tags: ['regret', 'weary'], duration: '长期记忆', body: '下雨了，索性绕了一点远路。\n雨滴在水面画出一圈又一圈，落叶慢慢漂过脚边。那些没能说好的话，今天先交给这场雨。', location: '回家的路上' },
    { id: 'coffee', title: '开启奇妙的一天', date: '3050-09-01', time: '07:30', image: 'memory-coffee', tags: ['joy', 'calm'], duration: '永久典藏', body: '出门前买了两杯咖啡，熟悉的香气让清晨变得具体。\n原来新的一天，可以从这么小的一件事开始期待。', location: '街角咖啡店' },
    { id: 'flower', title: '楼下的桂花开了', date: '3050-09-01', time: '08:30', image: 'memory-flower', tags: ['calm'], duration: '短期记忆', expires: '3 天后', body: '走出楼道的一瞬间闻到了桂花香。\n抬头才发现，小小的花已经藏满枝头。今天特意停下来，看了一会儿。', location: '楼下', },
    { id: 'dinner', title: '热腾腾的一次相聚', date: '3050-08-31', time: '19:30', image: 'memory-dinner', tags: ['joy', 'calm'], duration: '永久典藏', body: '和朋友吃了顿火锅，聊了很久。\n汤底咕嘟咕嘟地响，话题从近况绕到了好多年前。被记得，是一件温暖的事。', location: '和朋友在一起' },
    { id: 'station', title: '站台上的告别', date: '3050-08-30', time: '16:20', image: 'memory-station', tags: ['regret', 'weary'], duration: '短期记忆', expires: '1 天后', body: '列车开动的时候，还有一句话没来得及说。\n隔着玻璃挥了挥手，希望下一次见面，能把故事好好讲完。', location: '车站' },
    { id: 'sunset', title: '晚霞替今天收了尾', date: '3050-08-30', time: '18:40', image: 'memory-sunset', tags: ['joy', 'calm'], duration: '长期记忆', body: '原本只想快点回家，却被天边的颜色留住了。\n没有特别发生什么的一天，也有值得记下来的结尾。', location: '下班路上' },
    { id: 'letter', title: '一封还没有寄出的信', date: '3050-08-29', time: '21:00', image: null, tags: ['regret', 'joy'], duration: '短期记忆', expires: '2 天后', body: '写下了很久没有说出口的谢谢。\n有些心动和遗憾可以同时存在，先把它们放在这里，等一个合适的时刻。', location: '书桌前' },
    { id: 'unnamed', title: '一个还没命名的瞬间', date: '3050-08-28', time: '18:45', image: null, tags: [], duration: '长期记忆', body: '今天的心情还说不清楚。\n不用急着给它分类，能记住这个瞬间，就已经很好了。', location: '此刻' },
  ];
  const store = window.MemoryStore;
  store.init(seeds);
  let memories = store.list();
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  function folderImages(category) {
    const seen = new Set();
    return memories.filter(memory => memory.tags.includes(category)).flatMap(memory => {
      const cover = store.cover(memory);
      if (!cover || seen.has(cover.src)) return [];
      seen.add(cover.src);
      return [{ memoryId: memory.id, ...cover }];
    }).slice(0, 3);
  }
  function folderPhotosHTML(images) {
    return images.map((image, index) => `<span class="folder-photo" data-memory-id="${escapeHTML(image.memoryId)}" data-image-id="${escapeHTML(image.id)}" style="--photo-order:${index}"><img src="${escapeHTML(image.src)}" alt="" draggable="false" decoding="async"/></span>`).join('');
  }
  function folderBackHTML(id) {
    return `<svg class="folder-back" viewBox="0 0 650 620" aria-hidden="true"><defs><linearGradient id="folder-back-${id}" x1="0" y1="0" x2="1" y2=".65"><stop stop-color="#6352b5"/><stop offset=".52" stop-color="#586dc0"/><stop offset="1" stop-color="#3d356b"/></linearGradient></defs><path d="M58 108H157C182 108 191 115 202 136L211 153C220 171 232 178 253 178H592Q636 178 636 222V543Q636 589 590 589H60Q14 589 14 543V154Q14 108 58 108Z" fill="url(#folder-back-${id})" stroke="#d2d3f8" stroke-opacity=".72" stroke-width="2"/></svg>`;
  }
  const state = { tab: 'view', category: null, query: '', date: 1, calendarDate: '3050-09-01', calendarMonth: '3050-09', auxiliary: false, night: false, playing: false, brightness: 68, volume: 38, scroll: 0, lastFolder: null };
  const tabNames = { view: '查看', edit: '编辑', ai: '小忆', profile: '我的' };
  const reduced = window.ArchivePreferences.motion;
  let toastTimer, activeAnimation, lastDetailTrigger, currentMemoryId, currentMemoryRevision;

  const symbols = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  symbols.setAttribute('class', 'svg-defs'); symbols.setAttribute('aria-hidden', 'true');
  symbols.innerHTML = `<symbol id="a-back" viewBox="0 0 24 24"><path d="M20 12H4m7-7-7 7 7 7"/></symbol>
    <symbol id="a-arrow" viewBox="0 0 24 24"><path d="M4 12h16m-7-7 7 7-7 7"/></symbol>
    <symbol id="a-close" viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6"/></symbol>
    <symbol id="a-search" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></symbol>
    <symbol id="a-plus" viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></symbol>
    <symbol id="a-stack" viewBox="0 0 24 24"><path d="M3 4h12v11H3zM9 9h12v11H9z"/></symbol>
    <symbol id="a-moon" viewBox="0 0 24 24"><path d="M20.4 15.4A9 9 0 0 1 8.6 3.6 9 9 0 1 0 20.4 15.4Z"/></symbol>
    <symbol id="a-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></symbol>
    <symbol id="a-volume" viewBox="0 0 24 24"><path d="M3 9h4l5-4v14l-5-4H3V9Zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></symbol>
    <symbol id="a-play" viewBox="0 0 24 24"><path d="m7 3 15 9-15 9Z" fill="currentColor" stroke="none"/></symbol>
    <symbol id="a-pause" viewBox="0 0 24 24"><path d="M7 4v16M17 4v16" stroke-width="4"/></symbol>
    <symbol id="a-prev" viewBox="0 0 24 24"><path d="m12 5-10 7 10 7V5Zm10 0-10 7 10 7V5Z" fill="currentColor" stroke="none"/></symbol>
    <symbol id="a-next" viewBox="0 0 24 24"><path d="m2 5 10 7-10 7V5Zm10 0 10 7-10 7V5Z" fill="currentColor" stroke="none"/></symbol>
    <symbol id="a-folder" viewBox="0 0 24 24"><path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z"/></symbol>
    <symbol id="a-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 6v7m0 4v.1"/></symbol>
    <symbol id="a-exit" viewBox="0 0 24 24"><path d="M10 4H5v16h5m4-13 5 5-5 5m-5-5h10"/></symbol>
    <symbol id="a-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></symbol>
    <symbol id="a-pin" viewBox="0 0 24 24"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/></symbol>
    <symbol id="a-text" viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></symbol>
    <symbol id="a-mic" viewBox="0 0 24 24"><rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></symbol>
    <symbol id="a-message" viewBox="0 0 24 24"><path d="M4 4h16v13H9l-5 4V4Zm4 4h8m-8 4h6"/></symbol>
    <symbol id="a-image" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="2"/><path d="m4 19 6-7 4 4 3-4 4 5"/></symbol>
    <symbol id="a-scan" viewBox="0 0 24 24"><path d="M8 3H4v5m12-5h4v5M4 16v5h4m12-5v5h-4M7 12h10m-5-5v10"/></symbol>`;
  document.body.appendChild(symbols);

  const archive = document.createElement('section');
  archive.id = 'archive'; archive.className = 'scene archive-scene'; archive.inert = true;
  archive.setAttribute('aria-hidden', 'true'); archive.setAttribute('aria-label', '记忆档案馆内部');
  archive.innerHTML = `
    <div class="archive-shell">
      <section class="archive-primary">
        <header class="archive-topbar"><div class="archive-wordmark"><img src="${asset('logo')}" alt=""/><span>记忆档案馆<small>ARCHIVE OF MEMORIES</small></span></div><div class="archive-top-actions"><span class="archive-demo">演示档案</span><button class="a-icon-button" id="archive-exit" type="button" aria-label="返回欢迎页" data-tip="返回欢迎页">${icon('exit')}</button></div></header>
        <div class="archive-body" id="archive-body">
          <section class="archive-pane" id="pane-view" aria-label="查看记忆">
            <div class="folder-home" id="folder-home"><h1 class="sr-only" tabindex="-1">按心情查看记忆</h1>
              <div class="folder-grid">${categories.map((cat, i) => `<button type="button" class="folder-card" data-category="${cat.id}" style="--folder-order:${i}" aria-label="打开${cat.name.replaceAll(' ', '')}文件夹">${folderBackHTML(cat.id)}<span class="folder-photos" aria-hidden="true">${folderPhotosHTML(folderImages(cat.id))}</span><span class="folder-front"><span class="folder-name">${cat.name}</span><span class="folder-meta">${memories.filter(m => m.tags.includes(cat.id)).length} 段记忆 <span>↗</span></span></span></button>`).join('')}</div>
              <div class="folder-utilities"><span>给每一种心情，一个安放的地方</span><div><button type="button" data-category="all">全部记忆 <b>${memories.length}</b></button><i></i><button type="button" data-category="unfiled">未分类 <b>${memories.filter(m => !m.tags.length).length}</b></button></div></div>
            </div>
            <div class="memory-browser" id="memory-browser" hidden><div class="memory-browser-heading"><button class="a-icon-button" id="folders-back" type="button" aria-label="返回情绪分类" data-tip="返回情绪分类">${icon('back')}</button><div><h1 id="category-title" tabindex="-1"></h1><p id="category-subtitle"></p></div><label class="memory-search">${icon('search')}<input id="memory-search" type="search" placeholder="在记忆里找一找" aria-label="搜索当前分类的记忆" autocomplete="off"/></label></div><div class="memory-list-scroll" id="memory-list-scroll"><div class="memory-grid" id="memory-grid"></div><div class="memory-empty" id="memory-empty" hidden>${icon('folder')}<h2>这里暂时很安静</h2><p id="empty-message"></p><button class="a-soft-button" id="empty-action" type="button">记录一段记忆 ${icon('plus')}</button></div></div><p class="memory-count-note" id="memory-count-note"></p></div>
          </section>
          <section class="archive-pane secondary-pane" id="pane-edit" aria-label="编辑记忆" hidden><div class="module-heading"><div><p class="a-eyebrow">WRITE YOUR MOMENTS</p><h1 tabindex="-1">把今天，写成故事</h1><p>新的片段，和那些想再补上一句的往事。</p></div><button class="a-soft-button" id="new-memory" type="button">${icon('plus')} 新增记忆</button></div><div class="editor-section-label"><span>最近记录</span><span>选择一段记忆，回到那个瞬间</span></div><div class="edit-timeline" id="edit-timeline"></div><p class="module-scope">这里先展示记录入口，完整的新增与编辑页面将在下一阶段展开。</p></section>
          <section class="archive-pane secondary-pane ai-pane" id="pane-ai" aria-label="小忆助手" hidden><div class="module-heading"><div><p class="a-eyebrow">YOUR MEMORY COMPANION</p><h1 tabindex="-1">你好，我是小忆</h1><p>陪你记得，也陪你重新发现。</p></div><span class="a-preview-badge">功能预览</span></div><div class="assistant-stage"><div class="assistant-glow"></div><img src="${asset('assistant')}" alt="小忆助手" draggable="false"/></div><div class="assistant-actions">${[['mic','语音聊天','听你说说今天'],['message','文字聊天','慢慢整理心绪'],['image','生成图片','让记忆有了画面'],['scan','拍照检索','找回熟悉的瞬间']].map(([ico,name,copy])=>`<button class="assistant-action" type="button" data-ai="${name}">${icon(ico)}<span>${name}<small>${copy}</small></span>${icon('arrow')}</button>`).join('')}</div><p class="module-scope">先认识小忆的四种陪伴方式，语音与智能服务将在后续接入。</p></section>
          <section class="archive-pane secondary-pane" id="pane-profile" aria-label="我的档案" hidden><div class="profile-hero"><img src="${asset('avatar')}" alt="档案头像"/><div><p class="a-eyebrow">MY LITTLE UNIVERSE</p><h1 tabindex="-1">记忆旅人</h1><p>把日常碎片存进岁月里。</p></div><button class="a-soft-button" type="button" data-profile="编辑资料">编辑资料</button></div><div class="profile-stats"><div><span>记忆总数</span><strong>${memories.length}</strong></div><div><span>情绪分类</span><strong>4</strong></div><div><span>永久典藏</span><strong>${memories.filter(m=>m.duration==='永久典藏').length}</strong></div><div><span>待分类记忆</span><strong>${memories.filter(m=>!m.tags.length).length}</strong></div></div><div class="profile-collections">${[['time','时光卷宗'],['growth','成长档案室'],['mood','情绪寄存馆'],['private','独家珍藏馆']].map(([a,t])=>`<button type="button" data-profile="${t}"><img src="${asset('collection-'+a)}" alt=""/><span>${t}</span></button>`).join('')}</div><div class="profile-subheading"><h2>成就徽章</h2><span>每一次记录，都有意义</span></div><div class="profile-badges">${[['archive','日常收藏家'],['year','时光记录官'],['private','心事守护者']].map(([a,t])=>`<button type="button" data-profile="${t}"><img src="${asset('badge-'+a)}" alt=""/><span>${t}</span></button>`).join('')}</div><p class="module-scope">展示资料与徽章为演示内容；个人设置将在后续完善。</p></section>
        </div>
        <nav class="archive-dock" aria-label="档案馆主导航"><div class="dock-indicator-cell" aria-hidden="true"><span></span></div>${Object.entries(tabNames).map(([key,name])=>`<button type="button" data-tab="${key}" ${key==='view'?'aria-current="page"':''} aria-controls="pane-${key}"><img src="${asset('nav-'+key)}" alt="" draggable="false"/><span>${name}</span></button>`).join('')}</nav>
      </section>
      <aside class="archive-rail" id="archive-rail" aria-label="日历与环境控制">
        <section class="calendar-card"><h2>September <span>3050</span></h2><div class="calendar-weekdays" aria-hidden="true">${['MON','TUE','WED','THU','FRI','SAT','SUN'].map(d=>`<span>${d}</span>`).join('')}</div><div class="calendar-days" id="calendar-days" role="group" aria-label="3050 年 9 月，选择日期"></div></section>
        <section class="environment-controls" aria-label="环境控制"><div class="environment-buttons"><div class="environment-switches"><button type="button" class="environment-switch" id="aux-switch" role="switch" aria-checked="false" aria-label="辅助开关" data-tip="辅助开关 · 关">${icon('stack')}</button><button type="button" class="environment-switch" id="night-switch" role="switch" aria-checked="false" aria-label="夜间模式预览" data-tip="夜间模式 · 关">${icon('moon')}</button></div><div class="music-controls"><button type="button" id="music-prev" aria-label="上一曲" data-tip="上一曲">${icon('prev')}</button><button type="button" id="music-play" aria-label="播放背景音乐预览" aria-pressed="false" data-tip="播放 · 交互预览">${icon('play')}</button><button type="button" id="music-next" aria-label="下一曲" data-tip="下一曲">${icon('next')}</button></div><p class="audio-caption" id="audio-caption">给回忆一点留白</p></div>${[['brightness','亮度','sun',68],['volume','音量','volume',38]].map(([id,label,ico,value])=>`<div class="slider-column"><div class="vertical-slider" id="${id}-control" style="--fill:${value/100}"><span class="slider-fill" aria-hidden="true"></span><input type="range" id="archive-${id}" min="0" max="100" step="1" value="${value}" aria-label="${label}预览" aria-valuetext="${value}%"/>${icon(ico)}<output for="archive-${id}">${value}%</output></div><span class="slider-caption">${label}</span></div>`).join('')}</section>
        <button class="monthly-card" type="button" id="monthly-card">${icon('folder')}<span>本月记忆已存档<small>${memories.filter(m=>m.date.startsWith('3050-09')).length} 条记忆</small></span>${icon('arrow','monthly-arrow')}</button>
        <button class="expiry-notice" type="button" id="expiry-notice">${icon('info')}<span>${memories.filter(m=>m.expires).length} 条短期记忆即将到期</span>${icon('arrow')}</button>
      </aside>
      <aside class="archive-context-rail" id="archive-context-rail" hidden></aside>
    </div>
    <div class="archive-toast" id="archive-toast" role="status" aria-live="polite"><span></span><button type="button" aria-label="关闭提示">${icon('close')}</button></div>`;
  document.querySelector('.stage').appendChild(archive);

  const detail = document.createElement('dialog');
  detail.className = 'memory-dialog'; detail.id = 'memory-detail';
  detail.setAttribute('aria-labelledby', 'memory-detail-title');
  detail.innerHTML = `<button class="a-icon-button memory-detail-close" type="button" aria-label="关闭记忆详情">${icon('close')}</button><div class="memory-detail-visual"></div><div class="memory-detail-copy"><div class="memory-detail-reading" tabindex="0" aria-label="记忆内容，可滚动阅读"><p class="a-eyebrow">A MOMENT TO KEEP</p><h2 id="memory-detail-title" tabindex="-1"></h2><p class="memory-detail-time"></p><p class="memory-detail-body"></p><div class="memory-detail-tags"></div></div><div class="memory-detail-footer"><span></span><button class="a-soft-button" type="button" id="memory-detail-done">返回记忆列表 ${icon('back')}</button></div></div>`;
  document.body.appendChild(detail);

  const byId = (id) => document.getElementById(id);
  archive.querySelector('.folder-grid').addEventListener('error', event => {
    if (event.target.matches('.folder-photo img')) event.target.parentElement.hidden = true;
  }, true);
  byId('memory-count-note').setAttribute('role','status');
  const info = (title, body, button = '知道了') => document.dispatchEvent(new CustomEvent('archive:info', { detail: { title, body, button } }));
  const toastAction = document.createElement('button');
  toastAction.id = 'archive-toast-action'; toastAction.type = 'button'; toastAction.hidden = true;
  byId('archive-toast').insertBefore(toastAction, byId('archive-toast').lastElementChild);
  function toast(message, action = null) {
    clearTimeout(toastTimer);
    const element = byId('archive-toast'); element.querySelector('span').textContent = message;
    toastAction.hidden = !action; toastAction.textContent = action?.label || '';
    toastAction.onclick = action ? () => { element.classList.remove('is-visible'); action.run(); } : null;
    element.classList.add('is-visible');
    toastTimer = setTimeout(() => element.classList.remove('is-visible'), action ? 9000 : 4200);
  }
  byId('archive-toast').lastElementChild.addEventListener('click', () => byId('archive-toast').classList.remove('is-visible'));
  function animatePane(element) {
    activeAnimation?.cancel();
    if (reduced.matches) return;
    activeAnimation = element.animate([{ opacity: 0, transform: 'translateY(9px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 350, easing: 'cubic-bezier(.22,1,.36,1)' });
  }
  function writeRoute() {
    if (byId('experience').dataset.scene !== 'archive') return;
    const suffix = state.tab === 'view' && state.category ? `/${state.category}` : '';
    try { history.replaceState(null, '', state.tab==='profile'&&window.MemoryProfile?window.MemoryProfile.route():`#archive/${state.tab}${suffix}`); } catch { /* local preview */ }
  }
  function tagHTML(tags) { return tags.map(id=>`<span class="memory-tag">${categories.find(c=>c.id===id).name}</span>`).join(''); }
  function memoryCard(memory) {
    const cover=store.cover(memory);
    return `<button class="memory-card" type="button" data-memory="${escapeHTML(memory.id)}" aria-label="查看记忆：${escapeHTML(memory.title)}"><div class="memory-card-image">${cover?`<img src="${escapeHTML(cover.src)}" alt="${escapeHTML(memory.title)}" loading="lazy"/>`:`<div class="text-memory-art">${icon('text')}<span>写给时光的一小段话</span></div>`}<span class="memory-duration ${store.expired(memory)?'is-expired':''}" data-remaining="${escapeHTML(memory.id)}">${store.remaining(memory)}</span></div><div class="memory-card-copy"><p>${memory.date.replaceAll('-','.')} <span>${memory.time}</span></p><h2>${escapeHTML(memory.title)}</h2><div class="memory-card-tags">${tagHTML(memory.tags)}</div></div><span class="memory-card-arrow">${icon('arrow')}</span></button>`;
  }
  function getCategoryRecords() {
    if (state.category==='all' || !state.category) return memories;
    if (state.category==='unfiled') return memories.filter(m=>!m.tags.length);
    return memories.filter(m=>m.tags.includes(state.category));
  }
  function renderList() {
    const matches = getCategoryRecords().filter(m=>`${m.title} ${m.body} ${m.date} ${m.tags.map(id=>categories.find(c=>c.id===id).name).join(' ')}`.toLocaleLowerCase().includes(state.query.toLocaleLowerCase()));
    byId('memory-grid').innerHTML=matches.map(memoryCard).join('');
    byId('memory-empty').hidden=matches.length>0;
    byId('empty-message').textContent=state.query?'没有找到相符的记忆，换个词再试试。':'不必急着填满，新的故事会慢慢发生。';
    byId('empty-action').innerHTML=state.query?`清除搜索 ${icon('close')}`:`记录一段记忆 ${icon('plus')}`;
    byId('memory-count-note').textContent=`${matches.length} 段记忆${state.category==='all'?' · 同一条记忆只计算一次':' · 每一段记忆都可以拥有不止一种心情'}`;
    byId('memory-grid').querySelectorAll('[data-memory]').forEach(button=>button.addEventListener('click',()=>openMemory(button.dataset.memory,button)));
  }
  function openCategory(id, focus = true) {
    if (!['all','unfiled',...categories.map(c=>c.id)].includes(id)) return;
    state.category=id; state.query=''; state.scroll=0;
    const category=categories.find(c=>c.id===id);
    byId('category-title').textContent=category?.name||(id==='all'?'全部记忆':'未分类记忆');
    byId('category-subtitle').textContent=category?.caption||(id==='all'?'那些微小而珍贵的瞬间，都在这里。':'先记下来，心情可以慢慢理解。');
    byId('folder-home').hidden=true; byId('memory-browser').hidden=false;
    byId('memory-search').value=''; renderList();
    byId('memory-list-scroll').scrollTop=0; animatePane(byId('memory-browser')); writeRoute();
    if(focus)byId('category-title').focus({preventScroll:true});
  }
  function returnFolders() {
    state.category=null; state.query='';
    byId('memory-browser').hidden=true; byId('folder-home').hidden=false;
    animatePane(byId('folder-home')); writeRoute();
    (state.lastFolder||archive.querySelector('.folder-card')).focus({preventScroll:true});
  }
  archive.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{state.lastFolder=button;openCategory(button.dataset.category);}));
  byId('folders-back').addEventListener('click',returnFolders);
  byId('memory-search').addEventListener('input',event=>{state.query=event.target.value;state.scroll=0;renderList();byId('memory-list-scroll').scrollTop=0;});
  byId('empty-action').addEventListener('click',()=>{if(state.query){state.query='';byId('memory-search').value='';renderList();byId('memory-search').focus();}else window.RecordEditor.openNew({category:state.category});});
  byId('memory-list-scroll').addEventListener('scroll',()=>{state.scroll=byId('memory-list-scroll').scrollTop;});

  function openMemory(id, trigger, backgroundRefresh = false) {
    const memory=store.find(id);if(!memory)return;
    const focusedAction=backgroundRefresh?document.activeElement?.dataset.detailAction:null;
    currentMemoryId=id;
    currentMemoryRevision=memory.revision;
    if(trigger)lastDetailTrigger=trigger;
    const cover=store.cover(memory);
    detail.querySelector('.memory-detail-visual').innerHTML=cover?`<img src="${escapeHTML(cover.src)}" alt="${escapeHTML(memory.title)}"/>`:`<div class="detail-text-art">${icon('text')}<p>有些心事<br/>写下来，就轻了一点。</p></div>`;
    byId('memory-detail-title').textContent=memory.title;
    byId('memory-detail-done').innerHTML=`${state.tab==='ai'?'返回小忆对话':state.tab==='profile'?'返回个人中心':'返回记忆列表'} ${icon('back')}`;
    detail.querySelector('.memory-detail-time').textContent=`${memory.date.replaceAll('-','.')} · ${memory.time}${memory.location?' · '+memory.location:''}${memory.scent?' · '+memory.scent:''}`;
    detail.querySelector('.memory-detail-body').textContent=memory.body;
    detail.querySelector('.memory-detail-tags').innerHTML=memory.tags.length?tagHTML(memory.tags):'<span class="memory-tag">尚未分类</span>';
    detail.querySelector('.memory-detail-footer > span').textContent=store.remaining(memory);
    detail.querySelector('.memory-detail-footer > span').dataset.remaining=id;
    window.RecordEditor?.decorateDetail(memory);
    window.MemoryProfile?.decorateDetail(memory);
    if(!backgroundRefresh)detail.querySelector('.memory-detail-reading').scrollTop=0;
    clearTimeout(detailCloseTimer); detail.classList.remove('is-closing');if(!detail.open)detail.showModal();
    if(!backgroundRefresh)byId('memory-detail-title').focus({preventScroll:true});
    else if(focusedAction&&!byId('record-confirm')?.open)detail.querySelector(`[data-detail-action="${focusedAction}"]`)?.focus({preventScroll:true});
  }
  function restoreDetailFocus() {
    const replacement=archive.querySelector(`[data-memory="${CSS.escape(currentMemoryId||'')}"]`)||archive.querySelector(`[data-open-record="${CSS.escape(currentMemoryId||'')}"]`);
    const aiReplacement=archive.querySelector('[data-ai-memory="'+CSS.escape(currentMemoryId||'')+'"]');
    const profileReplacement=archive.querySelector('[data-pf-memory="'+CSS.escape(currentMemoryId||'')+'"]');
    const profileHeading=byId('pf-gallery')?.hidden?'pf-title':'pf-gallery-title';
    const target=lastDetailTrigger?.isConnected?lastDetailTrigger:(state.tab==='profile'?profileReplacement:replacement||aiReplacement)||byId(state.tab==='profile'?profileHeading:state.tab==='ai'?'ai-input':state.tab==='edit'?'records-title':'category-title');
    target?.focus({preventScroll:true});
  }
  let detailCloseTimer;
  function closeDetail() {
    if(!detail.open||detail.classList.contains('is-closing'))return;
    detail.classList.add('is-closing');
    detailCloseTimer=setTimeout(()=>{detail.close();detail.classList.remove('is-closing');restoreDetailFocus();},reduced.matches?0:180);
  }
  detail.querySelector('.memory-detail-close').addEventListener('click',closeDetail);
  byId('memory-detail-done').addEventListener('click',closeDetail);
  detail.addEventListener('cancel',event=>{event.preventDefault();closeDetail();});
  detail.addEventListener('click',event=>{if(event.target!==detail)return;const r=detail.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDetail();});

  function contextRail(tab) {
    const contextual=tab==='ai'||tab==='profile';
    byId('archive-rail').hidden=contextual;byId('archive-context-rail').hidden=!contextual;
    if(!contextual)return;
    if(tab==='ai'&&window.MemoryAssistant){window.MemoryAssistant.renderRail();return;}
    if(tab==='profile'&&window.MemoryProfile){window.MemoryProfile.renderRail();return;}
    if(tab==='ai'){
      byId('archive-context-rail').innerHTML=`<div class="context-rail-heading"><span>此刻，与你一起</span><img src="${asset('nav-ai')}" alt=""/></div><div class="ai-welcome-message"><p>你好呀，记忆旅人。</p><p>可以和我聊聊今天，或一起找回某个藏在时间里的瞬间。</p><span>小忆 · 欢迎语</span></div><div class="context-quiet"><span>✧</span><p>每一段回忆<br/>都值得被认真听见。</p></div><button class="a-soft-button" type="button" id="ai-browse-memories">先看看我的记忆 ${icon('arrow')}</button><p class="context-footnote">当前为界面预览，尚未连接智能服务。</p>`;
      byId('ai-browse-memories').addEventListener('click',()=>{switchTab('view',false);openCategory('all');});
    } else {
      byId('archive-context-rail').innerHTML=`<h2 class="context-title">个人信息</h2><section class="context-card"><h3>基础资料</h3><dl><div><dt>档案名</dt><dd>记忆旅人</dd></div><div><dt>档案类型</dt><dd>演示档案</dd></div><div><dt>记忆总数</dt><dd>${memories.length} 段</dd></div></dl></section><section class="context-card"><h3>我的记忆</h3><p>这里展示的是设计演示内容，记忆按情绪标签整理。</p><p>多一种心情，不多计算一条记忆。</p></section><section class="context-card"><h3>档案设置</h3><button type="button" data-setting="隐私设置">隐私设置 ${icon('arrow')}</button><button type="button" data-setting="数据导出">数据导出 ${icon('arrow')}</button></section>`;
      byId('archive-context-rail').querySelectorAll('[data-setting]').forEach(b=>b.addEventListener('click',()=>info(b.dataset.setting,`${b.dataset.setting}将在个人档案页面完善时提供。\n记录与图片目前保存在本机浏览器，不会上传。`)));
    }
  }
  function switchTab(tab, focus = true) {
    if(!Object.hasOwn(tabNames,tab))return;
    if(window.RecordEditor?.isOpen()){
      if(tab===state.tab)return;
      window.RecordEditor.requestLeave(()=>switchTab(tab,focus));return;
    }
    const same=state.tab===tab;state.tab=tab;
    archive.querySelectorAll('.archive-pane').forEach(pane=>{pane.hidden=pane.id!==`pane-${tab}`;});
    archive.querySelectorAll('[data-tab]').forEach(button=>{if(button.dataset.tab===tab)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
    archive.style.setProperty('--tab-index',Object.keys(tabNames).indexOf(tab));
    if(!same)contextRail(tab);writeRoute();
    window.RecordEditor?.onTab(tab);
    window.MemoryAssistant?.onTab(tab);
    window.MemoryProfile?.onTab(tab);
    if(!same)animatePane(byId(`pane-${tab}`));
    if(tab==='view'&&state.category)byId('memory-list-scroll').scrollTop=state.scroll;
    if(focus&&!same){const title=tab==='profile'?byId(byId('pf-gallery')?.hidden?'pf-title':'pf-gallery-title'):tab==='view'&&state.category?byId('category-title'):byId(`pane-${tab}`).querySelector('h1');title?.focus({preventScroll:true});}
  }
  archive.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>switchTab(button.dataset.tab)));
  byId('archive-exit').addEventListener('click',()=>document.dispatchEvent(new CustomEvent('archive:exit')));

  const offset=(new Date(Date.UTC(3050,8,1)).getUTCDay()+6)%7;
  let days='';
  for(let i=0;i<Math.ceil((offset+30)/7)*7;i++){
    const day=i-offset+1;
    days+=day<1||day>30?`<span class="calendar-adjacent" aria-hidden="true">${day<1?31+day:day-30}</span>`:`<button type="button" data-day="${day}" class="${day===1?'is-selected':''}" aria-label="3050年9月${day}日" aria-pressed="${day===1}">${day}</button>`;
  }
  byId('calendar-days').innerHTML=days;
  byId('calendar-days').querySelectorAll('[data-day]').forEach(button=>button.addEventListener('click',()=>{
    state.date=Number(button.dataset.day);
    byId('calendar-days').querySelectorAll('button').forEach(b=>{const selected=b===button;b.classList.toggle('is-selected',selected);b.setAttribute('aria-pressed',String(selected));});
  }));
  [['aux-switch','auxiliary','辅助开关'],['night-switch','night','夜间模式']].forEach(([id,key,label])=>{
    byId(id).addEventListener('click',()=>{state[key]=!state[key];byId(id).setAttribute('aria-checked',String(state[key]));byId(id).dataset.tip=`${label} · ${state[key]?'开':'关'}`;});
  });
  byId('music-play').addEventListener('click',()=>{state.playing=!state.playing;const b=byId('music-play');b.innerHTML=icon(state.playing?'pause':'play');b.setAttribute('aria-pressed',String(state.playing));b.setAttribute('aria-label',state.playing?'暂停背景音乐预览':'播放背景音乐预览');b.dataset.tip=state.playing?'暂停 · 交互预览':'播放 · 交互预览';byId('audio-caption').textContent=state.playing?'播放状态预览 · 暂无音源':'给回忆一点留白';});
  byId('music-prev').addEventListener('click',()=>toast('上一曲 · 音乐素材将在后续加入'));
  byId('music-next').addEventListener('click',()=>toast('下一曲 · 音乐素材将在后续加入'));
  ['brightness','volume'].forEach(key=>{
    const input=byId(`archive-${key}`);
    const update=()=>{state[key]=Number(input.value);const control=byId(`${key}-control`);control.style.setProperty('--fill',state[key]/100);control.style.setProperty('--control-icon',state[key]<25?'#eeeaff':'#6a5bb6');control.querySelector('output').textContent=`${state[key]}%`;input.setAttribute('aria-valuetext',`${state[key]}%`);};
    input.addEventListener('input',update);
    input.addEventListener('keydown',event=>{let value=state[key];if(['ArrowUp','ArrowRight'].includes(event.key))value+=5;else if(['ArrowDown','ArrowLeft'].includes(event.key))value-=5;else if(event.key==='Home')value=0;else if(event.key==='End')value=100;else return;event.preventDefault();input.value=Math.max(0,Math.min(100,value));update();});
  });
  byId('monthly-card').addEventListener('click',()=>info('这个月，已经收藏的小确幸',`${state.calendarMonth.replace('-',' 年 ')} 月共有 ${memories.filter(m=>m.date.startsWith(state.calendarMonth)).length} 条独立记忆。\n同一条记忆即使出现在多个情绪文件夹中，也只计算一次。`));
  byId('expiry-notice').addEventListener('click',()=>window.RecordEditor.showOverview('pending'));

  archive.querySelectorAll('[data-ai]').forEach(b=>b.addEventListener('click',()=>info(b.dataset.ai,`这是小忆的${b.dataset.ai}入口。\n当前先展示界面与操作反馈，相关服务将在后续接入。`)));
  archive.querySelectorAll('[data-profile]').forEach(b=>b.addEventListener('click',()=>info(b.dataset.profile,`“${b.dataset.profile}”已为个人档案预留。\n本轮展示页面结构与交互，具体内容将在个人中心阶段完善。`)));

  function refresh() {
    memories=store.list();
    categories.forEach(c=>{
      const folder=archive.querySelector(`.folder-card[data-category="${c.id}"]`);
      folder.querySelector('.folder-meta').innerHTML=`${memories.filter(m=>m.tags.includes(c.id)).length} 段记忆 <span>↗</span>`;
      const photos=folder.querySelector('.folder-photos'), images=folderImages(c.id);
      const unchanged=photos.children.length===images.length && images.every((image,index)=>{
        const photo=photos.children[index];
        return photo.dataset.memoryId===image.memoryId && photo.dataset.imageId===image.id && photo.querySelector('img').getAttribute('src')===image.src;
      });
      if(!unchanged)photos.innerHTML=folderPhotosHTML(images);
    });
    archive.querySelector('.folder-utilities [data-category="all"] b').textContent=memories.length;
    archive.querySelector('.folder-utilities [data-category="unfiled"] b').textContent=memories.filter(m=>!m.tags.length).length;
    const stats=archive.querySelectorAll('.profile-stats strong');
    [memories.length,4,memories.filter(m=>m.retention==='forever').length,memories.filter(m=>!m.tags.length).length].forEach((v,i)=>{if(stats[i])stats[i].textContent=v;});
    byId('monthly-card').querySelector('small').textContent=`${memories.filter(m=>m.date.startsWith(state.calendarMonth)).length} 条记忆`;
    const pending=memories.filter(store.expired).length, soon=memories.filter(r=>store.due(r)&&!store.expired(r)).length;
    byId('expiry-notice').querySelector('span').textContent=pending?`${pending} 条已到期 · ${soon} 条即将到期`:`${soon} 条记忆即将到期`;
    if(state.category){const scroll=byId('memory-list-scroll').scrollTop;renderList();byId('memory-list-scroll').scrollTop=scroll;}
    if(state.tab==='profile')contextRail('profile');
    if(detail.open){const current=store.find(currentMemoryId);if(current&&current.revision!==currentMemoryRevision)openMemory(currentMemoryId,null,true);}
    archive.querySelector('.archive-demo').textContent=store.status==='ready'?'本机档案':store.status==='loading'?'正在打开档案…':'存储不可用';
  }
  store.subscribe(refresh);
  window.MemoryArchive={
    bridge:{state,categories,icon,asset,escapeHTML,byId,archive,detail,toast,info,animatePane,switchTab,openCategory,openMemory,renderList,refresh,writeRoute,
      currentMemory:()=>currentMemoryId,
      dismissDetail(){clearTimeout(detailCloseTimer);if(detail.open){detail.close();restoreDetailFocus();}detail.classList.remove('is-closing');},
    },
    activate({focus=false,route=null}={}){
      if(window.RecordEditor?.isOpen()&&route&&route!=='#archive/edit'){writeRoute();window.RecordEditor.requestLeave(()=>window.MemoryArchive.activate({focus,route}));return;}
      if(route){
        const parts=route.replace(/^#/, '').split('/');
        const tab=Object.hasOwn(tabNames,parts[1])?parts[1]:'view';
        switchTab(tab,false);
        if(tab==='profile')window.MemoryProfile?.openCollection(parts[2]||'home',{focus:false});
        if(tab==='view'){
          if(['all','unfiled',...categories.map(c=>c.id)].includes(parts[2]))openCategory(parts[2],false);
          else {state.category=null;state.query='';byId('memory-browser').hidden=true;byId('folder-home').hidden=false;}
        }
      }
      switchTab(state.tab,false);writeRoute();
      if(focus){const title=state.tab==='profile'?byId(byId('pf-gallery')?.hidden?'pf-title':'pf-gallery-title'):state.tab==='view'&&state.category?byId('category-title'):byId(`pane-${state.tab}`).querySelector('h1');title?.focus({preventScroll:true});}
    },
    deactivate(){window.MemoryAssistant?.onTab(null);clearTimeout(toastTimer);byId('archive-toast').classList.remove('is-visible');if(detail.open){clearTimeout(detailCloseTimer);detail.close();}},
  };
})();
