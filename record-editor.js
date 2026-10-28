(() => {
  'use strict';
  const S = window.MemoryStore, B = window.MemoryArchive.bridge;
  const { byId: $, icon, escapeHTML: esc, categories } = B;
  const reduced = window.ArchivePreferences.motion;
  const durations = [['instant','瞬时','30 秒'],['short','短期','7 天'],['long','长期','1 年'],['forever','永恒','永久典藏']];
  const scopes = [['day','按日期'],['all','全部'],['drafts','草稿'],['pending','待处理'],['trash','回收站']];
  let scope='day', query='', writing=null, draftTimer, editVersion=0, session=0, saving=false, processing=false, imageTask=Promise.resolve(), leaving=false;
  let highlighted=null, expirySignature='', listScroll=0;
  const pane=$('pane-edit');
  const art=document.createElementNS('http://www.w3.org/2000/svg','svg');art.setAttribute('class','svg-defs');art.setAttribute('aria-hidden','true');
  art.innerHTML='<symbol id="a-edit" viewBox="0 0 24 24"><path d="m4 16 12-12 4 4L8 20H4v-4Zm9-9 4 4M4 23h16"/></symbol><symbol id="a-check" viewBox="0 0 24 24"><path d="m4 12 5 5L20 6"/></symbol><symbol id="a-trash" viewBox="0 0 24 24"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/></symbol><symbol id="a-restore" viewBox="0 0 24 24"><path d="M4 9a8 8 0 1 1-1 7M4 3v6h6"/></symbol>';
  document.body.appendChild(art);
  pane.classList.add('records-pane');
  pane.innerHTML=`<div class="records-heading"><div><p class="a-eyebrow">COLLECT THE LITTLE THINGS</p><h1 id="records-title" tabindex="-1"></h1><p id="records-subtitle"></p></div><button class="a-soft-button" id="new-memory" type="button">${icon('plus')} 新增记忆</button></div>
    <div class="records-toolbar"><div class="record-scopes" aria-label="记录筛选">${scopes.map(([id,label])=>`<button type="button" data-scope="${id}" aria-pressed="${id==='day'}">${label}<span></span></button>`).join('')}</div><label class="memory-search record-search">${icon('search')}<input id="record-search" type="search" placeholder="找一段记忆" aria-label="搜索记录"/></label></div>
    <div class="records-scroll" id="records-scroll"><div class="record-list" id="record-list"></div><div class="record-empty" id="record-empty" hidden>${icon('text')}<h2 id="record-empty-title"></h2><p id="record-empty-copy"></p><button class="a-soft-button" id="record-empty-action" type="button">记录一个瞬间 ${icon('plus')}</button></div></div>
    <div class="records-bottom"><span id="record-count" role="status"></span><span id="local-save-status"></span></div>`;

  const editor=document.createElement('section');editor.id='record-editor';editor.hidden=true;editor.setAttribute('aria-label','记忆编辑器');
  editor.innerHTML=`<form id="memory-form" novalidate><div class="writer-heading"><button type="button" class="a-icon-button" id="writer-back" aria-label="返回并处理未保存的修改">${icon('back')}</button><div><p class="a-eyebrow">A MOMENT, NOW YOURS</p><h1 id="writer-heading" tabindex="-1">记录一个瞬间</h1></div><span id="writer-status" role="status">未保存</span></div>
    <div class="writer-scroll" id="writer-scroll"><div class="writer-meta"><label>发生日期<input type="date" id="writer-date" min="0001-01-01" max="9999-12-31" required/></label><label>时间<input type="time" id="writer-time" required/></label><label class="writer-location">地点 · 可选<input type="text" id="writer-location" placeholder="这个瞬间，发生在哪里？" maxlength="120"/></label></div>
    <label class="writer-title-label"><span class="sr-only">记忆标题，可选</span><input id="writer-title" type="text" placeholder="给这一刻起个名字 · 可选" maxlength="80" autocomplete="off"/></label>
    <div class="writer-canvas" id="image-dropzone"><div class="writer-media-heading"><span>让记忆有画面 <small id="image-count">0 / 6</small></span><button type="button" class="writer-add-image" id="choose-images">${icon('image')} 添加图片/视频</button><input id="image-input" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden/></div><div class="writer-images" id="writer-images"></div><p class="image-help" id="image-help">也可以把图片拖到这里 · 最多 6 张，单张不超过 10 MB</p><label for="writer-body" class="sr-only">记忆正文</label><textarea id="writer-body" maxlength="10000" placeholder="记录今天发生的事……\n不用写得完美，把想记住的留在这里。"></textarea><div class="writer-word-count"><span>文字或图片，至少留下一种</span><span id="body-count">0 / 10000</span></div></div></div>
    <footer class="writer-footer"><fieldset class="emotion-field"><legend>此刻的心情 <span>可多选，也可以先不分类</span></legend><div>${categories.map(c=>`<button type="button" data-emotion="${c.id}" aria-pressed="false">${c.name}</button>`).join('')}</div></fieldset><div class="writer-final-row"><fieldset class="retention-field"><legend class="sr-only">保存时长</legend>${durations.map(([id,label,hint])=>`<label><input type="radio" name="retention" value="${id}" ${id==='forever'?'checked':''}/><span>${label}<small>${hint}</small></span></label>`).join('')}</fieldset><button class="writer-save" id="writer-save" type="submit">${icon('check')}<span>保存记忆</span></button></div><div class="writer-footnote"><span id="retention-note"></span><button type="button" id="writer-cancel">取消</button></div><p id="writer-error" role="alert" hidden></p></footer></form>`;
  $('archive-body').appendChild(editor);

  const calendar=$('archive-rail').querySelector('.calendar-card');
  calendar.querySelector('h2').outerHTML=`<div class="calendar-heading"><h2 id="calendar-title"></h2><div><button type="button" id="calendar-prev" aria-label="上个月">‹</button><button type="button" id="calendar-next" aria-label="下个月">›</button></div></div>`;
  const rail=document.createElement('div');rail.className='record-rail-content';rail.hidden=true;
  rail.innerHTML=`<section class="scent-section"><div class="rail-section-title"><h2>气味联想</h2><span id="scent-hint">记录时可选</span></div><div class="scent-options">${S.scents.map(name=>`<button type="button" data-scent="${name}" aria-pressed="false" disabled>${name}<span>＋</span></button>`).join('')}</div></section><section class="retention-guide"><h2>让这一刻，停留多久</h2><div>${durations.map(([id,label,hint])=>`<span data-guide="${id}"><i></i>${label}<small>${hint}</small></span>`).join('')}</div><p>到期会进入待处理，珍贵的内容仍在。</p></section>`;
  $('archive-rail').appendChild(rail);
  const categoryAdd=document.createElement('button');categoryAdd.type='button';categoryAdd.className='a-icon-button category-add';categoryAdd.id='category-add';categoryAdd.setAttribute('aria-label','在当前分类新增记忆');categoryAdd.dataset.tip='记录一个瞬间';categoryAdd.innerHTML=icon('plus');
  $('memory-browser').querySelector('.memory-browser-heading').appendChild(categoryAdd);

  const dialog=document.createElement('dialog');dialog.id='record-confirm';dialog.className='record-confirm';dialog.setAttribute('aria-labelledby','record-confirm-title');
  dialog.innerHTML='<p class="a-eyebrow">KEEP WHAT MATTERS</p><h2 id="record-confirm-title"></h2><p id="record-confirm-body"></p><div id="record-confirm-options"></div>';
  document.body.appendChild(dialog);
  let resolveChoice;
  dialog.addEventListener('close',()=>{const resolve=resolveChoice;resolveChoice=null;resolve?.(dialog.returnValue||null);});
  dialog.addEventListener('cancel',e=>{e.preventDefault();dialog.close('');});
  function choose(title,body,options) {
    if(dialog.open)return Promise.resolve(null);
    $('record-confirm-title').textContent=title;$('record-confirm-body').textContent=body;
    $('record-confirm-options').replaceChildren();
    for(const [value,label,style=''] of options){const button=document.createElement('button');button.type='button';button.textContent=label;button.className=`a-soft-button ${style}`;button.dataset.choice=value;button.onclick=()=>dialog.close(value);$('record-confirm-options').appendChild(button);}
    return new Promise(resolve=>{resolveChoice=resolve;dialog.returnValue='';dialog.showModal();$('record-confirm-options').firstElementChild?.focus();});
  }
  function fail(error) {
    const message=error?.name==='QuotaExceededError'?'本机存储空间不足。当前输入还在，请减少图片后重试。':error.message||'保存暂时失败，内容仍保留在编辑器中，请重试。';
    if(writing){$('writer-error').textContent=message;$('writer-error').hidden=false;$('writer-status').textContent='尚未保存成功';}
    else B.info('暂时无法完成操作',message);
  }
  const run=fn=>event=>Promise.resolve().then(()=>fn(event)).catch(fail);
  const titleOf=data=>data.title?.trim()||data.body?.trim().slice(0,32)||'一段新的记忆';
  function origin() { return {tab:B.state.tab,category:B.state.category,query:B.state.query,scroll:B.state.scroll,scope,date:B.state.calendarDate,listScroll:$('records-scroll').scrollTop,assistant:B.state.tab==='ai'?window.MemoryAssistant?.capture():null,profile:B.state.tab==='profile'?window.MemoryProfile?.capture():null}; }
  function niceDate(value) { const date=new Date(`${value}T12:00:00Z`);return `${Number(value.slice(5,7))}月${Number(value.slice(8))}日 <span>星期${'日一二三四五六'[date.getUTCDay()]}</span>`; }
  function renderOverview() {
    const all=S.list(), trash=S.list({trash:true}), drafts=S.drafts();
    const source=scope==='trash'?trash:scope==='drafts'?drafts:all.filter(r=>scope==='day'?r.date===B.state.calendarDate:scope==='pending'?S.due(r):true);
    const matches=source.filter(r=>{const data=scope==='drafts'?r.data:r;return `${data.title} ${data.body} ${data.date}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());});
    $('records-title').innerHTML=scope==='day'?niceDate(B.state.calendarDate):esc({all:'每一段，都在这里',pending:'让重要的记忆，多停留一会儿',trash:'暂别的记忆',drafts:'还没写完的故事'}[scope]);
    $('records-subtitle').textContent=scope==='day'?`${B.state.calendarDate.slice(0,4)} 年 · 当天记忆 · 共 ${source.length} 条`:scope==='pending'?'即将到期或已经到期的记忆，都可以继续珍藏。':scope==='trash'?'恢复后，内容、心情和原有保存期限都会回来。':scope==='drafts'?'草稿还没有正式存档，不计入记忆总数。':'按发生时间，拾起那些微小而珍贵的瞬间。';
    pane.querySelectorAll('[data-scope]').forEach(button=>{const key=button.dataset.scope;button.setAttribute('aria-pressed',String(key===scope));button.querySelector('span').textContent=key==='drafts'&&drafts.length?drafts.length:key==='pending'&&all.filter(S.due).length?all.filter(S.due).length:key==='trash'&&trash.length?trash.length:'';});
    const scroll=$('records-scroll').scrollTop;
    $('record-list').innerHTML=matches.map(item=>{
      const draft=scope==='drafts',r=draft?item.data:item,cover=S.cover(r),status=draft?'草稿 · 尚未存档':S.remaining(r);
      return `<article class="record-row ${highlighted===r.id?'just-saved':''}" data-record-row="${esc(r.id)}"><time>${scope==='day'?esc(r.time):esc(r.date.slice(5).replace('-','.'))}<small>${scope==='day'?'':esc(r.time)}</small></time><span class="record-line-dot"></span><div class="record-tile"><button type="button" class="record-main" ${draft?`data-resume="${esc(item.key)}"`:`data-open-record="${esc(r.id)}"`}><span class="record-copy"><span class="record-lifetime ${!draft&&S.expired(r)?'is-expired':''}" ${draft?'':`data-remaining="${esc(r.id)}"`}>${status}</span><strong>${esc(titleOf(r))}</strong><small>${esc(r.body?.replace(/\n/g,' ').slice(0,70)||'用画面收藏的一段记忆')}</small></span>${cover?`<img src="${esc(cover.src)}" alt=""/>`:icon('text')}</button><div class="record-row-actions">${draft?`<button type="button" data-resume="${esc(item.key)}">${icon('edit')} 继续草稿</button><button type="button" data-discard-draft="${esc(item.key)}" aria-label="删除草稿：${esc(titleOf(r))}">${icon('trash')}</button>`:r.deletedAt?`<button type="button" data-restore="${esc(r.id)}">${icon('restore')} 恢复记忆</button>`:`<button type="button" data-edit-record="${esc(r.id)}">${icon('edit')} 编辑</button>${S.due(r)?`<button type="button" data-renew="${esc(r.id)}">${icon('clock')} 延长保存</button>`:''}<span>${r.tags.length?r.tags.map(t=>categories.find(c=>c.id===t)?.name).join(' / '):'未分类'}</span>`}</div></div></article>`;
    }).join('');
    $('records-scroll').scrollTop=scroll;
    $('record-empty').hidden=matches.length>0;
    $('record-empty-title').textContent=query?'没有找到这段记忆':scope==='trash'?'回收站是空的':scope==='pending'?'所有记忆，都安然存放':scope==='drafts'?'还没有未完成的草稿':'这一天，留一点位置给故事';
    $('record-empty-copy').textContent=query?'换一个词，或者清除搜索再看看。':scope==='pending'?'未来三天没有即将到期的记忆。':scope==='trash'?'移入回收站的内容会留在这里，随时可以恢复。':scope==='drafts'?'写下的草稿，会在这里等你继续。':'一段文字、一张图片，都可以成为开始。';
    $('record-empty-action').innerHTML=query?`清除搜索 ${icon('close')}`:`记录一个瞬间 ${icon('plus')}`;
    $('record-count').textContent=`${matches.length} ${scope==='drafts'?'份草稿':'段记忆'}${scope==='all'?' · 同一条记忆只计算一次':''}`;
    $('local-save-status').textContent=S.status==='ready'?'保存在此浏览器':S.status==='loading'?'正在打开本机档案…':'本机存储不可用';
  }
  function renderCalendar() {
    const [year,month]=B.state.calendarMonth.split('-').map(Number), first=new Date(`${B.state.calendarMonth}-01T12:00:00Z`), offset=(first.getUTCDay()+6)%7;
    const last=new Date(first);last.setUTCMonth(month);last.setUTCDate(0);
    const prior=new Date(first);prior.setUTCDate(0);
    const count=last.getUTCDate(), previous=prior.getUTCDate();
    const monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
    $('calendar-title').innerHTML=`${monthNames[month-1]} <span>${year}</span>`;
    $('calendar-days').setAttribute('aria-label',`${year} 年 ${month} 月，选择日期`);
    const records=S.list();let html='';
    for(let i=0;i<Math.ceil((offset+count)/7)*7;i++){
      const day=i-offset+1,date=`${B.state.calendarMonth}-${String(day).padStart(2,'0')}`;
      if(day<1||day>count)html+=`<span class="calendar-adjacent" aria-hidden="true">${day<1?previous+day:day-count}</span>`;
      else {const total=records.filter(r=>r.date===date).length;html+=`<button type="button" data-date="${date}" class="${date===B.state.calendarDate?'is-selected ':''}${total?'has-records':''}" aria-pressed="${date===B.state.calendarDate}" aria-label="${year}年${month}月${day}日${total?'，'+total+'条记忆':''}">${day}</button>`;}
    }
    $('calendar-days').innerHTML=html;
    $('calendar-prev').disabled=year===1&&month===1;$('calendar-next').disabled=year===9999&&month===12;
  }
  function selectDate(date) {
    B.state.calendarDate=date;B.state.calendarMonth=date.slice(0,7);B.state.date=Number(date.slice(8));
    if(writing){writing.data.date=date;$('writer-date').value=date;changed();}
    else if(B.state.tab==='edit'){scope='day';query='';$('record-search').value='';renderOverview();}
    renderCalendar();B.refresh();
  }
  $('calendar-days').addEventListener('click',event=>{const button=event.target.closest('[data-date]');if(button)selectDate(button.dataset.date);});
  for(const [id,amount] of [['calendar-prev',-1],['calendar-next',1]])$(id).addEventListener('click',()=>{const [year,month]=B.state.calendarMonth.split('-').map(Number);const date=new Date(`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-01T12:00:00Z`);date.setUTCMonth(date.getUTCMonth()+amount);B.state.calendarMonth=date.toISOString().slice(0,7);renderCalendar();B.refresh();});

  function onTab(tab) {
    B.archive.classList.toggle('is-edit-mode',tab==='edit');rail.hidden=tab!=='edit';
    if(tab==='edit')renderOverview();
  }
  function returnTo(source, saved=null, isNew=false) {
    if(source?.tab==='profile'&&window.MemoryProfile){B.switchTab('profile',false);B.refresh();window.MemoryProfile.restore(source.profile);return;}
    if(source?.tab==='ai'&&window.MemoryAssistant){B.switchTab('ai',false);window.MemoryAssistant.restore(source.assistant);B.refresh();return;}
    if(saved&&isNew){scope='day';query='';$('record-search').value='';B.state.calendarDate=saved.date;B.state.calendarMonth=saved.date.slice(0,7);B.switchTab('edit',false);renderOverview();}
    else if(source?.tab==='view'){
      B.switchTab('view',false);
      if(source.category){B.openCategory(source.category,false);B.state.query=source.query||'';$('memory-search').value=B.state.query;B.renderList();B.state.scroll=source.scroll||0;$('memory-list-scroll').scrollTop=B.state.scroll;}
      else {B.state.category=null;$('folder-home').hidden=false;$('memory-browser').hidden=true;B.writeRoute();}
    } else {scope=source?.scope||'day';B.state.calendarDate=source?.date||B.state.calendarDate;B.state.calendarMonth=B.state.calendarDate.slice(0,7);B.switchTab('edit',false);renderOverview();$('records-scroll').scrollTop=source?.listScroll||0;}
    renderCalendar();B.refresh();
    requestAnimationFrame(()=>{
      const id=saved?.id, selector=B.state.tab==='view'?`.memory-card[data-memory="${id}"]`:`[data-record-row="${id}"] .record-main`;
      const target=id?B.archive.querySelector(selector):null;
      if(target){target.scrollIntoView({block:'nearest',behavior:reduced.matches?'auto':'smooth'});target.focus({preventScroll:true});}
      else (B.state.tab==='edit'?$('records-title'):B.state.category?$('category-title'):B.archive.querySelector('#folder-home h1'))?.focus({preventScroll:true});
    });
  }
  function closeEditor() {
    clearTimeout(draftTimer);session++;writing=null;processing=false;saving=false;
    editor.hidden=true;B.archive.classList.remove('is-writing');pane.hidden=false;
    rail.querySelectorAll('[data-scent]').forEach(b=>{b.disabled=true;b.setAttribute('aria-pressed','false');b.querySelector('span').textContent='＋';});
    $('scent-hint').textContent='记录时可选';rail.querySelectorAll('[data-guide]').forEach(e=>e.classList.remove('selected'));
    $('writer-error').hidden=true;
  }
  async function requestLeave(action) {
    if(!writing){action();return;}
    if(leaving)return;
    if(saving){B.toast('正在保存这段记忆，请稍候。');return;}
    if(!writing.dirty&&!processing){closeEditor();action();return;}
    leaving=true;
    try {
      const choice=await choose('这段故事，还没有正式存档','你可以先保留草稿，下次继续。放弃修改不会改变原来的记忆。', [['stay','继续编辑'],['keep','保留草稿并离开','choice-primary'],['discard','放弃修改','choice-quiet']]);
      if(choice==='keep'){await imageTask;await persistDraft();closeEditor();action();}
      else if(choice==='discard'){clearTimeout(draftTimer);if(S.status==='ready')await S.deleteDraft(writing.key);closeEditor();action();}
    } catch(error){fail(error);} finally{leaving=false;}
  }
  function fields(data) { for(const key of ['title','body','date','time','location'])$(`writer-${key}`).value=data[key]||''; }
  async function openEditor(id=null,{category=null,resume=false,source=null,prefill=null}={}) {
    if(writing){await requestLeave(()=>openEditor(id,{category,resume,source,prefill}).catch(fail));return;}
    await Promise.all([S.ready,window.ProfileStore.ready]);
    const record=id?S.find(id):null;
    if(id&&(!record||record.deletedAt)){B.toast('请先在回收站恢复这条记忆。');return;}
    const key=id?`record:${id}`:'new',draft=S.draft(key),where=source||origin();
    let useDraft=resume&&draft;
    if(draft&&!resume){const choice=await choose('这里有一份未完成的草稿',prefill?'继续草稿会保留原内容；本次选中的内容仍留在小忆对话里。也可以明确放弃原草稿，再带入本次内容。':'可以继续上次的内容，也可以放弃草稿后重新开始。', [['resume','继续原草稿','choice-primary'],['fresh',prefill?'放弃原草稿并带入':'放弃草稿并重新开始'],['cancel','暂不打开','choice-quiet']]);if(!choice||choice==='cancel')return;if(choice==='fresh')await S.deleteDraft(key);else useDraft=true;}
    const now=new Date(),time=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const base=record||{id:S.uid(),title:'',body:'',date:B.state.calendarDate,time,location:'',tags:categories.some(c=>c.id===category)?[category]:[],images:[],coverId:null,scent:'',retention:window.ArchivePreferences.retention};
    if(prefill&&!record){base.title=String(prefill.title||'').slice(0,80);base.body=String(prefill.body||'').slice(0,10000);if(S.validDate(prefill.date))base.date=prefill.date;base.images=S.copy((prefill.images||[]).slice(0,6));base.coverId=base.images[0]?.id||null;}
    const data=S.copy(useDraft?draft.data:base);
    B.dismissDetail();B.switchTab('edit',false);
    session++;editVersion=0;
    writing={data,key,baseRevision:useDraft?draft.baseRevision:record?.revision??null,original:record,source:useDraft&&!prefill?(draft.source||where):where,dirty:Boolean(useDraft),isNew:!record};
    editor.hidden=false;pane.hidden=true;B.archive.classList.add('is-writing');
    $('memory-form').querySelectorAll('input,textarea,button').forEach(e=>{e.disabled=false;});
    $('writer-heading').textContent=record?'再补上一句，关于那一刻':'记录一个瞬间';
    $('writer-save').innerHTML=`${icon('check')}<span>${record?'保存修改':'保存记忆'}</span>`;
    $('writer-status').textContent=useDraft?'已恢复草稿':record?'尚未修改':'未保存';$('writer-error').hidden=true;
    fields(data);renderChoices();renderImages();updateCounts();$('writer-scroll').scrollTop=0;
    if(S.validDate(data.date)){B.state.calendarDate=data.date;B.state.calendarMonth=data.date.slice(0,7);}renderCalendar();B.refresh();
    B.animatePane(editor);$('writer-body').focus({preventScroll:true});
    if(prefill&&!record&&!useDraft)changed();
    if(S.status!=='ready')fail(new Error(S.failure));
    else if(record&&useDraft&&record.revision!==draft.baseRevision)fail(new Error('原记录在草稿保存后有过更新。请先核对内容；为避免覆盖，旧草稿不会直接覆盖新版本。'));
  }
  function renderChoices() {
    if(!writing)return;const data=writing.data;
    editor.querySelectorAll('[data-emotion]').forEach(b=>b.setAttribute('aria-pressed',String(data.tags.includes(b.dataset.emotion))));
    editor.querySelectorAll('[name="retention"]').forEach(input=>{input.checked=input.value===data.retention;});
    rail.querySelectorAll('[data-scent]').forEach(b=>{b.disabled=false;const selected=b.dataset.scent===data.scent;b.setAttribute('aria-pressed',String(selected));b.querySelector('span').textContent=selected?'✓':'＋';});
    $('scent-hint').textContent=data.scent?'已选 · 再点可取消':'可选一个，也可以不选';
    rail.querySelectorAll('[data-guide]').forEach(e=>e.classList.toggle('selected',e.dataset.guide===data.retention));
    const unchanged=writing.original&&writing.original.retention===data.retention;
    $('retention-note').textContent=unchanged?`保留原期限 · ${S.remaining(writing.original)}`:data.retention==='forever'?'永恒保存，这个瞬间不设期限。':`保存成功后开始计时：${durations.find(d=>d[0]===data.retention)[2]}，到期进入待处理。`;
  }
  function renderImages() {
    if(!writing)return;const data=writing.data;
    $('writer-images').innerHTML=data.images.map((img,i)=>`<div class="writer-image ${img.id===data.coverId?'is-cover':''}"><img src="${esc(img.src)}" alt="记忆图片 ${i+1}"/><button class="image-remove" type="button" data-remove-image="${esc(img.id)}" aria-label="移除第 ${i+1} 张图片">${icon('close')}</button><button class="image-cover" type="button" data-cover-image="${esc(img.id)}" aria-pressed="${img.id===data.coverId}">${img.id===data.coverId?'✓ 封面':'设为封面'}</button></div>`).join('');
    $('image-count').textContent=`${data.images.length} / 6`;$('image-help').hidden=data.images.length>0;
    $('choose-images').disabled=data.images.length>=6||processing;
  }
  function updateCounts(){if(writing)$('body-count').textContent=`${writing.data.body.length} / 10000`;}
  function changed() {
    if(!writing)return;writing.dirty=true;editVersion++;$('writer-status').textContent='未保存';$('writer-error').hidden=true;updateCounts();
    clearTimeout(draftTimer);draftTimer=setTimeout(()=>persistDraft().catch(fail),650);
  }
  async function persistDraft() {
    if(!writing||!writing.dirty||saving)return;
    clearTimeout(draftTimer);
    const version=editVersion,token=session;
    const draft={key:writing.key,recordId:writing.isNew?null:writing.data.id,data:S.copy(writing.data),baseRevision:writing.baseRevision,source:S.copy(writing.source),updatedAt:Date.now()};
    await S.saveDraft(draft);
    if(writing&&token===session&&version===editVersion&&!saving)$('writer-status').textContent='草稿已保存';
  }
  for(const key of ['title','body','date','time','location'])$(`writer-${key}`).addEventListener('input',event=>{if(!writing)return;writing.data[key]=event.target.value;changed();if(key==='date'&&S.validDate(event.target.value)){B.state.calendarDate=event.target.value;B.state.calendarMonth=event.target.value.slice(0,7);renderCalendar();B.refresh();}});
  editor.querySelectorAll('[data-emotion]').forEach(b=>b.addEventListener('click',()=>{const tags=writing.data.tags,id=b.dataset.emotion;writing.data.tags=tags.includes(id)?tags.filter(t=>t!==id):[...tags,id];renderChoices();changed();}));
  editor.querySelectorAll('[name="retention"]').forEach(input=>input.addEventListener('change',()=>{writing.data.retention=input.value;renderChoices();changed();}));
  rail.querySelectorAll('[data-scent]').forEach(b=>b.addEventListener('click',()=>{if(!writing)return;writing.data.scent=writing.data.scent===b.dataset.scent?'':b.dataset.scent;renderChoices();changed();}));
  $('writer-images').addEventListener('click',event=>{const remove=event.target.closest('[data-remove-image]'),cover=event.target.closest('[data-cover-image]');if(remove){writing.data.images=writing.data.images.filter(i=>i.id!==remove.dataset.removeImage);if(writing.data.coverId===remove.dataset.removeImage)writing.data.coverId=writing.data.images[0]?.id||null;}else if(cover)writing.data.coverId=cover.dataset.coverImage;else return;renderImages();changed();});

  async function prepareImage(file) {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error(`${file.name}：请选择 JPEG、PNG 或 WebP 图片。`);
    if(file.size>10*1024*1024)throw new Error(`${file.name}：单张图片不能超过 10 MB。`);
    const url=URL.createObjectURL(file),image=new Image();
    try {image.src=url;await image.decode();if(image.naturalWidth*image.naturalHeight>40000000)throw new Error('图片尺寸过大，请先缩小。');const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);return{id:S.uid(),src:canvas.toDataURL('image/webp',.86),name:file.name};}
    catch(error){throw new Error(`${file.name}：${error.message==='图片尺寸过大，请先缩小。'?error.message:'无法读取这张图片，请尝试另一张。'}`);}finally{URL.revokeObjectURL(url);}
  }
  async function addImages(files) {
    if(!writing||!files.length)return;if(processing){B.toast('上一批图片正在处理，请稍候再添加。');return;}
    const token=session;processing=true;$('writer-save').disabled=true;$('choose-images').disabled=true;clearTimeout(draftTimer);$('writer-status').textContent='正在整理图片…';
    const issues=[];let added=0;
    try {for(const file of files){if(token!==session)return;if(writing.data.images.length>=6){issues.push('最多添加 6 张图片，其余图片没有加入。');break;}try{const image=await prepareImage(file);if(token!==session)return;writing.data.images.push(image);writing.data.coverId ||= image.id;added++;renderImages();}catch(error){issues.push(error.message);}}}
    finally{if(token===session&&writing){processing=false;$('writer-save').disabled=false;renderImages();if(added)changed();else $('writer-status').textContent=writing.dirty?'未保存':'尚未修改';if(issues.length){$('writer-error').textContent=issues.join('\n');$('writer-error').hidden=false;}}}
  }
  $('choose-images').addEventListener('click',()=>$('image-input').click());
  $('image-input').addEventListener('change',event=>{imageTask=addImages([...event.target.files]);imageTask.catch(fail);event.target.value='';});
  let dragDepth=0;const drop=$('image-dropzone');
  drop.addEventListener('dragenter',event=>{event.preventDefault();dragDepth++;drop.classList.add('is-dragging');});
  drop.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect='copy';});
  drop.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;drop.classList.remove('is-dragging');}});
  drop.addEventListener('drop',event=>{event.preventDefault();dragDepth=0;drop.classList.remove('is-dragging');imageTask=addImages([...event.dataTransfer.files]);imageTask.catch(fail);});
  document.addEventListener('dragover',event=>{if(writing&&event.dataTransfer?.types.includes('Files'))event.preventDefault();});
  document.addEventListener('drop',event=>{if(writing&&event.dataTransfer?.types.includes('Files'))event.preventDefault();});

  async function save() {
    if(!writing||saving||processing)return;
    if(!writing.data.body.trim()&&!writing.data.images.length){fail(new Error('写下一点文字，或添加一张图片，再保存这段记忆。'));$('writer-body').focus();return;}
    if(!S.validDate(writing.data.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(writing.data.time)){fail(new Error('请填写有效的发生日期和时间。'));$('writer-date').focus();return;}
    clearTimeout(draftTimer);saving=true;$('writer-status').textContent='正在保存…';$('writer-error').hidden=true;
    $('memory-form').querySelectorAll('input,textarea,button').forEach(e=>{e.disabled=true;});rail.querySelectorAll('[data-scent]').forEach(e=>{e.disabled=true;});
    const current=writing;
    try {
      const record=await S.save(current.data,{baseRevision:current.baseRevision,draftKey:current.key});
      highlighted=record.id;$('writer-status').textContent='已保存';
      closeEditor();returnTo(current.source,record,current.isNew);
      const moved=current.source.tab==='view'&&categories.some(c=>c.id===current.source.category)&&!record.tags.includes(current.source.category);
      B.toast(moved?'已保存，并移出原来的情绪分类。':current.isNew?'这一刻，已经好好存进档案。':'修改已保存，所有分类中的记忆已同步。',moved?{label:'查看记忆',run:()=>B.openMemory(record.id)}:null);
      setTimeout(()=>{highlighted=null;B.archive.querySelectorAll('.just-saved').forEach(e=>e.classList.remove('just-saved'));},2200);
    } catch(error){saving=false;$('memory-form').querySelectorAll('input,textarea,button').forEach(e=>{e.disabled=false;});renderChoices();renderImages();fail(error);try{await persistDraft();$('writer-status').textContent='正式保存失败 · 草稿已保留';}catch{$('writer-status').textContent='尚未保存成功';}}
  }
  $('memory-form').addEventListener('submit',event=>{event.preventDefault();save().catch(fail);});
  for(const id of ['writer-back','writer-cancel'])$(id).addEventListener('click',()=>{const source=writing?.source;requestLeave(()=>returnTo(source));});
  document.addEventListener('keydown',event=>{if(!writing||dialog.open||$('info-dialog').open)return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();save().catch(fail);}else if(event.key==='Escape'){event.preventDefault();const source=writing.source;requestLeave(()=>returnTo(source));}});
  window.addEventListener('beforeunload',event=>{if(writing&&(writing.dirty||saving||processing)){event.preventDefault();event.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&writing?.dirty)persistDraft().catch(()=>{});else if(!document.hidden)tick();});

  async function deleteRecord(id) {
    const record=S.find(id);if(!record)return;
    const choice=await choose('将这段记忆移入回收站？',`“${record.title}”会从所有情绪分类中移出。\n它的未提交草稿会一并移除，正式内容仍可在回收站恢复。`,[['cancel','继续保留'],['trash','移入回收站','choice-danger']]);
    if(choice!=='trash')return;
    await S.mutate(id,'trash');B.dismissDetail();renderOverview();B.toast('记忆已移入回收站。',{label:'撤销',run:run(()=>restoreRecord(id))});
  }
  async function restoreRecord(id) { await S.mutate(id,'restore');B.dismissDetail();renderOverview();B.toast('记忆已恢复，原有内容与保存期限都还在。'); }
  async function renewRecord(id) {
    const record=S.find(id);if(!record)return;
    const choice=await choose('让这一刻，再停留久一点',`“${record.title}”\n同类型会在原到期时间上延长；已经到期或改选类型，则从现在重新计时。`,[['short','延长保存 7 天'],['long','延长保存 1 年'],['forever','转为永恒','choice-primary'],['instant','再留 30 秒'],['cancel','保持原样','choice-quiet']]);
    if(!choice||choice==='cancel')return;
    const updated=await S.mutate(id,'renew',choice);if(B.detail.open)B.openMemory(id);B.toast(choice==='forever'?'已经转为永恒，这段记忆不再到期。':'保存时长已更新。');return updated;
  }
  async function removeCategory(id,tag) {
    const record=S.find(id),label=categories.find(c=>c.id===tag)?.name;if(!record||!label)return;
    const choice=await choose('从这个情绪分类中移出？',`只取消“${label}”标签。\n这条记忆仍保留在全部记忆，以及它所属的其他分类中。`,[['cancel','保留分类'],['remove','移出这个分类','choice-primary']]);
    if(choice!=='remove')return;await S.mutate(id,'remove-tag',tag);B.dismissDetail();B.toast('已移出这个分类，记忆本身仍然保留。',{label:'查看记忆',run:()=>B.openMemory(id)});
  }
  async function discardDraft(key) { const choice=await choose('放弃这份草稿？','未正式保存的修改会被移除，已经存档的原记录不受影响。',[['cancel','保留草稿'],['discard','放弃草稿','choice-danger']]);if(choice==='discard'){await S.deleteDraft(key);B.toast('草稿已移除。');} }
  function decorateDetail(record) {
    B.detail.querySelector('.detail-actions')?.remove();
    const actions=document.createElement('div');actions.className='detail-actions';
    actions.innerHTML=record.deletedAt?`<button type="button" class="a-soft-button" data-detail-action="restore">${icon('restore')} 恢复记忆</button>`:`<button type="button" class="a-soft-button detail-edit" data-detail-action="edit">${icon('edit')} 编辑这条记忆</button><button type="button" class="a-soft-button" data-detail-action="renew">${icon('clock')} 保存时长</button>${B.state.tab==='view'&&record.tags.includes(B.state.category)?`<button type="button" class="detail-text-button" data-detail-action="remove">移出当前分类</button>`:''}<button type="button" class="detail-text-button" data-detail-action="trash">${icon('trash')} 移入回收站</button>`;
    B.detail.querySelector('.memory-detail-reading').after(actions);
    actions.addEventListener('click',run(async event=>{const action=event.target.closest('[data-detail-action]')?.dataset.detailAction;if(action==='edit')await openEditor(record.id);else if(action==='renew')await renewRecord(record.id);else if(action==='trash')await deleteRecord(record.id);else if(action==='restore')await restoreRecord(record.id);else if(action==='remove')await removeCategory(record.id,B.state.category);}));
    if(record.images.length>1){const gallery=document.createElement('div');gallery.className='detail-gallery';gallery.setAttribute('aria-label','记忆中的图片');gallery.innerHTML=record.images.map((img,i)=>`<button type="button" data-gallery="${esc(img.id)}" aria-label="查看第 ${i+1} 张图片" aria-pressed="${S.cover(record).id===img.id}"><img src="${esc(img.src)}" alt=""/></button>`).join('');gallery.addEventListener('click',event=>{const button=event.target.closest('[data-gallery]');if(!button)return;B.detail.querySelector('.memory-detail-visual > img').src=record.images.find(i=>i.id===button.dataset.gallery).src;gallery.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});B.detail.querySelector('.memory-detail-visual').appendChild(gallery);}
  }
  function showOverview(nextScope='day') {
    if(writing){requestLeave(()=>showOverview(nextScope));return;}
    B.dismissDetail();scope=nextScope;query='';$('record-search').value='';B.switchTab('edit',false);renderOverview();$('records-title').focus({preventScroll:true});
  }
  $('new-memory').addEventListener('click',run(()=>openEditor()));
  categoryAdd.addEventListener('click',run(()=>openEditor(null,{category:B.state.category})));
  pane.querySelectorAll('[data-scope]').forEach(b=>b.addEventListener('click',()=>{scope=b.dataset.scope;query='';$('record-search').value='';$('records-scroll').scrollTop=0;renderOverview();}));
  $('record-search').addEventListener('input',event=>{query=event.target.value;$('records-scroll').scrollTop=0;renderOverview();});
  $('record-empty-action').addEventListener('click',run(()=>{if(query){query='';$('record-search').value='';renderOverview();$('record-search').focus();}else return openEditor();}));
  $('record-list').addEventListener('click',run(async event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.openRecord)B.openMemory(button.dataset.openRecord,button);
    else if(button.dataset.editRecord)await openEditor(button.dataset.editRecord);
    else if(button.dataset.renew)await renewRecord(button.dataset.renew);
    else if(button.dataset.restore)await restoreRecord(button.dataset.restore);
    else if(button.dataset.discardDraft)await discardDraft(button.dataset.discardDraft);
    else if(button.dataset.resume){const draft=S.draft(button.dataset.resume);if(draft)await openEditor(draft.recordId,{resume:true});}
  }));
  function refresh() { renderOverview();renderCalendar();if(writing)renderChoices(); }
  S.subscribe(refresh);
  function tick() {
    if(document.hidden||$('experience').dataset.scene!=='archive')return;
    const records=S.lifetimes(),byId=new Map(records.map(r=>[r.id,r])),signature=records.filter(r=>!r.deletedAt&&S.due(r)).map(r=>`${r.id}:${S.expired(r)}`).join(',');
    if(signature!==expirySignature){expirySignature=signature;B.refresh();renderOverview();if(B.detail.open){const current=S.find(B.currentMemory());if(current)renderChoices();}}
    document.querySelectorAll('[data-remaining]').forEach(element=>{const record=byId.get(element.dataset.remaining);if(record){element.textContent=S.remaining(record);element.classList.toggle('is-expired',S.expired(record));}});
    if(writing?.original)renderChoices();
  }
  setInterval(tick,1000);
  window.RecordEditor={isOpen:()=>Boolean(writing),requestLeave,onTab,showOverview,decorateDetail,prepareImage,openNew:options=>openEditor(null,options).catch(fail),openExisting:id=>openEditor(id).catch(fail)};
  renderCalendar();renderOverview();onTab(B.state.tab);S.ready.then(()=>{refresh();B.refresh();});
})();
