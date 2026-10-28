/* memory-store.js */
(() => {
  'use strict';
  const DB_NAME = 'memory-archive-local-v1';
  const labels = { instant: '瞬时记忆', short: '短期记忆', long: '长期记忆', forever: '永久典藏' };
  const tagIds = ['regret', 'joy', 'weary', 'calm'];
  const scents = ['雨后泥土', '旧书纸香', '热咖啡'];
  const copy = value => structuredClone(value);
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const listeners = new Set();
  let db, records = [], drafts = [], status = 'loading', failure = '', queue = Promise.resolve(), channel;
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  function emit() { listeners.forEach(fn => { try { fn(); } catch (error) { console.error(error); } }); }
  function deadline(kind, from = Date.now()) {
    if (kind === 'forever') return null;
    if (kind === 'instant') return from + 30000;
    if (kind === 'short') return from + 7 * 86400000;
    const date = new Date(from), month = date.getMonth();
    date.setFullYear(date.getFullYear() + 1);
    if (date.getMonth() !== month) date.setDate(0);
    return date.getTime();
  }
  function expired(record) { return record.expiresAt !== null && record.expiresAt <= Date.now(); }
  function due(record) { return !record.deletedAt && record.expiresAt !== null && record.expiresAt <= Date.now() + 3 * 86400000; }
  function remaining(record) {
    if (record.deletedAt) return '已移入回收站';
    if (record.expiresAt === null) return '永恒 · 永久典藏';
    const ms = record.expiresAt - Date.now();
    if (ms <= 0) return '已到期 · 待处理';
    const prefix = { instant: '瞬时', short: '短期', long: '长期' }[record.retention];
    const seconds = Math.ceil(ms / 1000);
    const duration = seconds < 60 ? `${seconds} 秒` : seconds < 3600 ? `${Math.ceil(seconds / 60)} 分钟` : seconds < 86400 ? `${Math.ceil(seconds / 3600)} 小时` : `${Math.ceil(seconds / 86400)} 天`;
    return `${prefix} · 剩余 ${duration}`;
  }
  function normalizeSeed(record) {
    const now = Date.now(), kind = record.duration === '永久典藏' ? 'forever' : record.duration === '短期记忆' ? 'short' : 'long';
    const images = record.image ? [{ id: `seed-${record.id}`, src: `assets/${record.image}.webp`, name: record.title }] : [];
    return { id: record.id, title: record.title, body: record.body, date: record.date, time: record.time, location: record.location || '', tags: record.tags, images, coverId: images[0]?.id || null, scent: '', retention: kind, duration: labels[kind], expiresAt: record.expires ? now + parseInt(record.expires, 10) * 86400000 : deadline(kind, now), createdAt: now, updatedAt: now, revision: 1, deletedAt: null };
  }
  function request(req) { return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }
  function transactionDone(tx) { return new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error || new Error('本机保存失败')); tx.onabort = () => reject(tx.error || new Error('本机保存已取消')); }); }
  async function load() {
    const tx = db.transaction(['records', 'drafts'], 'readonly');
    const result = await Promise.all([request(tx.objectStore('records').getAll()), request(tx.objectStore('drafts').getAll())]);
    records = result[0]; drafts = result[1];
    emit();
  }
  function serialize(action) {
    const result = queue.then(async () => { await ready; if (status !== 'ready') throw new Error(failure || '当前浏览器无法保存，请使用本地预览地址打开。'); return action(); });
    queue = result.catch(() => {});
    return result;
  }
  async function afterWrite() { await load(); channel?.postMessage('changed'); }
  function validDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0,4)) < 1) return false;
    const parsed = new Date(`${date}T12:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10) === date;
  }
  function validate(data) {
    if (!data.body.trim() && !data.images.length) throw new Error('写下一点文字，或添加一张图片，再保存这段记忆。');
    if (data.body.length > 10000 || data.title.length > 80) throw new Error('正文最多 10000 字，标题最多 80 字。');
    if (!validDate(data.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(data.time)) throw new Error('请填写有效的发生日期和时间。');
    if (!Object.hasOwn(labels, data.retention)) throw new Error('请选择一种保存方式。');
    if (data.images.length > 6 || data.images.some(i => !/^(assets\/[\w-]+\.webp|data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+)$/.test(i.src))) throw new Error('图片尚未准备好，请重新选择。');
  }
  const Store = window.MemoryStore = {
    ready, labels, scents, uid, copy, deadline, expired, due, remaining, validDate,
    get status() { return status; }, get failure() { return failure; },
    list({ trash = false } = {}) { return copy(records.filter(r => trash ? Boolean(r.deletedAt) : !r.deletedAt).sort((a,b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`) || b.createdAt - a.createdAt)); },
    find(id) { const value = records.find(r => r.id === id); return value ? copy(value) : null; },
    lifetimes() { return records.map(({id,retention,expiresAt,deletedAt}) => ({id,retention,expiresAt,deletedAt})); },
    drafts() { return copy(drafts.slice().sort((a,b) => b.updatedAt - a.updatedAt)); },
    draft(key) { const value = drafts.find(d => d.key === key); return value ? copy(value) : null; },
    cover(record) { return record.images.find(i => i.id === record.coverId) || record.images[0] || null; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    snapshot() { return serialize(async()=>{await load();return copy({records,drafts});}); },
    async init(seeds) {
      records = seeds.map(normalizeSeed);
      try {
        db = await new Promise((resolve, reject) => {
          const open = indexedDB.open(DB_NAME, 1);
          open.onupgradeneeded = () => { const connection = open.result; connection.createObjectStore('records', { keyPath: 'id' }); connection.createObjectStore('drafts', { keyPath: 'key' }); connection.createObjectStore('meta'); };
          open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); open.onblocked = () => reject(new Error('请关闭其他正在升级档案的页面后重试。'));
        });
        const tx = db.transaction(['records','meta'], 'readwrite'), done = transactionDone(tx);
        const meta = tx.objectStore('meta'), initialized = meta.get('initialized');
        initialized.onsuccess = () => { if (!initialized.result) { records.forEach(r => tx.objectStore('records').put(r)); meta.put(true, 'initialized'); } };
        await done;
        status = 'ready';
        await load();
        if ('BroadcastChannel' in window) { channel = new BroadcastChannel(DB_NAME); channel.onmessage = () => serialize(load).catch(() => {}); }
        db.onversionchange = () => { db.close(); status = 'unavailable'; failure = '档案存储已更新，请刷新页面后继续。'; emit(); };
      } catch (error) { status = 'unavailable'; failure = `无法使用本机存储：${error.message || '浏览器限制'}。当前输入不会被当作已保存。`; }
      resolveReady(); emit();
    },
    save(data, { baseRevision = null, draftKey = null } = {}) {
      const input = copy(data);
      return serialize(async () => {
        validate(input);
        const tx = db.transaction(['records','drafts'], 'readwrite'), done = transactionDone(tx), store = tx.objectStore('records');
        let result, conflict;
        const req = store.get(input.id);
        req.onsuccess = () => {
          const old = req.result;
          if ((old && (old.deletedAt || old.revision !== baseRevision)) || (!old && baseRevision !== null)) { conflict = new Error('这条记忆已在另一个页面中更新。当前草稿已保留，请重新打开原记录核对后再保存。'); tx.abort(); return; }
          const now = Date.now();
          result = { id: input.id, title: input.title.trim() || input.body.trim().split(/[\n。！？]/)[0].slice(0,32) || '一段新的记忆', body: input.body.trim(), date: input.date, time: input.time, location: input.location.trim().slice(0,120), tags: [...new Set(input.tags)].filter(t => tagIds.includes(t)), images: input.images, coverId: input.images.some(i=>i.id===input.coverId) ? input.coverId : input.images[0]?.id || null, scent: scents.includes(input.scent) ? input.scent : '', retention: input.retention, duration: labels[input.retention], expiresAt: old && old.retention === input.retention ? old.expiresAt : deadline(input.retention, now), createdAt: old?.createdAt || now, updatedAt: now, revision: (old?.revision || 0) + 1, deletedAt: null };
          store.put(result); if (draftKey) tx.objectStore('drafts').delete(draftKey);
        };
        try { await done; } catch (error) { throw conflict || error; }
        await afterWrite();
        window.dispatchEvent(new CustomEvent('memory:committed',{detail:{kind:baseRevision===null?'created':'edited',record:copy(result)}}));
        return copy(result);
      });
    },
    saveDraft(draft) { const value = copy(draft); return serialize(async () => { const tx = db.transaction('drafts','readwrite'), done=transactionDone(tx); tx.objectStore('drafts').put(value); await done; await afterWrite(); }); },
    deleteDraft(key) { return serialize(async () => { const tx=db.transaction('drafts','readwrite'),done=transactionDone(tx); tx.objectStore('drafts').delete(key); await done; await afterWrite(); }); },
    mutate(id, kind, value) {
      return serialize(async () => {
        const tx=db.transaction(['records','drafts'],'readwrite'),done=transactionDone(tx),store=tx.objectStore('records');
        let result, issue;
        const req=store.get(id);
        req.onsuccess=()=>{
          const r=req.result;
          if(!r){issue=new Error('这条记忆已不存在。');tx.abort();return;}
          if(r.deletedAt && kind!=='restore'){issue=new Error('请先从回收站恢复这条记忆。');tx.abort();return;}
          if(kind==='trash'){r.deletedAt=Date.now();tx.objectStore('drafts').delete(`record:${id}`);}
          else if(kind==='restore')r.deletedAt=null;
          else if(kind==='remove-tag')r.tags=r.tags.filter(t=>t!==value);
          else if(kind==='renew' && Object.hasOwn(labels,value)){r.expiresAt=deadline(value, value===r.retention ? Math.max(Date.now(),r.expiresAt||0) : Date.now());r.retention=value;r.duration=labels[value];}
          else {issue=new Error('无法执行此操作。');tx.abort();return;}
          r.updatedAt=Date.now();r.revision+=1;store.put(r);result=r;
        };
        try{await done;}catch(error){throw issue||error;}
        await afterWrite();
        window.dispatchEvent(new CustomEvent('memory:committed',{detail:{kind,record:copy(result)}}));
        return copy(result);
      });
    },
  };
})();

;
/* profile-store.js */
(() => {
  'use strict';
  const S=window.MemoryStore, systemMotion=matchMedia('(prefers-reduced-motion: reduce)'), listeners=new Set(), motionListeners=new Set();
  let db,channel,status='loading',failure='',chain=Promise.resolve(),profile=null,prefs={revision:0,motion:'system',retention:'forever'},marks=[],events=[];
  const copy=S.copy, defaults=()=>({revision:1,nickname:'记忆旅人',bio:'把日常碎片存进岁月里。',gender:'',city:'',birthday:'',anniversary:'',avatar:'assets/avatar.webp',avatarSource:'',crop:{zoom:1,x:50,y:50},archiveId:'MEM-'+S.uid().replaceAll('-','').slice(0,8).toUpperCase(),createdAt:Date.now()});
  const request=r=>new Promise((yes,no)=>{r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);});
  const done=tx=>new Promise((yes,no)=>{tx.oncomplete=yes;tx.onabort=()=>no(tx.error||new Error('保存已取消'));tx.onerror=()=>no(tx.error||new Error('本机保存失败'));});
  const motion={get matches(){return prefs.motion==='reduce'||systemMotion.matches;},addEventListener(type,fn){if(type==='change')motionListeners.add(fn);},removeEventListener(type,fn){if(type==='change')motionListeners.delete(fn);}};
  let appliedMotion;
  function applyMotion(){const reduced=motion.matches;if(appliedMotion===reduced)return;appliedMotion=reduced;document.documentElement.dataset.motion=reduced?'reduce':'full';if(reduced){document.documentElement.style.setProperty('--pointer-x','0px');document.documentElement.style.setProperty('--pointer-y','0px');for(const a of document.getAnimations())if(a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity)try{a.finish();}catch{}}for(const fn of motionListeners)fn({matches:reduced});}
  systemMotion.addEventListener('change',applyMotion);applyMotion();
  window.ArchivePreferences={motion,get retention(){return prefs.retention;}};
  function emit(){applyMotion();for(const fn of listeners)try{fn();}catch(e){console.error(e);}}
  async function load(){const tx=db.transaction(['settings','marks','events'],'readonly');const [p,f,m,e]=await Promise.all([request(tx.objectStore('settings').get('profile')),request(tx.objectStore('settings').get('preferences')),request(tx.objectStore('marks').getAll()),request(tx.objectStore('events').getAll())]);profile=p||profile;prefs=f||prefs;marks=m;events=e.sort((a,b)=>b.at-a.at);emit();}
  const ready=(async()=>{try{
    db=await new Promise((yes,no)=>{const r=indexedDB.open('memory-archive-profile-v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('settings');r.result.createObjectStore('marks',{keyPath:'id'});r.result.createObjectStore('events',{keyPath:'id'});};r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);r.onblocked=()=>no(new Error('其他页面正在更新个人档案存储，请稍后重试。'));});
    const tx=db.transaction('settings','readwrite'),finished=done(tx),table=tx.objectStore('settings');
    const a=table.get('profile');a.onsuccess=()=>{if(!a.result)table.put(defaults(),'profile');};
    const b=table.get('preferences');b.onsuccess=()=>{if(!b.result)table.put({...prefs,revision:1},'preferences');};
    await finished;status='ready';await load();
    if('BroadcastChannel'in window){channel=new BroadcastChannel('memory-archive-profile-v1');channel.onmessage=()=>serial(load).catch(()=>{});}
    db.onversionchange=()=>{db.close();status='unavailable';failure='个人档案存储已更新，请刷新后继续。';emit();};
  }catch(error){status='unavailable';failure='个人档案暂时无法保存，请检查浏览器存储权限。';profile=defaults();emit();}})();
  function serial(fn){const p=chain.then(async()=>{await ready;if(status!=='ready')throw new Error(failure);return fn();});chain=p.catch(()=>{});return p;}
  async function afterWrite(){await load();channel?.postMessage('changed');}
  function validImage(src){return src==='assets/avatar.webp'||/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(src);}
  function validateProfile(p){
    if(!p.nickname.trim()||p.nickname.length>24)throw new Error('昵称请填写 1–24 个字符。');
    if(p.bio.length>140||p.city.length>40)throw new Error('简介最多 140 字，城市最多 40 字。');
    if(!['','female','male','other'].includes(p.gender))throw new Error('请重新选择性别。');
    if(p.birthday&&!S.validDate('2000-'+p.birthday))throw new Error('请填写有效的生日月、日，也可以都留空。');
    if(p.anniversary&&!S.validDate(p.anniversary))throw new Error('请填写有效的开馆纪念日，也可以留空。');
    if(!validImage(p.avatar)||p.avatarSource&&!validImage(p.avatarSource))throw new Error('头像尚未准备好，请重新选择。');
  }
  function saveSettings(key,value,revision){return serial(async()=>{
    const input=copy(value);if(key==='profile')validateProfile(input);else if(!['system','reduce'].includes(input.motion)||!Object.hasOwn(S.labels,input.retention))throw new Error('请选择有效的偏好。');
    const tx=db.transaction('settings','readwrite'),finished=done(tx),table=tx.objectStore('settings');let conflict;
    const r=table.get(key);r.onsuccess=()=>{const old=r.result;if(old.revision!==revision){conflict=new Error('另一页已更新这些设置。当前填写仍在，请核对后取消并重新打开，以免覆盖新内容。');conflict.name='ConflictError';tx.abort();return;}const next=key==='profile'?{...old,...input,nickname:input.nickname.trim(),bio:input.bio.trim(),city:input.city.trim(),archiveId:old.archiveId,createdAt:old.createdAt}:{...old,motion:input.motion,retention:input.retention};table.put({...next,revision:old.revision+1,updatedAt:Date.now()},key);};
    try{await finished;}catch(error){if(conflict)await load();throw conflict||error;}await afterWrite();return copy(key==='profile'?profile:prefs);
  });}
  window.ProfileStore={ready,get status(){return status;},get failure(){return failure;},profile:()=>copy(profile||defaults()),preferences:()=>copy(prefs),mark:id=>copy(marks.find(m=>m.id===id)||{id,favorite:false,growth:false}),marks:()=>copy(marks),events:()=>copy(events),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
    saveProfile:(p,revision)=>saveSettings('profile',p,revision),savePreferences:(p,revision)=>saveSettings('preferences',p,revision),
    setMark(id,kind,value){return serial(async()=>{const record=S.find(id);if(!record||record.deletedAt)throw new Error('这段记忆已不在正式存档中，请先恢复再添加。');if(!['favorite','growth'].includes(kind))throw new Error('未知的标记。');const tx=db.transaction(['marks','events'],'readwrite'),finished=done(tx),table=tx.objectStore('marks');const r=table.get(id);r.onsuccess=()=>{const old=r.result||{id,favorite:false,growth:false};if(Boolean(old[kind])===Boolean(value))return;const at=Date.now();table.put({...old,[kind]:Boolean(value),updatedAt:at});tx.objectStore('events').put({id:S.uid(),recordId:id,title:record.title,kind:kind+(value?'-add':'-remove'),at});};await finished;await afterWrite();});},
    recordActivity(detail){return serial(async()=>{const {kind,record}=detail,tx=db.transaction('events','readwrite'),finished=done(tx);tx.objectStore('events').put({id:`record:${record.id}:${record.revision}:${kind}`,recordId:record.id,title:record.title,kind,at:record.updatedAt});await finished;await afterWrite();});},
    snapshot:()=>serial(async()=>{await load();return copy({profile,preferences:prefs,marks,events});})
  };
})();

;
/* archive.js */
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
    return images.map((image, index) => `<span class="folder-photo" data-memory-id="${escapeHTML(image.memoryId)}" data-image-id="${escapeHTML(image.id)}" style="--photo-order:${index}"><img src="${escapeHTML(image.src)}" alt="" draggable="false" loading="lazy" decoding="async"/></span>`).join('');
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

;
/* record-editor.js */
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

;
/* assistant-store.js */
(() => {
  'use strict';
  let db,state='loading',failure='',chain=Promise.resolve();
  const request=r=>new Promise((yes,no)=>{r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);});
  const done=tx=>new Promise((yes,no)=>{tx.oncomplete=yes;tx.onabort=()=>no(tx.error||new Error('会话保存被取消'));tx.onerror=()=>no(tx.error||new Error('会话保存失败'));});
  const ready=(async()=>{try{
    db=await new Promise((yes,no)=>{const r=indexedDB.open('memory-archive-assistant-v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('conversations',{keyPath:'id'});r.result.createObjectStore('settings');};r.onsuccess=()=>yes(r.result);r.onerror=()=>no(r.error);r.onblocked=()=>no(new Error('会话存储正在被其他页面更新'));});
    state='ready';db.onversionchange=()=>{db.close();state='unavailable';failure='会话存储已更新，请刷新后继续。';};
  }catch{state='unavailable';failure='当前浏览器无法保存会话。输入仍可使用，刷新前请复制需要保留的内容。';}})();
  function serial(action){const p=chain.then(async()=>{await ready;if(state!=='ready')throw new Error(failure);return action();});chain=p.catch(()=>{});return p;}
  window.AssistantStore={ready,get status(){return state;},get failure(){return failure;},
    list:()=>serial(async()=>{const tx=db.transaction('conversations','readonly');return(await request(tx.objectStore('conversations').getAll())).sort((a,b)=>b.updatedAt-a.updatedAt);}),
    selected:()=>serial(async()=>request(db.transaction('settings','readonly').objectStore('settings').get('last'))),
    save(value){const snapshot=structuredClone(value);return serial(async()=>{
      const tx=db.transaction(['conversations','settings'],'readwrite'),finished=done(tx),table=tx.objectStore('conversations');let result;
      const r=table.get(snapshot.id);r.onsuccess=()=>{const old=r.result,conflict=old?old.revision!==snapshot.revision:snapshot.revision>0;result={...snapshot,id:conflict?window.MemoryStore.uid():snapshot.id,revision:conflict?1:(old?.revision||0)+1,updatedAt:Date.now()};if(conflict)result.title=`${snapshot.title||'新的对话'} · 副本`;table.put(result);tx.objectStore('settings').put(result.id,'last');};
      await finished;return result;
    });},
    remove:id=>serial(async()=>{const tx=db.transaction('conversations','readwrite'),finished=done(tx);tx.objectStore('conversations').delete(id);await finished;})
  };
})();

;
/* assistant-search.js */
(() => {
  'use strict';
  const S=window.MemoryStore,pad=n=>String(n).padStart(2,'0'),normalize=s=>String(s||'').toLocaleLowerCase().trim();
  const emotions=[['regret',['遗憾','愤怒']],['joy',['心动','兴奋','开心']],['weary',['怅然','倦怠','疲惫']],['calm',['平静','满足']]];
  const aliases=[['下雨','雨天','雨滴','雨'],['咖啡','coffee'],['告别','离别','车站','站台'],['桂花','花香'],['晚霞','夕阳','日落'],['相聚','聚餐','火锅'],['信件','信']];
  function query(text,scope,records){
    const raw=normalize(text),anchor=S.validDate(scope.date)?scope.date:'3050-09-01';
    if(/不知道.{0,5}写|写什么|记录灵感|给.{0,4}灵感|怎么开始记录/.test(raw))return{kind:'inspiration',text:'不用把今天写成一篇完整的故事。可以从一个很小的细节开始：\n\n① 今天有什么让你停下脚步？\n② 那时看见、听见或闻到了什么？\n③ 想给当时的自己留下一句话吗？\n\n选择其中一个问题，写两三句就好。',draft:'今天让我停下脚步的是……\n那一刻，我注意到……\n想留给自己的一句话：',records:[],scopeLabel:'记录灵感 · 本地演示'};
    if(/^(你好|嗨|hello|谢谢|你是谁|小忆)[！!。?？\s]*$/.test(raw))return{kind:'help',text:'你好，我是小忆。可以帮你在本机档案里找回一段记忆，也可以陪你开始记录。\n\n试试“找找和下雨有关的记忆”“回顾这个月的记录”，或直接输入一个关键词。\n\n当前是本地演示，不连接通用 AI 服务。',records:[],scopeLabel:'小忆 · 本地演示'};
    if(/天气预报|股票|股价|写.{0,8}代码|编程|python|javascript|新闻|翻译|数学题|联网|写一篇|写一首/.test(raw))return{kind:'unsupported',text:'这个问题超出了当前演示范围。我现在可以查找本机记忆、按日期或心情回顾，以及提供记录提示。\n\n可以换成一段记忆的关键词，或试试示例问题。',records:[],scopeLabel:'能力范围 · 本地演示'};
    const exactTitle=records.some(r=>!r.deletedAt&&normalize(r.title)===raw);
    let from='',to='',rest=exactTitle?'':raw,rangeLabel='全部日期',invalid=false;
    if(scope.range==='day'){from=to=anchor;rangeLabel=anchor;}
    if(scope.range==='month'){from=anchor.slice(0,7)+'-01';to=anchor.slice(0,7)+'-31';rangeLabel=anchor.slice(0,7);}
    if(scope.range==='custom'){from=scope.from;to=scope.to;invalid=!S.validDate(from)||!S.validDate(to)||from>to;rangeLabel=`${from} 至 ${to}`;}
    const full=rest.match(/(\d{4})[年\-/.](\d{1,2})[月\-/.](\d{1,2})日?/),month=rest.match(/(\d{4})[年\-/.](\d{1,2})月?(?![\d\-/.])/),shortDate=rest.match(/(\d{1,2})月(\d{1,2})日?/),shortMonth=rest.match(/(\d{1,2})月/);
    if(full||shortDate){const m=full||shortDate;from=to=full?`${m[1]}-${pad(m[2])}-${pad(m[3])}`:`${anchor.slice(0,4)}-${pad(m[1])}-${pad(m[2])}`;invalid=!S.validDate(from);rangeLabel=from;rest=rest.replace(m[0],' ');}
    else if(month||shortMonth){const m=month||shortMonth,prefix=month?`${m[1]}-${pad(m[2])}`:`${anchor.slice(0,4)}-${pad(m[1])}`;from=prefix+'-01';to=prefix+'-31';invalid=!S.validDate(from);rangeLabel=prefix;rest=rest.replace(m[0],' ');}
    else if(/今天|当天/.test(rest)){from=to=anchor;rangeLabel=anchor;rest=rest.replace(/今天|当天/g,' ');}
    else if(/本月|这个月|这月/.test(rest)){from=anchor.slice(0,7)+'-01';to=anchor.slice(0,7)+'-31';rangeLabel=anchor.slice(0,7);rest=rest.replace(/本月|这个月|这月/g,' ');}
    else if(/上个月|上月/.test(rest)){const d=new Date(anchor.slice(0,7)+'-01T12:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);const prefix=d.toISOString().slice(0,7);from=prefix+'-01';to=prefix+'-31';rangeLabel=prefix;rest=rest.replace(/上个月|上月/g,' ');}
    else if(/最近\s*7\s*天|近七天/.test(rest)){to=anchor;const d=new Date(anchor+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-6);from=d.toISOString().slice(0,10);rangeLabel=`${from} 至 ${to}`;rest=rest.replace(/最近\s*7\s*天|近七天/g,' ');}
    if(from&&(!S.validDate(from)||from>'9999-12-31'))invalid=true;
    if(invalid)return{kind:'invalid',text:'这个日期范围还不能用于查找。请填写有效的开始和结束日期，并让结束日期不早于开始日期。',records:[],scopeLabel:'请调整日期范围'};
    const tags=emotions.filter(([,words])=>words.some(w=>rest.includes(w))).map(([id])=>id);
    for(const [,words]of emotions)for(const w of words)rest=rest.replaceAll(w,' ');
    const due=/到期|待处理/.test(rest),forever=/永恒|永久/.test(rest),images=/照片|图片|图像/.test(rest);
    rest=rest.replace(/即将到期|已经到期|已到期|待处理|到期|永久典藏|永久|永恒|照片|图片|图像/g,' ');
    for(const p of ['小忆','请帮我','帮我','帮忙','能不能','可以帮','查找一下','寻找一下','找一下','找一找','找找','查找','检索','寻找','找回','回顾一下','回顾','整理一下','看看','看一看','有关的','相关的','有没有','我想找','我想看','我的','所有','全部','最近','记忆','记录','存档','关于','包含'])rest=rest.replaceAll(p,' ');
    rest=rest.replace(/^[\s和与的]+|[\s的有关呢吗呀吧]+$/g,'').replace(/[，。！？、：；“”「」,.!?;:"'()（）]/g,' ');
    const tokens=exactTitle?[raw]:rest.split(/\s+/).filter(t=>t&&!['和','与','的','找','我','请','一下'].includes(t)),groups=exactTitle?[[raw]]:tokens.map(t=>aliases.find(g=>g.includes(t))||[t]),selected=scope.tag&&scope.tag!=='all'?scope.tag:null;
    const matches=records.filter(r=>{if(r.deletedAt||from&&r.date<from||to&&r.date>to)return false;if(selected&&!r.tags.includes(selected)||tags.length&&!tags.some(t=>r.tags.includes(t)))return false;if(due&&!S.due(r)||forever&&r.retention!=='forever'||images&&!r.images.length)return false;const hay=normalize(`${r.title} ${r.body} ${r.location} ${r.date} ${r.scent}`);return groups.every(g=>g.some(t=>hay.includes(t)));});
    const name=id=>window.MemoryArchive.bridge.categories.find(c=>c.id===id)?.name;
    const scopeLabel=[rangeLabel,selected?name(selected):null,tags.map(name).join(' / '),due?'待处理':null,forever?'永恒':null,images?'含图片':null,tokens.length?'线索：'+tokens.join('、'):null].filter(Boolean).join(' · ');
    return{kind:'search',text:matches.length?`按这次的范围与线索，找到 ${matches.length} 段记忆。\n点开卡片，就能重新看看那一刻。${matches.some(S.expired)?'\n其中有已到期的记忆，内容仍保留在待处理里。':''}`:'这次没有找到相符的记忆。\n可以减少关键词、换一个日期范围，或先记录下你想到的片段。',records:matches,scopeLabel};
  }
  window.AssistantSearch={query};
})();

;
/* assistant.js */
(() => {
  'use strict';
  const S=window.MemoryStore,DB=window.AssistantStore,B=window.MemoryArchive.bridge;
  const {byId:$,icon,escapeHTML:esc,asset}=B, pane=$('pane-ai'),rail=$('archive-context-rail');
  const reduced=window.ArchivePreferences.motion;
  const starters=['找找和下雨有关的记忆','回顾这个月的记录','今天不知道写什么'];
  const presets=[{id:'rain',name:'雨天胶片',asset:'memory-rain'},{id:'coffee',name:'暖光日常',asset:'memory-coffee'},{id:'sunset',name:'晚霞手记',asset:'memory-sunset'}];
  let conversations=new Map(),conv=fresh(),loaded=false,job=null,saveTimer,persistChain=Promise.resolve(),version=0,savedVersion=0,storageError='',navigating=false,follow=true,modalToken=0,modalMode='',modalData={},modalTrigger=null,voiceTimer=null,disposed=false;
  function fresh(){return{id:S.uid(),revision:0,title:'新的对话',createdAt:Date.now(),updatedAt:Date.now(),input:'',view:'home',scroll:0,messages:[],scope:{range:'all',date:B.state.calendarDate,from:B.state.calendarDate,to:B.state.calendarDate,tag:'all'}};}
  pane.className='archive-pane ai-workspace';
  pane.innerHTML=`<header class="ai-heading"><button type="button" class="a-icon-button" id="ai-home-button" aria-label="返回小忆首页">${icon('back')}</button><img class="ai-header-avatar" src="${asset('assistant')}" alt=""/><div><p class="a-eyebrow">YOUR MEMORY COMPANION</p><h1 id="ai-title" tabindex="-1">小忆，陪你重新发现</h1></div><div class="ai-heading-actions"><span class="ai-demo-tag">本地演示</span><button type="button" class="a-soft-button" id="ai-new">${icon('plus')} 新对话</button><button type="button" class="a-icon-button" id="ai-history" aria-label="查看历史会话" title="历史会话">${icon('clock')}</button></div></header>
    <div class="ai-home" id="ai-home"><div class="ai-hero"><div class="ai-orbit"></div><img src="${asset('assistant')}" alt="微笑的小忆助手" draggable="false"/><div><span>那些微小的瞬间，我陪你一起找。</span><p>一句话，重新遇见一段记忆。</p></div></div><div class="ai-modes">${[['voice','mic','语音聊天','把心事，慢慢说出来'],['text','message','文字聊天','从一句想起的话开始'],['image','image','生成图片','为记忆挑选一种画面'],['photo','scan','拍照检索','用图片与线索找回往事']].map(([mode,i,name,copy])=>`<button type="button" data-ai-mode="${mode}">${icon(i)}<span>${name}<small>${copy}</small></span>${icon('arrow')}</button>`).join('')}</div><div class="ai-starters">${starters.map(t=>`<button type="button" data-ai-starter="${t}">${t}${icon('arrow')}</button>`).join('')}</div></div>
    <div class="ai-chat-wrap" id="ai-chat-wrap" hidden><div class="ai-feed" id="ai-feed" tabindex="0" aria-label="与小忆的对话，可滚动阅读"><div id="ai-messages"></div></div><button type="button" id="ai-new-reply" hidden>查看新回复 ↓</button></div>
    <div class="ai-storage-error" id="ai-storage-error" role="alert" hidden><span></span><button type="button" id="ai-retry-save">重试保存</button></div>
    <form class="ai-composer" id="ai-form"><label class="sr-only" for="ai-input">给小忆的消息</label><textarea id="ai-input" rows="2" maxlength="2000" placeholder="随便问问，或者输入一段记忆的线索……" disabled></textarea><div class="ai-composer-row"><div class="ai-composer-tools">${[['voice','mic','语音演示'],['image','image','图片示例'],['photo','scan','图片辅助检索']].map(([mode,i,name])=>`<button type="button" data-ai-mode="${mode}" aria-label="${name}" title="${name}">${icon(i)}</button>`).join('')}<span id="ai-input-count">0 / 2000</span></div><span class="ai-key-hint">Enter 发送 · Shift+Enter 换行</span><button type="button" id="ai-stop" hidden>停止回复 <span>■</span></button><button type="submit" id="ai-send" disabled>发送 ${icon('arrow')}</button></div></form>
    <div class="ai-footer-note"><span>基于本机存档 · 演示回复，不连接 AI 服务</span><span id="ai-save-state" role="status">正在打开会话…</span></div><span class="sr-only" id="ai-live" role="status" aria-live="polite"></span>`;
  const modal=document.createElement('dialog');modal.id='ai-dialog';modal.className='ai-dialog';modal.setAttribute('aria-labelledby','ai-dialog-title');
  modal.innerHTML=`<header><div><p class="a-eyebrow">A LITTLE ROOM FOR YOUR THOUGHTS</p><h2 id="ai-dialog-title"></h2></div><button type="button" class="a-icon-button" id="ai-dialog-close" aria-label="关闭窗口">${icon('close')}</button></header><p id="ai-dialog-description"></p><div id="ai-dialog-content"></div><p id="ai-dialog-error" role="alert" hidden></p>`;
  document.body.appendChild(modal);
  function errorText(error){return error?.name==='QuotaExceededError'?'本机空间不足，会话尚未保存。当前内容仍在，可以复制后整理空间再重试。':error?.message||'会话尚未保存，当前输入仍保留。';}
  const safe=fn=>event=>Promise.resolve().then(()=>fn(event)).catch(error=>{if(modal.open){$('ai-dialog-error').textContent=errorText(error);$('ai-dialog-error').hidden=false;}else B.toast(errorText(error));});
  function storageStatus(){const error=$('ai-storage-error');error.hidden=!storageError;error.querySelector('span').textContent=storageError;$('ai-save-state').textContent=storageError?'会话未保存':!loaded?'正在打开会话…':version>savedVersion?'正在保留会话…':'会话保存在此浏览器';}
  function changed(){version++;clearTimeout(saveTimer);storageStatus();saveTimer=setTimeout(()=>persist().catch(()=>{}),220);}
  function persist(){
    clearTimeout(saveTimer);
    const p=persistChain.then(async()=>{
      if(!loaded||version===savedVersion)return;
      if(!conv.messages.length&&!conv.input){savedVersion=version;storageStatus();return;}
      const target=conv,v=version,oldId=target.id;
      try{const saved=await DB.save(target);target.id=saved.id;target.revision=saved.revision;if(saved.id!==oldId)target.title=saved.title;target.updatedAt=saved.updatedAt;conversations.set(saved.id,saved);if(target===conv){savedVersion=v;storageError='';try{sessionStorage.setItem('memory-assistant-active',saved.id);}catch{}if(saved.id!==oldId)B.toast('另一页也更新了此会话，当前内容已另存为副本。');storageStatus();}return saved;}
      catch(error){storageError=errorText(error);storageStatus();throw error;}
    });persistChain=p.catch(()=>{});return p;
  }
  function controls(){const input=$('ai-input');input.disabled=!loaded;$('ai-send').disabled=!loaded||!input.value.trim()||Boolean(job);$('ai-send').hidden=Boolean(job);$('ai-stop').hidden=!job;$('ai-input-count').textContent=`${input.value.length} / 2000`;pane.querySelectorAll('[data-ai-mode]').forEach(b=>{b.disabled=!loaded||Boolean(job);});$('ai-new').disabled=!loaded||navigating;$('ai-history').disabled=!loaded||navigating;}
  function replyView(m,records=S.list()){
    if(m.kind==='image'){const p=presets.find(p=>p.id===m.preset)||presets[0];return{kind:'image',text:`这是“${p.name}”的预设示例画面。\n它来自现有素材，不会根据描述实时生成。你可以把这张画面与描述一起带入记忆草稿。`,records:[],scopeLabel:'预设素材 · 非实时生成',preset:p,draft:m.query};}
    if(S.status!=='ready')return{kind:'unavailable',text:'本机记忆存储暂时不可用，无法核对存档内容。请保留当前输入，检查浏览器存储权限后刷新再试。',records:[],scopeLabel:'存档暂不可读取'};
    return window.AssistantSearch.query(m.query,m.scope,records);
  }
  function card(r){const cover=S.cover(r);return`<button type="button" class="ai-memory-card" data-ai-memory="${esc(r.id)}">${cover?`<img src="${esc(cover.src)}" alt=""/>`:`<span class="ai-card-art">${icon('text')}</span>`}<span><small>${esc(r.date)} · ${esc(r.time)}</small><strong>${esc(r.title)}</strong><em data-remaining="${esc(r.id)}">${esc(S.remaining(r))}</em></span>${icon('arrow')}</button>`;}
  function messageHTML(m,records){
    if(m.role==='user')return`<article class="ai-message ai-user" data-message="${m.id}"><div class="ai-message-meta">你${m.mode==='voice'?' · 示例语音转写':m.mode==='photo'?' · 图片辅助检索':m.mode==='draft'?' · 准备记录':''}</div><div class="ai-user-bubble">${m.attachment?`<img src="${esc(m.attachment.src)}" alt="${m.mode==='draft'?'准备带入草稿的配图':'用户选择的检索图片'}"/><small>${m.mode==='draft'?'配图已随这段内容保留':'图片仅作线索展示，未进行图像识别'}</small>`:''}<p>${esc(m.text)}</p></div><div class="ai-message-actions"><button type="button" data-draft-user="${m.id}">${m.mode==='draft'?'再次带入草稿':'写成记忆'} ${icon('edit')}</button></div></article>`;
    const view=replyView(m,records),finished=m.status==='complete',stopped=m.status==='stopped',partial=finished?view.text:view.text.slice(0,m.visible||0),items=finished?view.records.slice(0,m.limit||4):[];
    const gone=(m.initialIds||[]).filter(id=>!view.records.some(r=>r.id===id));
    return`<article class="ai-message ai-assistant" data-message="${m.id}"><img class="ai-message-avatar" src="${asset('nav-ai')}" alt=""/><div class="ai-reply-content"><div class="ai-message-meta">小忆 <span>本地演示</span>${stopped?'<em>已停止</em>':''}</div><div class="ai-reply-bubble"><p class="ai-reply-text">${esc(partial)}</p>${!finished&&!stopped?`<span class="ai-thinking">${m.visible?'正在呈现回复':'正在查找与整理'}<i></i><i></i><i></i></span>`:''}${stopped&&!partial?'<p class="ai-paused-copy">回复已停止，内容还没展开。可以继续，也可以直接问新的问题。</p>':''}${finished?`<div class="ai-answer-scope">${esc(view.scopeLabel)}</div>${items.length?`<div class="ai-result-grid">${items.map(card).join('')}</div>`:''}${gone.length?'<p class="ai-result-update">部分原结果已修改或移入回收站，卡片已按当前存档更新。</p>':''}${view.records.length>items.length?`<button type="button" class="ai-more-results" data-more="${m.id}">再看 ${Math.min(4,view.records.length-items.length)} 段 · 共 ${view.records.length} 段 ${icon('arrow')}</button>`:''}${view.kind==='image'?`<figure class="ai-generated-example"><img src="${asset(view.preset.asset)}" alt="${view.preset.name}的预设示例素材"/><figcaption>示例画面 · ${view.preset.name} · 来自预设素材</figcaption></figure>`:''}`:''}</div><div class="ai-message-actions">${finished?`<button type="button" data-copy="${m.id}">复制回复</button>${view.draft||view.kind==='search'&&!view.records.length?`<button type="button" data-draft-reply="${m.id}">${view.kind==='image'?'画面带入草稿':'开始记录'} ${icon('edit')}</button>`:''}${['search','invalid'].includes(view.kind)?`<button type="button" data-query-again="${m.id}">按新范围再查一次</button>`:''}`:stopped?`<button type="button" data-continue="${m.id}">继续回复 ${icon('arrow')}</button>`:''}</div></div></article>`;
  }
  function renderMessages({bottom=false}={}){
    const feed=$('ai-feed'),old=feed.scrollTop,records=S.list();
    $('ai-messages').innerHTML=conv.messages.length?conv.messages.map(m=>messageHTML(m,records)).join(''):`<div class="ai-empty-thread"><img src="${asset('nav-ai')}" alt=""/><h2>想起什么，就从哪里开始。</h2><p>输入关键词，或告诉我你想回顾的日期。</p><div>${starters.map(t=>`<button type="button" data-ai-starter="${t}">${t}</button>`).join('')}</div></div>`;
    feed.scrollTop=bottom?feed.scrollHeight:old;
    if(bottom){follow=true;$('ai-new-reply').hidden=true;}
  }
  function setView(view,focus=false){const previous=conv.view,from=previous==='home'&&view==='chat'?pane.querySelector('.ai-hero > img').getBoundingClientRect():null;conv.view=view;const home=view==='home';$('ai-home').hidden=!home;$('ai-chat-wrap').hidden=home;$('ai-home-button').hidden=home;$('ai-title').textContent=home?'小忆，陪你重新发现':'和小忆聊一会儿';pane.classList.toggle('is-chatting',!home);if(!home)renderMessages();if(previous!==view&&B.state.tab==='ai'){B.animatePane($(home?'ai-home':'ai-chat-wrap'));if(from?.width&&!reduced.matches){const target=pane.querySelector('.ai-header-avatar'),to=target.getBoundingClientRect();if(to.width){document.querySelector('.ai-mascot-travel')?.remove();const clone=document.createElement('img');clone.src=asset('assistant');clone.alt='';clone.className='ai-mascot-travel';Object.assign(clone.style,{left:from.x+'px',top:from.y+'px',width:from.width+'px',height:from.height+'px'});document.body.appendChild(clone);clone.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${to.x+to.width/2-from.x-from.width/2}px,${to.y+to.height/2-from.y-from.height/2}px) scale(${Math.min(to.width/from.width,to.height/from.height)})`,opacity:0}],{duration:380,easing:'cubic-bezier(.22,1,.36,1)'}).finished.then(()=>clone.remove(),()=>clone.remove());}}}if(focus)$('ai-input').focus({preventScroll:true});controls();}
  function renderRail(){
    if(B.state.tab!=='ai')return;
    if(!$('ai-rail-content')){
      rail.innerHTML=`<div id="ai-rail-content"><div class="ai-rail-heading"><div><p class="a-eyebrow">THREADS OF MEMORY</p><h2>把记忆，慢慢串起来</h2></div><img src="${asset('nav-ai')}" alt=""/></div><section class="ai-scope-panel"><div class="ai-label-row"><h3>下一次查找范围</h3><span id="ai-record-total"></span></div><div class="ai-scope-row"><label>日期范围<select id="ai-range"><option value="all">全部日期</option><option value="day">参考日当天</option><option value="month">参考日当月</option><option value="custom">自选范围</option></select></label><label>档案参考日<input type="date" id="ai-anchor" min="0001-01-01" max="9999-12-31"/></label></div><div class="ai-custom-dates" id="ai-custom-dates" hidden><label>开始<input type="date" id="ai-from" min="0001-01-01" max="9999-12-31"/></label><label>结束<input type="date" id="ai-to" min="0001-01-01" max="9999-12-31"/></label></div><label class="ai-emotion-filter">心情<select id="ai-tag"><option value="all">所有心情</option>${B.categories.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}</select></label><p>“今天 / 本月”按档案参考日理解。消息里明确写出的日期优先。</p></section><section class="ai-related-section"><div class="ai-label-row"><h3>这次想起的记忆</h3><span id="ai-related-count"></span></div><div id="ai-related"></div></section><div class="ai-rail-footer"><span>只查找正式存档 · 不含草稿与回收站</span><p>回复由本地规则组织。语音、图片生成与识别为标注清楚的演示。</p><button type="button" id="ai-browse">去看看全部记忆 ${icon('arrow')}</button></div></div>`;
      for(const [id,key]of [['ai-range','range'],['ai-anchor','date'],['ai-from','from'],['ai-to','to'],['ai-tag','tag']])$(id).addEventListener('change',()=>{conv.scope[key]=$(id).value;$('ai-custom-dates').hidden=conv.scope.range!=='custom';changed();});
      $('ai-related').addEventListener('click',openCard);$('ai-browse').addEventListener('click',()=>{B.switchTab('view',false);B.openCategory('all');});
    }
    for(const [id,key]of [['ai-range','range'],['ai-anchor','date'],['ai-from','from'],['ai-to','to'],['ai-tag','tag']])if(document.activeElement!==$(id))$(id).value=conv.scope[key];
    $('ai-custom-dates').hidden=conv.scope.range!=='custom';renderRelated();
  }
  function renderRelated(){if(!$('ai-related')||B.state.tab!=='ai')return;const all=S.list(),m=conv.messages.findLast(m=>m.role==='assistant'&&m.status==='complete'),view=m?replyView(m,all):null,items=view?.records||[];$('ai-record-total').textContent=S.status==='ready'?`${all.length} 段存档`:'存档暂不可读取';$('ai-related-count').textContent=items.length?`${items.length} 段`:'';$('ai-related').innerHTML=items.length?`<p class="ai-related-scope">${esc(view.scopeLabel)}</p>${items.slice(0,6).map(card).join('')}`:`<div class="ai-related-empty">${icon('search')}<p>${m?'这次还没有关联的记忆。':'从左边的一句提问开始。'}</p><span>${m?'换个词或日期，继续找找看。':'找到的片段，会在这里等你。'}</span></div>`;}
  function openCard(event){const button=event.target.closest('[data-ai-memory]');if(!button)return;const r=S.find(button.dataset.aiMemory);if(!r||r.deletedAt){B.toast('这段记忆已不在当前存档中，请重新查找。');renderMessages();renderRelated();return;}B.openMemory(r.id,button);}
  function finishReply(){if(!job)return;const m=job.message;clearInterval(job.timer);m.status='complete';m.visible=replyView(m).text.length;job=null;renderMessages({bottom:follow});renderRelated();controls();$('ai-live').textContent='小忆的演示回复已完成';if(!follow)$('ai-new-reply').hidden=false;changed();}
  function beginReply(m){
    m.status='writing';job={message:m,timer:null};controls();renderMessages({bottom:follow});
    if(reduced.matches){finishReply();return;}
    const full=replyView(m).text,step=Math.max(4,Math.ceil(full.length/22));
    job.timer=setInterval(()=>{if(!job||job.message!==m)return;m.visible=Math.min(full.length,(m.visible||0)+step);const el=pane.querySelector(`[data-message="${m.id}"] .ai-reply-text`);if(el)el.textContent=full.slice(0,m.visible);if(follow)$('ai-feed').scrollTop=$('ai-feed').scrollHeight;else $('ai-new-reply').hidden=false;if(m.visible>=full.length)finishReply();},45);
  }
  function stopReply(){if(!job)return;const m=job.message;clearInterval(job.timer);m.status='stopped';job=null;renderMessages({bottom:follow});controls();$('ai-live').textContent='回复已停止，已显示的内容保留';changed();}
  function send({text=null,mode='text',attachment=null,image=null}={}){
    if(!loaded||job)return;
    const fromComposer=text===null,value=String(fromComposer?$('ai-input').value:text).trim().slice(0,2000);if(!value)return;
    const scopeError=!S.validDate(conv.scope.date)?'请先填写有效的档案参考日。':conv.scope.range==='custom'&&(!S.validDate(conv.scope.from)||!S.validDate(conv.scope.to)||conv.scope.from>conv.scope.to)?'请检查右侧自选日期范围，结束日期不能早于开始日期。':'';
    if(scopeError){if(modal.open){$('ai-dialog-error').textContent=scopeError;$('ai-dialog-error').hidden=false;}else{B.toast(scopeError);$(S.validDate(conv.scope.date)?'ai-from':'ai-anchor')?.focus();}return false;}
    if(!conv.messages.length)conv.title=value.slice(0,24);
    conv.messages.push({id:S.uid(),role:'user',text:value,mode,attachment:S.copy(attachment),createdAt:Date.now()});
    const m={id:S.uid(),role:'assistant',kind:image?'image':'query',query:value,preset:image?.preset,scope:S.copy(conv.scope),status:'writing',visible:0,limit:4};
    m.initialIds=replyView(m).records.map(r=>r.id);conv.messages.push(m);
    if(fromComposer){conv.input='';$('ai-input').value='';}
    follow=true;setView('chat');beginReply(m);changed();persist().catch(()=>{});$('ai-live').textContent='消息已发送，小忆正在整理本地演示回复';return true;
  }
  function closeModal(){modalToken++;clearTimeout(voiceTimer);if(modal.open)modal.close();}
  function openModal(mode,title,description,html){modalToken++;clearTimeout(voiceTimer);modalTrigger=document.activeElement;modalMode=mode;modalData={};$('ai-dialog-title').textContent=title;$('ai-dialog-description').textContent=description;$('ai-dialog-content').innerHTML=html;$('ai-dialog-error').hidden=true;if(!modal.open)modal.showModal();requestAnimationFrame(()=>(modal.querySelector('textarea,input:not([type=file]),select')||$('ai-dialog-close')).focus({preventScroll:true}));}
  function openMode(mode){
    if(job){B.toast('可以先停止当前回复，再打开其他方式。');return;}
    if(mode==='text'){setView('chat',true);B.animatePane($('ai-chat-wrap'));changed();return;}
    if(mode==='voice'){
      openModal('voice','把一句话，慢慢说出来','语音交互演示 · 不录音、不调用麦克风。下方展示预设话题的示例转写。',`<div class="ai-voice-stage"><img src="${asset('assistant')}" alt="小忆"/><div class="ai-wave" id="ai-wave" aria-hidden="true">${Array.from({length:17},(_,i)=>`<i style="--i:${i}"></i>`).join('')}</div><p id="ai-voice-state" role="status">选一个话题，看看语音输入的过程。</p></div><label class="ai-field">示例话题<select id="ai-voice-topic">${starters.map(t=>`<option>${t}</option>`).join('')}</select></label><button type="button" class="a-soft-button ai-wide" data-modal-action="voice-start">演示一次语音输入 ${icon('mic')}</button><label class="ai-field">示例转写 · 可以修改<textarea id="ai-transcript" rows="3" maxlength="2000" placeholder="示例文字会出现在这里，也可以直接输入。"></textarea></label><div class="ai-modal-actions"><button type="button" class="a-soft-button" data-modal-action="close">取消</button><button type="button" class="a-soft-button ai-primary" data-modal-action="voice-send">发送这段文字 ${icon('arrow')}</button></div>`);
    } else if(mode==='image'){
      openModal('image','给记忆，挑一种画面','图片生成流程演示 · 使用预设素材展示效果，不根据描述实时生成图片。',`<label class="ai-field">你想留下怎样的画面？<textarea id="ai-image-prompt" rows="3" maxlength="300" placeholder="比如：雨停之后，街角的咖啡还冒着热气。"></textarea></label><fieldset class="ai-preset-options"><legend>示例风格</legend>${presets.map((p,i)=>`<button type="button" data-preset="${p.id}" aria-pressed="${i===0}"><img src="${asset(p.asset)}" alt=""/><span>${p.name}</span></button>`).join('')}</fieldset><button type="button" class="a-soft-button ai-wide" data-modal-action="image-preview">查看示例效果 ${icon('image')}</button><div id="ai-image-preview" hidden></div><div class="ai-modal-actions" id="ai-image-actions" hidden><button type="button" class="a-soft-button" data-modal-action="image-chat">放进对话</button><button type="button" class="a-soft-button ai-primary" data-modal-action="image-draft">带入记忆草稿 ${icon('edit')}</button></div>`);modalData.preset='rain';
      $('ai-image-prompt').addEventListener('input',()=>{modalData.preview=null;$('ai-image-preview').hidden=true;$('ai-image-actions').hidden=true;});
    } else if(mode==='photo'){
      const photos=S.list().filter(r=>r.images.length);
      openModal('photo','从一张照片，找回线索','图片辅助检索 · 不打开摄像头、不识别图像内容。请补充文字线索来查找存档。',`<div class="ai-photo-upload"><button type="button" class="a-soft-button" data-modal-action="photo-pick">${icon('image')} 选择本机图片</button><span>JPEG / PNG / WebP · 单张不超过 10 MB</span><input type="file" id="ai-photo-file" accept="image/jpeg,image/png,image/webp" hidden/></div><div id="ai-photo-preview" hidden></div><p class="ai-field-caption">或者，选择档案中的一张图片</p><div class="ai-photo-choices">${photos.map(r=>`<button type="button" data-photo-record="${r.id}" aria-label="选择：${esc(r.title)}"><img src="${esc(S.cover(r).src)}" alt=""/><span>${esc(r.title)}</span></button>`).join('')||'<p>还没有带图片的存档，可以先上传一张。</p>'}</div><label class="ai-field">查找线索<textarea id="ai-photo-clue" rows="2" maxlength="1000" placeholder="例如：咖啡、下雨，或记忆发生的日期。"></textarea></label><div class="ai-modal-actions"><button type="button" class="a-soft-button" data-modal-action="close">取消</button><button type="button" class="a-soft-button ai-primary" data-modal-action="photo-send">查找相关记忆 ${icon('search')}</button></div>`);
      $('ai-photo-file').addEventListener('change',safe(async event=>{const file=event.target.files[0];if(!file)return;const token=modalToken;modalData.processing=true;modal.querySelector('[data-modal-action="photo-send"]').disabled=true;try{const result=await window.RecordEditor.prepareImage(file);if(token!==modalToken)return;modalData.photo=result;renderPhoto();$('ai-dialog-error').hidden=true;}catch(error){if(token===modalToken)throw error;}finally{if(token===modalToken){modalData.processing=false;modal.querySelector('[data-modal-action="photo-send"]').disabled=false;event.target.value='';}}}));
    }
  }
  function renderPhoto(){const photo=modalData.photo;$('ai-photo-preview').hidden=!photo;if(photo)$('ai-photo-preview').innerHTML=`<img src="${esc(photo.src)}" alt="已选检索图片"/><span>${esc(photo.name||'档案图片')}<small>仅展示图片，查找依据是下方文字线索。</small></span><button type="button" class="a-icon-button" data-modal-action="photo-remove" aria-label="移除检索图片">${icon('close')}</button>`;}
  function imagePreview(){const prompt=$('ai-image-prompt').value.trim();if(!prompt)throw new Error('先写下一句画面描述，再查看示例效果。');const p=presets.find(p=>p.id===modalData.preset);modalData.preview={prompt,preset:p.id};$('ai-image-preview').hidden=false;$('ai-image-preview').innerHTML=`<img src="${asset(p.asset)}" alt="${p.name}预设示例"/><p><strong>${p.name}</strong><span>示例画面 · 来自预设素材 · 非实时生成</span></p>`;$('ai-image-actions').hidden=false;$('ai-dialog-error').hidden=true;$('ai-image-actions').scrollIntoView({block:'nearest',behavior:reduced.matches?'auto':'smooth'});}
  function previewDraft(data){openModal('draft','把这些内容，带入一段新记忆','先核对内容。进入编辑器后仍可修改，只有点击保存才会正式存档。',`<label class="ai-field">记忆标题 · 可修改<input type="text" id="ai-draft-title" maxlength="80" value="${esc(data.title||'')}"/></label><label class="ai-field">准备带入的文字<textarea id="ai-draft-body" rows="6" maxlength="10000">${esc(data.body||'')}</textarea></label>${data.images?.length?`<div class="ai-draft-images">${data.images.map(i=>`<img src="${esc(i.src)}" alt="准备带入的配图"/>`).join('')}</div>`:''}<div class="ai-modal-actions"><button type="button" class="a-soft-button" data-modal-action="close">再想想</button><button type="button" class="a-soft-button ai-primary" data-modal-action="draft-go">进入编辑器 ${icon('arrow')}</button></div>`);modalData.draft=S.copy(data);}
  async function history(){await persist().catch(()=>{});if(DB.status==='ready')try{const rows=await DB.list();conversations=new Map(rows.map(c=>[c.id,c]));}catch(error){storageError=errorText(error);storageStatus();}if(conv.messages.length||conv.input)conversations.set(conv.id,S.copy(conv));openModal('history','那些还可以接着聊的故事','会话保存在当前浏览器。清除会话不会删除任何正式记忆。',`<div class="ai-history-list">${[...conversations.values()].sort((a,b)=>b.updatedAt-a.updatedAt).map(c=>`<article><button type="button" data-session="${c.id}"><strong>${esc(c.title)}</strong><span>${c.messages.filter(m=>m.role==='user').length} 条消息${c.input?' · 有未发送内容':''}${c.id===conv.id?' · 当前会话':''}</span></button><button type="button" class="a-icon-button" data-clear-session="${c.id}" aria-label="清除会话：${esc(c.title)}">${icon('trash')}</button></article>`).join('')||'<div class="ai-dialog-empty">还没有会话。从一句提问开始吧。</div>'}</div>`);}
  async function navigate(next){if(navigating)return;navigating=true;controls();try{stopReply();await persist();if(next==='new'){if(!conv.messages.length&&!conv.input){setView('home',true);return;}conv=fresh();}else{const saved=conversations.get(next);if(!saved)return;conv=S.copy(saved);conv.messages.forEach(m=>{if(m.status==='writing')m.status='stopped';});}version=savedVersion=0;storageError='';$('ai-input').value=conv.input;follow=true;setView(conv.view||'chat');renderRail();requestAnimationFrame(()=>$('ai-feed').scrollTop=conv.scroll||0);storageStatus();try{sessionStorage.setItem('memory-assistant-active',conv.id);}catch{}closeModal();}finally{navigating=false;controls();}}
  async function copyReply(id){const m=conv.messages.find(m=>m.id===id);if(!m)return;const v=replyView(m),text=v.text+(v.records.length?'\n\n'+v.records.map(r=>`${r.date}｜${r.title}\n${r.body}`).join('\n\n'):'');try{await navigator.clipboard.writeText(text);B.toast('回复已复制。');}catch{openModal('copy','复制这段回复','浏览器未允许直接复制。可以选中文字，使用 Ctrl+C。',`<textarea class="ai-copy-text" id="ai-copy-text" readonly rows="8">${esc(text)}</textarea>`);$('ai-copy-text').select();}}
  modal.addEventListener('click',safe(async event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.preset){modalData.preset=button.dataset.preset;modal.querySelectorAll('[data-preset]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));modalData.preview=null;$('ai-image-preview').hidden=true;$('ai-image-actions').hidden=true;return;}
    if(button.dataset.photoRecord){const r=S.find(button.dataset.photoRecord);if(!r||r.deletedAt)throw new Error('这条记忆已不在当前存档中。');modalData.photo=S.copy(S.cover(r));$('ai-photo-clue').value=r.title;renderPhoto();return;}
    if(button.dataset.session){await navigate(button.dataset.session);return;}
    if(button.dataset.clearSession){const id=button.dataset.clearSession,c=conversations.get(id);openModal('clear','清除这段对话？',`“${c?.title||'新的对话'}”的聊天内容和未发送输入会被清除，正式记忆不受影响。`,`<div class="ai-modal-actions"><button type="button" class="a-soft-button" data-modal-action="history">继续保留</button><button type="button" class="a-soft-button ai-danger" data-modal-action="clear-confirm">清除会话</button></div>`);modalData.clearId=id;return;}
    const action=button.dataset.modalAction;if(!action)return;
    if(action==='close')closeModal();
    else if(action==='history')await history();
    else if(action==='clear-confirm'){const id=modalData.clearId;stopReply();await persist().catch(()=>{});if(DB.status==='ready')await DB.remove(id);conversations.delete(id);if(conv.id===id){conv=fresh();version=savedVersion=0;$('ai-input').value='';setView('home');renderRail();storageStatus();}await history();B.toast('会话已清除，正式记忆仍然保留。');}
    else if(action==='voice-start'){clearTimeout(voiceTimer);const token=modalToken,text=$('ai-voice-topic').value;$('ai-wave').classList.add('is-playing');$('ai-voice-state').textContent='正在演示输入与转写 · 没有录音';button.disabled=true;voiceTimer=setTimeout(()=>{if(token!==modalToken)return;$('ai-transcript').value=text;$('ai-wave').classList.remove('is-playing');$('ai-voice-state').textContent='示例转写完成，修改后再发送也可以。';button.disabled=false;},reduced.matches?0:850);}
    else if(action==='voice-send'){const text=$('ai-transcript').value.trim();if(!text)throw new Error('先运行示例转写，或输入一段文字再发送。');if(send({text,mode:'voice'}))closeModal();}
    else if(action==='image-preview')imagePreview();
    else if(action==='image-chat'){const data=modalData.preview;if(!data)return;if(send({text:data.prompt,image:data}))closeModal();}
    else if(action==='image-draft'){const data=modalData.preview;if(!data)return;const p=presets.find(p=>p.id===data.preset);previewDraft({title:'',body:data.prompt,images:[{id:S.uid(),src:asset(p.asset),name:`${p.name} · 预设示例`}],date:conv.scope.date});}
    else if(action==='photo-pick')$('ai-photo-file').click();
    else if(action==='photo-remove'){modalData.photo=null;renderPhoto();}
    else if(action==='photo-send'){if(modalData.processing)return;const photo=modalData.photo,text=$('ai-photo-clue').value.trim();if(!photo)throw new Error('请先上传或选择一张图片。');if(!text)throw new Error('请补充文字线索；当前演示不会识别图片内容。');if(send({text,mode:'photo',attachment:photo}))closeModal();}
    else if(action==='draft-go'){const data={...modalData.draft,title:$('ai-draft-title').value,body:$('ai-draft-body').value};if(!data.body.trim()&&!data.images?.length)throw new Error('至少留下一点文字或一张图片。');button.disabled=true;const last=conv.messages.at(-1);if(JSON.stringify(last?.draftData)!==JSON.stringify(data)){if(!conv.messages.length)conv.title=(data.title||data.body||'准备一段图像记忆').slice(0,24);conv.messages.push({id:S.uid(),role:'user',mode:'draft',text:data.body||data.title||'准备一段图像记忆',attachment:S.copy(data.images?.[0]||null),draftData:S.copy(data),createdAt:Date.now()});setView('chat');renderMessages({bottom:true});changed();}await persist().catch(()=>{});closeModal();await window.RecordEditor.openNew({prefill:data,source:{tab:'ai',assistant:capture()}});}
  }));
  $('ai-dialog-close').addEventListener('click',closeModal);modal.addEventListener('cancel',event=>{event.preventDefault();closeModal();});modal.addEventListener('close',()=>{modalToken++;clearTimeout(voiceTimer);if(modalTrigger?.isConnected)modalTrigger.focus({preventScroll:true});else if(B.state.tab==='ai')$('ai-input').focus({preventScroll:true});});
  pane.addEventListener('click',safe(async event=>{
    const b=event.target.closest('button');if(!b)return;if(b.dataset.aiMode){openMode(b.dataset.aiMode);return;}if(b.dataset.aiStarter){send({text:b.dataset.aiStarter});return;}if(b.dataset.aiMemory){openCard(event);return;}
    if(b.dataset.copy)await copyReply(b.dataset.copy);
    if(b.dataset.more){const m=conv.messages.find(m=>m.id===b.dataset.more);m.limit=(m.limit||4)+4;renderMessages();changed();}
    if(b.dataset.continue){if(job)return;const m=conv.messages.find(m=>m.id===b.dataset.continue);follow=true;beginReply(m);changed();}
    if(b.dataset.queryAgain){const m=conv.messages.find(m=>m.id===b.dataset.queryAgain);send({text:m.query});}
    if(b.dataset.draftUser){const m=conv.messages.find(m=>m.id===b.dataset.draftUser);previewDraft(m.draftData||{body:m.text,images:m.attachment?[m.attachment]:[],date:conv.scope.date});}
    if(b.dataset.draftReply){const m=conv.messages.find(m=>m.id===b.dataset.draftReply),v=replyView(m);previewDraft({body:v.draft||m.query,images:v.preset?[{id:S.uid(),src:asset(v.preset.asset),name:`${v.preset.name} · 预设示例`}]:[],date:m.scope.date});}
  }));
  $('ai-input').addEventListener('input',()=>{conv.input=$('ai-input').value;controls();changed();});
  $('ai-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();send();}});
  $('ai-form').addEventListener('submit',event=>{event.preventDefault();send();});$('ai-stop').addEventListener('click',stopReply);
  $('ai-new').addEventListener('click',safe(()=>navigate('new')));$('ai-history').addEventListener('click',safe(history));
  $('ai-home-button').addEventListener('click',()=>{stopReply();setView('home');B.animatePane($('ai-home'));changed();});
  $('ai-new-reply').addEventListener('click',()=>{follow=true;$('ai-feed').scrollTo({top:$('ai-feed').scrollHeight,behavior:reduced.matches?'auto':'smooth'});$('ai-new-reply').hidden=true;});
  $('ai-feed').addEventListener('scroll',()=>{const el=$('ai-feed');conv.scroll=el.scrollTop;follow=el.scrollHeight-el.scrollTop-el.clientHeight<50;if(follow)$('ai-new-reply').hidden=true;if(!job&&loaded)changed();});
  $('ai-retry-save').addEventListener('click',safe(async()=>{if(DB.status!=='ready')throw new Error(DB.failure);await persist();await DB.list();storageError='';storageStatus();B.toast('本机会话存储已恢复。');}));
  function capture(){return{id:conv.id,view:conv.view,scroll:$('ai-feed').scrollTop};}
  function restore(source){if(source?.id&&source.id!==conv.id&&conversations.has(source.id)){conv=S.copy(conversations.get(source.id));version=savedVersion=0;$('ai-input').value=conv.input;}setView(source?.view||conv.view);renderRail();requestAnimationFrame(()=>{$('ai-feed').scrollTop=source?.scroll??conv.scroll;$('ai-input').focus({preventScroll:true});});}
  function onTab(tab){B.archive.classList.toggle('is-ai-mode',tab==='ai');if(tab!=='ai'){document.querySelector('.ai-mascot-travel')?.remove();stopReply();persist().catch(()=>{});return;}renderRail();setView(conv.view);requestAnimationFrame(()=>{$('ai-feed').scrollTop=conv.scroll||0;});}
  S.subscribe(()=>{if(B.state.tab==='ai'){renderMessages();renderRelated();}});
  window.addEventListener('beforeunload',event=>{if(loaded&&version>savedVersion&&(conv.input||conv.messages.length)){event.preventDefault();event.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stopReply();persist().catch(()=>{});}else if(B.state.tab==='ai'){renderMessages();renderRelated();}});
  window.MemoryAssistant={onTab,renderRail,capture,restore,flush:persist};
  Promise.all([S.ready,DB.ready]).then(async()=>{
    try{const rows=await DB.list();conversations=new Map(rows.map(c=>[c.id,c]));let selected;try{selected=sessionStorage.getItem('memory-assistant-active');}catch{}selected ||= await DB.selected();if(conversations.has(selected))conv=S.copy(conversations.get(selected));conv.messages.forEach(m=>{if(m.status==='writing')m.status='stopped';});}
    catch(error){storageError=errorText(error);}finally{loaded=true;$('ai-input').value=conv.input;setView(conv.view||'home');storageStatus();onTab(B.state.tab);controls();}
  });
})();

;
/* profile.js */
(() => {
  'use strict';
  const S=window.MemoryStore,P=window.ProfileStore,B=window.MemoryArchive.bridge,{byId:$,asset,icon,escapeHTML:esc}=B;
  const pane=$('pane-profile'),rail=$('archive-context-rail'),motion=window.ArchivePreferences.motion;
  const halls={time:['时光卷宗','沿着年月，重新翻开那些瞬间。'],growth:['成长档案室','成长的意义，由你自己来定义。'],mood:['情绪寄存馆','每一种心情，都有它的位置。'],private:['独家珍藏馆','给特别的瞬间，留一个位置。'],all:['全部记忆','每一段正式存档，都在这里。'],unfiled:['待分类记忆','还没有贴上心情标签的片段。']};
  const badgeRules=[{id:'archive',name:'日常收藏家',goal:10,key:'total',unit:'条正式记忆',hall:'all'},{id:'year',name:'时光记录官',goal:7,key:'days',unit:'个不同记录日',hall:'time'},{id:'private',name:'珍藏守护者',goal:3,key:'favorites',unit:'条珍藏记忆',hall:'private'}];
  const actionNames={created:'新存了一段记忆',edited:'补充了一段记忆',trash:'移入回收站',restore:'恢复了一段记忆',renew:'调整了保存时长','remove-tag':'调整了情绪分类','favorite-add':'珍藏了一个瞬间','favorite-remove':'取消了珍藏','growth-add':'留下一段成长','growth-remove':'取消了成长标记'};
  let state={section:'home',query:'',year:'all',month:'all',emotion:'all',scroll:0,homeScroll:0},loaded=false,modalMode='',modalToken=0,modalTrigger=null,modalData={},dirty=false,busy=false,processing=false,activityFailure='',previousBadges=null;
  let avatarRequest=0,activityTask=null;
  const markBusy=new Set(),pendingActivities=new Map();
  const extra=document.createElementNS('http://www.w3.org/2000/svg','svg');extra.classList.add('svg-defs');extra.setAttribute('aria-hidden','true');extra.innerHTML='<symbol id="a-pf-heart" viewBox="0 0 24 24"><path d="M20 4c-3-2-6 0-8 2C10 4 7 2 4 4c-5 4 0 10 8 16 8-6 13-12 8-16Z"/></symbol><symbol id="a-pf-growth" viewBox="0 0 24 24"><path d="M12 22V11M12 15C3 15 2 9 3 4c6 0 10 3 9 11Zm0-4C12 5 16 2 22 2c0 7-4 10-10 9Z"/></symbol>';document.body.appendChild(extra);
  pane.className='archive-pane pf-workspace';
  pane.innerHTML=`<div class="pf-home" id="pf-home"><div id="pf-home-content"></div></div><div class="pf-gallery" id="pf-gallery" hidden><header class="pf-gallery-heading"><button type="button" class="a-icon-button" data-pf-action="home" aria-label="返回个人中心">${icon('back')}</button><img id="pf-hall-art" alt=""/><div><p class="a-eyebrow">A PLACE FOR WHAT MATTERS</p><h1 id="pf-gallery-title" tabindex="-1"></h1><p id="pf-gallery-subtitle"></p></div><button type="button" class="a-soft-button" id="pf-add-to-hall" data-pf-action="pick">${icon('plus')} 选择记忆加入</button></header><div class="pf-gallery-tools"><label class="pf-search">${icon('search')}<input type="search" id="pf-search" aria-label="搜索馆内记忆" placeholder="找一段记忆" maxlength="120"/></label><div id="pf-date-filter"><label>年份<select id="pf-year"></select></label><label>月份<select id="pf-month"><option value="all">全年</option>${Array.from({length:12},(_,i)=>`<option value="${String(i+1).padStart(2,'0')}">${i+1} 月</option>`).join('')}</select></label></div><span id="pf-result-count" role="status"></span></div><div class="pf-emotions" id="pf-emotions" hidden></div><div class="pf-record-scroll" id="pf-record-scroll"><div id="pf-record-list"></div></div><p class="pf-gallery-note" id="pf-gallery-note"></p></div><div id="pf-status" class="pf-status" role="status"></div>`;
  const modal=document.createElement('dialog');modal.id='pf-dialog';modal.className='pf-dialog';modal.setAttribute('aria-labelledby','pf-dialog-title');
  modal.innerHTML=`<header><div><p class="a-eyebrow">YOUR LITTLE UNIVERSE</p><h2 id="pf-dialog-title"></h2></div><button type="button" id="pf-dialog-close" class="a-icon-button" aria-label="关闭个人中心窗口">${icon('close')}</button></header><p id="pf-dialog-description"></p><div id="pf-dialog-content"></div><p id="pf-dialog-error" role="alert" hidden></p><div class="pf-discard" id="pf-discard" hidden><strong>这次修改还没有保存。</strong><p>继续编辑，或放弃本次修改；已保存的资料不会改变。</p><div><button class="a-soft-button" type="button" data-pf-action="keep-editing">继续编辑</button><button class="a-soft-button" type="button" data-pf-action="discard">放弃本次修改</button></div></div>`;document.body.appendChild(modal);
  function errorMessage(e){return e?.name==='QuotaExceededError'?'本机空间不足，尚未保存。当前填写仍保留，请整理空间后重试。':e?.message||'这次操作没有完成，请重试。';}
  function showError(e){const text=errorMessage(e);if(modal.open){$('pf-dialog-error').textContent=text;$('pf-dialog-error').hidden=false;}else B.toast(text);}
  const safe=fn=>event=>Promise.resolve().then(()=>fn(event)).catch(showError);
  function stats(){const records=S.list();return{records,total:records.length,days:new Set(records.map(r=>r.date)).size,favorites:records.filter(r=>P.mark(r.id).favorite).length,growth:records.filter(r=>P.mark(r.id).growth).length,unfiled:records.filter(r=>!r.tags.length).length};}
  function timeLabel(at){return new Date(at).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
  function storageStatus(){const failed=P.status!=='ready'||S.status!=='ready';$('pf-status').innerHTML=`<span>${failed?esc(P.failure||S.failure||'正在打开本机档案…'):activityFailure?esc(activityFailure):'本机保存 · 不含草稿与回收站 · 统计包含演示记录'}</span>${pendingActivities.size?'<button type="button" data-pf-action="retry-activities">重试保存动态</button>':''}`;$('pf-status').classList.toggle('has-error',failed||Boolean(activityFailure));}
  function eventRows(events,limit=4){return events.slice(0,limit).map(e=>{const r=S.find(e.recordId),unavailable=!r||r.deletedAt;return`<button type="button" class="pf-activity" data-pf-event="${esc(e.id)}"><span class="pf-activity-dot"></span><span><strong>${esc(actionNames[e.kind]||'更新了记忆')}</strong><span>${esc(r?.title||e.title)}${unavailable?' · 已不在正式存档':''}</span></span><time>${timeLabel(e.at)}</time>${icon('arrow')}</button>`;}).join('');}
  function renderHome(){
    const p=P.profile(),v=stats(),home=$('pf-home'),scroll=home.scrollTop;
    $('pf-home-content').innerHTML=`<header class="pf-hero"><img src="${esc(p.avatar)}" alt="${esc(p.nickname)}的头像"/><div><p class="a-eyebrow">MY LITTLE UNIVERSE</p><h1 id="pf-title" tabindex="-1">${esc(p.nickname)}</h1><p>${esc(p.bio||'在这里，收藏属于你的生活。')}</p></div><button type="button" class="a-soft-button" data-pf-action="edit" ${!loaded?'disabled':''}>${icon('edit')} 编辑资料</button></header><div class="pf-stats">${[['time','记录天数',v.days],['all','记忆总数',v.total],['private','珍藏时刻',v.favorites],['unfiled','待分类',v.unfiled]].map(([hall,label,count])=>`<button type="button" data-pf-hall="${hall}" aria-label="${label} ${count}，查看"><span>${label}</span><strong>${S.status==='ready'?count:'—'}</strong></button>`).join('')}</div><div class="pf-collections">${['time','growth','mood','private'].map(hall=>`<button type="button" data-pf-hall="${hall}"><img src="${asset('collection-'+hall)}" alt=""/><span>${halls[hall][0]}</span><small>${hall==='time'?'按年月回看':hall==='growth'?`${v.growth} 段成长`:hall==='mood'?'让每种心情被看见':`${v.favorites} 段珍藏`}</small></button>`).join('')}</div><div class="pf-section-heading"><h2>成就徽章</h2><span>点开，看看走到了哪里</span></div><div class="pf-badges">${badgeRules.map(rule=>{const count=v[rule.key],earned=count>=rule.goal;return`<button type="button" data-pf-badge="${rule.id}" class="${earned?'is-earned':''}" aria-label="${rule.name}，${earned?'已达成':`${count}/${rule.goal}`}" ><img src="${asset('badge-'+rule.id)}" alt=""/><span><strong>${rule.name}</strong><small>${earned?'已达成':`${count} / ${rule.goal}`}</small></span></button>`;}).join('')}</div><div class="pf-section-heading pf-activity-heading"><h2>最近动态</h2><button type="button" data-pf-action="activities">查看全部 ${icon('arrow')}</button></div><div class="pf-activities">${P.events().length?eventRows(P.events()):`<div class="pf-activity-empty">下一次记录，会从这里开始留下足迹。<small>只展示功能启用后的真实操作，时间按本机时钟记录。</small></div>`}</div>`;
    home.scrollTop=scroll;
    const current=badgeRules.map(r=>v[r.key]>=r.goal);if(previousBadges&&!motion.matches)current.forEach((earned,i)=>{if(earned&&!previousBadges[i])pane.querySelector(`[data-pf-badge="${badgeRules[i].id}"]`)?.animate([{filter:'brightness(1)'},{filter:'brightness(1.3)'},{filter:'brightness(1)'}],{duration:650,easing:'ease-out'});});previousBadges=current;
  }
  function renderRail(){if(B.state.tab!=='profile')return;const p=P.profile(),pref=P.preferences();rail.innerHTML=`<div class="pf-rail"><header><p class="a-eyebrow">A PROFILE, ONLY YOURS</p><h2>个人信息</h2></header><section class="pf-rail-card"><div class="pf-section-heading"><h3>基础资料</h3><button type="button" data-pf-action="edit">编辑 ${icon('edit')}</button></div><dl><div><dt>本机编号</dt><dd class="pf-id">${P.status==='ready'?esc(p.archiveId):'尚未建立'}</dd></div><div><dt>性别</dt><dd>${({female:'女',male:'男',other:'其他'})[p.gender]||'未填写'}</dd></div><div><dt>城市</dt><dd>${esc(p.city||'未填写')}</dd></div><div><dt>生日</dt><dd>${p.birthday?esc(p.birthday.replace('-',' 月 ')+' 日'):'未填写'}</dd></div><div><dt>开馆纪念日</dt><dd>${esc(p.anniversary||'未填写')}</dd></div></dl></section><section class="pf-rail-card"><h3>此刻的保存状态</h3><p class="pf-local-state"><i></i>${P.status==='ready'&&S.status==='ready'?'保存在此浏览器':'存储暂不可用'}</p><p>未启用云同步。珍藏是整理标记，不是加密保险箱。</p><p>本机编号用于区分档案，不是登录账号。</p></section><section class="pf-rail-card pf-setting-card"><h3>档案设置</h3><button type="button" data-pf-action="preferences"><span>使用偏好<small>${pref.motion==='reduce'?'减少动态效果':'动效跟随系统'} · 默认${S.labels[pref.retention]}</small></span>${icon('arrow')}</button><button type="button" data-pf-action="export"><span>导出本机数据<small>查看导出范围后生成 JSON 文件</small></span>${icon('arrow')}</button></section><p class="pf-rail-note">发生日期属于记忆，操作时间属于此刻。<br/>把故事里的年月，与真实保存时间分开记录。</p></div>`;}
  function collectionRecords(){let records=S.list();if(state.section==='growth'||state.section==='private'){const key=state.section==='growth'?'growth':'favorite';records=records.filter(r=>P.mark(r.id)[key]);}if(state.section==='unfiled')records=records.filter(r=>!r.tags.length);if(state.section==='time'){if(state.year!=='all')records=records.filter(r=>r.date.startsWith(state.year+'-'));if(state.month!=='all')records=records.filter(r=>r.date.slice(5,7)===state.month);}if(state.section==='mood'&&state.emotion!=='all')records=records.filter(r=>state.emotion==='unfiled'?!r.tags.length:r.tags.includes(state.emotion));const q=state.query.trim().toLocaleLowerCase();if(q)records=records.filter(r=>`${r.title} ${r.body} ${r.location}`.toLocaleLowerCase().includes(q));return records;}
  function recordRow(r){const cover=S.cover(r),m=P.mark(r.id),kind=state.section==='growth'?'growth':'favorite',label=kind==='growth'?'成长':'珍藏';return`<article class="pf-record"><button type="button" class="pf-record-main" data-pf-memory="${esc(r.id)}">${cover?`<img src="${esc(cover.src)}" alt=""/>`:`<span class="pf-no-cover">${icon('text')}</span>`}<span><small>${esc(r.date)} · ${esc(r.time)}${r.location?' · '+esc(r.location):''}</small><strong>${esc(r.title)}</strong><span>${esc(r.body||'一段有画面的记忆')}</span><em class="${S.expired(r)?'is-expired':''}" data-remaining="${esc(r.id)}">${esc(S.remaining(r))}</em></span>${icon('arrow')}</button><div class="pf-record-meta"><span>${r.tags.length?r.tags.map(t=>B.categories.find(c=>c.id===t)?.name).filter(Boolean).join(' / '):'尚未分类'}${m.growth?' · 成长片段':''}</span><button type="button" data-pf-mark="${kind}" data-record="${esc(r.id)}" aria-pressed="${Boolean(m[kind])}" ${markBusy.has(r.id)?'disabled':''}>${icon(kind==='growth'?'pf-growth':'pf-heart')}${m[kind]?'已'+label:'加入'+label}</button></div></article>`;}
  function renderList(){const list=$('pf-record-list'),records=collectionRecords();$('pf-result-count').textContent=`${records.length} 段记忆`;list.innerHTML=records.map(recordRow).join('')||`<div class="pf-empty">${icon(state.section==='private'?'pf-heart':state.section==='growth'?'pf-growth':'search')}<h2>${state.query?'没有找到这个片段':state.section==='private'?'把特别的瞬间，留在这里':state.section==='growth'?'成长，可以从一件小事开始':'这个范围还没有记忆'}</h2><p>${state.query?'换个关键词，或清除搜索再看看。':['growth','private'].includes(state.section)?'从已有存档选择加入，不会复制内容或改变期限。':'可以换个范围，或记录一个新的瞬间。'}</p><button type="button" class="a-soft-button" data-pf-action="${state.query?'clear-search':['growth','private'].includes(state.section)?'pick':'new-record'}">${state.query?'清除搜索':['growth','private'].includes(state.section)?'选择记忆加入':'记录一个瞬间'} ${icon('plus')}</button></div>`;}
  function renderGallery(){if(state.section==='home')return;const [title,subtitle]=halls[state.section];$('pf-gallery-title').textContent=title;$('pf-gallery-subtitle').textContent=subtitle;$('pf-hall-art').src=asset('collection-'+(['all','unfiled'].includes(state.section)?'time':state.section));$('pf-add-to-hall').hidden=!['growth','private'].includes(state.section);$('pf-date-filter').hidden=state.section!=='time';$('pf-emotions').hidden=state.section!=='mood';const years=[...new Set(S.list().map(r=>r.date.slice(0,4)))].sort().reverse();if(state.year!=='all'&&!years.includes(state.year))years.push(state.year);$('pf-year').innerHTML='<option value="all">全部年份</option>'+years.map(y=>`<option>${y}</option>`).join('');$('pf-year').value=state.year;$('pf-month').value=state.month;$('pf-search').value=state.query;const all=S.list();$('pf-emotions').innerHTML=[{id:'all',name:'全部心情'},...B.categories,{id:'unfiled',name:'待分类'}].map(c=>`<button type="button" data-pf-emotion="${c.id}" aria-pressed="${state.emotion===c.id}">${c.name}<span>${c.id==='all'?all.length:all.filter(r=>c.id==='unfiled'?!r.tags.length:r.tags.includes(c.id)).length}</span></button>`).join('');$('pf-gallery-note').textContent=state.section==='private'?'珍藏不改变保存时长；到期记录仍需按原期限处理。':state.section==='growth'?'成长标记由你决定；移出这里不会删除原记忆。':state.section==='mood'?'一段记忆可以有多种心情；全部记忆按唯一记录计数。':'按记忆的发生日期回看；不包含草稿和回收站。';renderList();}
  function render(){const active=document.activeElement;let focusSelector='';if(active?.dataset?.pfMark)focusSelector=`[data-pf-mark="${active.dataset.pfMark}"][data-record="${CSS.escape(active.dataset.record)}"]`;else if(active?.dataset?.pfEmotion)focusSelector=`[data-pf-emotion="${active.dataset.pfEmotion}"]`;const focusRoot=modal.contains(active)?modal:B.detail.contains(active)?B.detail:pane;renderHome();renderGallery();renderRail();storageStatus();$('pf-home').hidden=state.section!=='home';$('pf-gallery').hidden=state.section==='home';if(B.detail.open){const r=S.find(B.currentMemory());if(r)decorateDetail(r);}if(modal.open&&modalMode==='picker')renderPicker();if(focusSelector&&!active.isConnected)focusRoot.querySelector(focusSelector)?.focus({preventScroll:true});}
  function openCollection(section,{focus=true}={}){if(section!=='home'&&!halls[section])section='home';const changed=state.section!==section;if(changed){state={...state,section,query:'',year:'all',month:'all',emotion:'all',scroll:0};}render();$('pf-record-scroll').scrollTop=state.scroll;B.writeRoute();if(changed)B.animatePane($(section==='home'?'pf-home':'pf-gallery'));if(focus)$(section==='home'?'pf-title':'pf-gallery-title')?.focus({preventScroll:true});}
  function openRecord(id,trigger){const r=S.find(id);if(!r||r.deletedAt){openModal('missing','这段记忆暂时不在这里',r?.deletedAt?'它在回收站中，恢复后会重新出现在原来的馆里。':'这段记录已经不可用，列表会按当前存档更新。',r?.deletedAt?'<button type="button" class="a-soft-button pf-primary" data-pf-action="trash">查看回收站</button>':'');return;}B.openMemory(id,trigger);}
  async function toggleMark(id,kind,value){
    if(markBusy.has(id))return;
    const trigger=document.activeElement,root=modal.contains(trigger)?modal:B.detail.contains(trigger)?B.detail:pane;
    const row=trigger?.closest('.pf-record'),neighbor=row?.nextElementSibling||row?.previousElementSibling;
    const nextId=neighbor?.querySelector('[data-record]')?.dataset.record;
    const restoreFocus=trigger?.dataset?.pfMark===kind&&trigger?.dataset?.record===id;
    markBusy.add(id);renderList();
    try{await P.setMark(id,kind,value);B.toast(value?(kind==='growth'?'已加入成长档案；原来的保存时长不变。':'已加入珍藏；原来的保存时长不变。'):'已移除标记，原记忆仍然保留。');}
    finally{markBusy.delete(id);render();if(restoreFocus&&(document.activeElement===document.body||document.activeElement===trigger)&&(!(root instanceof HTMLDialogElement)||root.open)){
      const same=root.querySelector(`[data-pf-mark="${kind}"][data-record="${CSS.escape(id)}"]`),next=nextId?root.querySelector(`[data-pf-mark="${kind}"][data-record="${CSS.escape(nextId)}"]`):null;
      (same||next||(root===modal?$('pf-dialog-close'):root===B.detail?$('memory-detail-title'):$('pf-gallery-title')))?.focus({preventScroll:true});
    }}
  }
  function decorateDetail(record){B.detail.querySelector('.pf-detail-marks')?.remove();if(record.deletedAt)return;const marks=P.mark(record.id),box=document.createElement('div');box.className='pf-detail-marks';box.innerHTML=`<div>${[['favorite','珍藏','pf-heart'],['growth','成长','pf-growth']].map(([kind,label,i])=>`<button type="button" data-pf-mark="${kind}" data-record="${esc(record.id)}" aria-pressed="${Boolean(marks[kind])}" ${markBusy.has(record.id)||!loaded?'disabled':''}>${icon(i)}${marks[kind]?'已加入'+label:'加入'+label}</button>`).join('')}</div><small>整理标记不改变原来的保存时长</small>`;B.detail.querySelector('.detail-actions')?.after(box);box.addEventListener('click',safe(async event=>{const b=event.target.closest('[data-pf-mark]');if(!b)return;await toggleMark(record.id,b.dataset.pfMark,!P.mark(record.id)[b.dataset.pfMark]);B.detail.querySelector(`[data-pf-mark="${b.dataset.pfMark}"]`)?.focus({preventScroll:true});}));}
  function openModal(mode,title,description,html){modalToken++;modalMode=mode;modalData={};dirty=false;busy=false;processing=false;modalTrigger=modal.open?modalTrigger:document.activeElement;$('pf-dialog-title').textContent=title;$('pf-dialog-description').textContent=description;$('pf-dialog-content').innerHTML=html;$('pf-dialog-error').hidden=true;$('pf-discard').hidden=true;$('pf-dialog-content').inert=false;if(!modal.open)modal.showModal();requestAnimationFrame(()=>{(modal.querySelector('input:not([type=file]):not([type=checkbox]),textarea,select')||$('pf-dialog-close')).focus({preventScroll:true});});}
  function closeModal(force=false){if(busy){showError(new Error('正在保存或整理数据，请稍候。'));return;}if(!force&&dirty){$('pf-discard').hidden=false;$('pf-dialog-content').inert=true;modal.querySelector('[data-pf-action=keep-editing]').focus();return;}modalToken++;processing=false;modal.close();}
  function formActions(save='保存资料',action='save-profile'){return`<div class="pf-modal-actions"><button type="button" class="a-soft-button" data-pf-action="close">取消</button><button type="button" class="a-soft-button pf-primary" data-pf-action="${action}">${icon('check')} ${save}</button></div>`;}
  function editProfile(){if(!loaded)return;avatarRequest++;const p=P.profile();openModal('profile','把这里，写成你的样子','资料仅保存在此浏览器。可选项目可以留空，生日只记录月和日。',`<form id="pf-profile-form"><div class="pf-avatar-editor"><div class="pf-avatar-circle"><img id="pf-avatar-default" src="${esc(p.avatar)}" alt="头像预览"/><canvas id="pf-avatar-canvas" width="512" height="512" aria-label="裁切后的头像预览" hidden></canvas></div><div><button type="button" class="a-soft-button" data-pf-action="avatar-pick">${icon('image')} 选择头像</button><button type="button" class="pf-text-button" data-pf-action="avatar-default">恢复默认头像</button><small>JPEG / PNG / WebP · 不超过 10 MB<br/>只处理本机副本，不修改原图</small><input type="file" id="pf-avatar-file" accept="image/jpeg,image/png,image/webp" hidden/></div></div><div class="pf-crop-controls" id="pf-crop-controls" hidden>${[['zoom','缩放',1,3,.05],['x','左右位置',0,100,1],['y','上下位置',0,100,1]].map(([id,label,min,max,step])=>`<label>${label}<input type="range" id="pf-crop-${id}" min="${min}" max="${max}" step="${step}" value="${p.crop?.[id]??(id==='zoom'?1:50)}"/></label>`).join('')}</div><div class="pf-form-grid"><label class="pf-field">昵称<input id="pf-nickname" maxlength="24" required value="${esc(p.nickname)}"/></label><label class="pf-field">城市 · 可选<input id="pf-city" maxlength="40" value="${esc(p.city)}" placeholder="未填写"/></label><label class="pf-field pf-full">一句简介<textarea id="pf-bio" maxlength="140" rows="2">${esc(p.bio)}</textarea></label><label class="pf-field">性别 · 可选<select id="pf-gender"><option value="">不填写</option><option value="female">女</option><option value="male">男</option><option value="other">其他</option></select></label><div class="pf-field">生日 · 可选<div class="pf-birthday"><label><span class="sr-only">生日月份</span><input type="number" id="pf-birth-month" min="1" max="12" placeholder="月" value="${p.birthday?Number(p.birthday.slice(0,2)):''}"/></label><span>月</span><label><span class="sr-only">生日日期</span><input type="number" id="pf-birth-day" min="1" max="31" placeholder="日" value="${p.birthday?Number(p.birthday.slice(3,5)):''}"/></label><span>日</span></div></div><label class="pf-field pf-full">开馆纪念日 · 可选<input type="date" id="pf-anniversary" min="0001-01-01" max="9999-12-31" value="${esc(p.anniversary)}"/></label></div>${formActions()}</form>`);modalData.profile=p;modalData.crop=p.crop||{zoom:1,x:50,y:50};modalData.source=p.avatarSource||'';$('pf-gender').value=p.gender;if(modalData.source){const token=modalToken,request=avatarRequest;processing=true;loadAvatar(modalData.source,token,request).catch(showError).finally(()=>{if(token===modalToken&&request===avatarRequest)processing=false;});}$('pf-profile-form').addEventListener('submit',safe(async e=>{e.preventDefault();await saveProfile();}));$('pf-avatar-file').addEventListener('change',safe(async e=>{const file=e.target.files[0];if(!file)return;const token=modalToken,request=++avatarRequest;processing=true;dirty=true;try{const image=await window.RecordEditor.prepareImage(file);if(token!==modalToken||request!==avatarRequest)return;await loadAvatar(image.src,token,request);if(token!==modalToken||request!==avatarRequest)return;modalData.source=image.src;modalData.crop={zoom:1,x:50,y:50};for(const k of ['zoom','x','y'])$('pf-crop-'+k).value=modalData.crop[k];drawAvatar();$('pf-dialog-error').hidden=true;}catch(error){if(token===modalToken&&request===avatarRequest)throw error;}finally{if(token===modalToken&&request===avatarRequest){processing=false;e.target.value='';}}}));for(const k of ['zoom','x','y'])$('pf-crop-'+k).addEventListener('input',()=>{modalData.crop[k]=Number($('pf-crop-'+k).value);drawAvatar();});}
  async function loadAvatar(src,token,request){const image=new Image();image.src=src;try{await image.decode();}catch{throw new Error('头像图片无法读取，请换一张 JPEG、PNG 或 WebP 图片。');}if(token!==modalToken||request!==avatarRequest)return;modalData.image=image;$('pf-avatar-default').hidden=true;$('pf-avatar-canvas').hidden=false;$('pf-crop-controls').hidden=false;drawAvatar();}
  function drawAvatar(){const img=modalData.image;if(!img)return;const c=$('pf-avatar-canvas'),ctx=c.getContext('2d'),crop=modalData.crop,scale=Math.max(512/img.naturalWidth,512/img.naturalHeight)*crop.zoom,w=img.naturalWidth*scale,h=img.naturalHeight*scale;ctx.clearRect(0,0,512,512);ctx.drawImage(img,(512-w)*crop.x/100,(512-h)*crop.y/100,w,h);}
  async function saveProfile(){if(busy)return;if(processing)throw new Error('头像正在处理，请稍候再保存。');const m=$('pf-birth-month').value,d=$('pf-birth-day').value;if(Boolean(m)!==Boolean(d))throw new Error('生日的月和日请一起填写，或一起留空。');if(m&&(!Number.isInteger(Number(m))||!Number.isInteger(Number(d))))throw new Error('生日请填写整数月份和日期。');const data={...modalData.profile,nickname:$('pf-nickname').value,bio:$('pf-bio').value,city:$('pf-city').value,gender:$('pf-gender').value,birthday:m?String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0'):'',anniversary:$('pf-anniversary').value,avatar:modalData.source?$('pf-avatar-canvas').toDataURL('image/webp',.88):modalData.profile.avatar,avatarSource:modalData.source,crop:modalData.crop};busy=true;const button=modal.querySelector('[data-pf-action=save-profile]');button.disabled=true;button.textContent='正在保存…';try{await P.saveProfile(data,modalData.profile.revision);dirty=false;busy=false;closeModal(true);B.toast('个人资料已保存在此浏览器。');}finally{busy=false;if(button.isConnected){button.disabled=false;button.textContent='保存资料';}}}
  function preferences(){const prefs=P.preferences();openModal('preferences','让档案馆，合你的习惯','偏好会保存在此浏览器。默认保存时长只影响之后新建的记忆，已有记忆保持原期限。',`<label class="pf-field">动态效果<select id="pf-motion"><option value="system">跟随系统</option><option value="reduce">减少动态效果</option></select><small>减少动态效果时取消位移与波形动画，回复直接呈现。</small></label><label class="pf-field">新增记忆的默认保存时长<select id="pf-retention">${Object.entries(S.labels).map(([v,label])=>`<option value="${v}">${label}${v==='instant'?' · 30 秒':v==='short'?' · 7 天':v==='long'?' · 1 年':' · 永久'}</option>`).join('')}</select></label><p class="pf-settings-note">选择「瞬时」后，新记录会在保存 30 秒后到期并进入待处理，内容不会自动删除。</p>${formActions('保存偏好','save-preferences')}<div class="pf-reset-area"><button type="button" class="pf-text-button" data-pf-action="reset-prompt">重置界面偏好</button><span>恢复跟随系统与默认永恒，不删除任何个人数据。</span><div id="pf-reset-confirm" hidden><p>确定恢复默认偏好吗？当前未保存的偏好修改会放弃。</p><button type="button" class="a-soft-button" data-pf-action="reset-cancel">继续保留</button><button type="button" class="a-soft-button" data-pf-action="reset-confirm">确认重置</button></div></div>`);modalData.preferences=prefs;$('pf-motion').value=prefs.motion;$('pf-retention').value=prefs.retention;}
  async function savePreferences(reset=false){if(busy)return;const data=reset?{motion:'system',retention:'forever'}:{motion:$('pf-motion').value,retention:$('pf-retention').value};busy=true;try{await P.savePreferences(data,modalData.preferences.revision);dirty=false;busy=false;closeModal(true);B.toast(reset?'界面偏好已重置，个人资料与记忆仍保留。':'偏好已保存。');}finally{busy=false;}}
  function picker(){const kind=state.section==='growth'?'growth':'favorite';openModal('picker',kind==='growth'?'选择你的成长片段':'把特别的瞬间加入珍藏','可以选择多条。再次点击即可取消标记；不会复制记忆或改变保存期限。',`<label class="pf-search">${icon('search')}<input type="search" id="pf-pick-search" aria-label="搜索可加入的记忆" placeholder="按标题或内容查找" maxlength="120"/></label><div class="pf-pick-list" id="pf-pick-list"></div><div class="pf-modal-actions"><button type="button" class="a-soft-button pf-primary" data-pf-action="close">完成</button></div>`);modalData.kind=kind;$('pf-pick-search').addEventListener('input',renderPicker);renderPicker();}
  function renderPicker(){if(!$('pf-pick-list'))return;const q=$('pf-pick-search').value.trim().toLowerCase(),kind=modalData.kind;const records=S.list().filter(r=>`${r.title} ${r.body}`.toLowerCase().includes(q));$('pf-pick-list').innerHTML=records.map(r=>{const on=P.mark(r.id)[kind];return`<button type="button" data-pf-mark="${kind}" data-record="${esc(r.id)}" aria-pressed="${Boolean(on)}" ${markBusy.has(r.id)?'disabled':''}><span><strong>${esc(r.title)}</strong><small>${esc(r.date)} · ${esc(S.remaining(r))}</small></span><span>${on?'已加入 ✓':'加入 ＋'}</span></button>`;}).join('')||'<p class="pf-muted">没有找到可加入的记忆。可以换个词，或先新增记录。</p><button type="button" class="a-soft-button" data-pf-action="new-record">新增一段记忆 ＋</button>';}
  function badge(id){const rule=badgeRules.find(r=>r.id===id);if(!rule)return;const count=stats()[rule.key],earned=count>=rule.goal;openModal('badge',rule.name,`条件：${rule.goal} ${rule.unit}。按当前正式档案计算，包含演示记录；删除或取消标记后会重新计算。`,`<div class="pf-badge-detail ${earned?'is-earned':''}"><img src="${asset('badge-'+rule.id)}" alt="${rule.name}"/><p>${earned?'这枚徽章，已经被你点亮。':'每一点积累，都算数。'}</p><strong>${count} / ${rule.goal}</strong><progress value="${Math.min(count,rule.goal)}" max="${rule.goal}" aria-label="${rule.name}进度"></progress></div><div class="pf-modal-actions"><button type="button" class="a-soft-button pf-primary" data-pf-hall="${rule.hall}">查看相关记忆 ${icon('arrow')}</button></div>`);}
  async function dispatch(event){const b=event.target.closest('button');if(!b||b.disabled||busy)return;if(b.dataset.pfHall){closeModal(true);openCollection(b.dataset.pfHall);return;}if(b.dataset.pfMemory){openRecord(b.dataset.pfMemory,b);return;}if(b.dataset.pfMark){await toggleMark(b.dataset.record,b.dataset.pfMark,!P.mark(b.dataset.record)[b.dataset.pfMark]);return;}if(b.dataset.pfEmotion){state.emotion=b.dataset.pfEmotion;state.scroll=0;renderGallery();$('pf-record-scroll').scrollTop=0;pane.querySelector(`[data-pf-emotion="${state.emotion}"]`)?.focus({preventScroll:true});return;}if(b.dataset.pfBadge){badge(b.dataset.pfBadge);return;}if(b.dataset.pfEvent){const e=P.events().find(e=>e.id===b.dataset.pfEvent);if(e){if(modal.open)closeModal(true);openRecord(e.recordId,b);}return;}const action=b.dataset.pfAction;if(!action)return;
    if(action==='home')openCollection('home');else if(action==='edit')editProfile();else if(action==='preferences')preferences();else if(action==='save-profile')await saveProfile();else if(action==='save-preferences')await savePreferences();else if(action==='close')closeModal();else if(action==='keep-editing'){$('pf-discard').hidden=true;$('pf-dialog-content').inert=false;(modal.querySelector('input:not([type=file]),textarea,select')||$('pf-dialog-close')).focus();}else if(action==='discard'){dirty=false;closeModal(true);}else if(action==='avatar-pick')$('pf-avatar-file').click();else if(action==='avatar-default'){avatarRequest++;processing=false;modalData.source='';modalData.profile.avatar=asset('avatar');modalData.crop={zoom:1,x:50,y:50};$('pf-avatar-default').src=asset('avatar');$('pf-avatar-default').hidden=false;$('pf-avatar-canvas').hidden=true;$('pf-crop-controls').hidden=true;dirty=true;}else if(action==='pick')picker();else if(action==='clear-search'){state.query='';$('pf-search').value='';renderList();$('pf-search').focus();}else if(action==='new-record'){if(modal.open)closeModal(true);await window.RecordEditor.openNew({source:{tab:'profile',profile:capture()}});}else if(action==='activities')openModal('activities','最近留下的足迹','以下是功能启用后的真实本机操作时间，与记忆发生日期分开显示。',`<div class="pf-all-activities">${eventRows(P.events(),P.events().length)||'<p class="pf-muted">这里还没有新的操作记录。下一次记录会留下真实的足迹。</p>'}</div>`);else if(action==='trash'){closeModal(true);window.RecordEditor.showOverview('trash');}else if(action==='reset-prompt'){$('pf-reset-confirm').hidden=false;}else if(action==='reset-cancel'){$('pf-reset-confirm').hidden=true;}else if(action==='reset-confirm')await savePreferences(true);else if(action==='export')await window.ProfileExport.open();else if(action==='retry-activities')await retryActivities();
  }
  pane.addEventListener('click',safe(dispatch));rail.addEventListener('click',safe(event=>{if(B.state.tab==='profile')return dispatch(event);}));modal.addEventListener('click',safe(dispatch));modal.addEventListener('input',()=>{if(['profile','preferences'].includes(modalMode))dirty=true;});modal.addEventListener('change',()=>{if(['profile','preferences'].includes(modalMode))dirty=true;});$('pf-dialog-close').addEventListener('click',()=>closeModal());modal.addEventListener('cancel',event=>{event.preventDefault();closeModal();});modal.addEventListener('close',()=>{modalToken++;dirty=false;if(modalTrigger?.isConnected)modalTrigger.focus({preventScroll:true});else $(state.section==='home'?'pf-title':'pf-gallery-title')?.focus({preventScroll:true});});modal.addEventListener('keydown',safe(async event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&['profile','preferences'].includes(modalMode)){event.preventDefault();if(modalMode==='profile')await saveProfile();else await savePreferences();}}));
  $('pf-search').addEventListener('input',()=>{state.query=$('pf-search').value;state.scroll=0;renderList();$('pf-record-scroll').scrollTop=0;});for(const [id,key]of [['pf-year','year'],['pf-month','month']])$(id).addEventListener('change',()=>{state[key]=$(id).value;state.scroll=0;renderList();$('pf-record-scroll').scrollTop=0;});$('pf-record-scroll').addEventListener('scroll',()=>{if(state.section!=='home'&&B.state.tab==='profile')state.scroll=$('pf-record-scroll').scrollTop;});$('pf-home').addEventListener('scroll',()=>{if(state.section==='home'&&B.state.tab==='profile')state.homeScroll=$('pf-home').scrollTop;});
  function capture(){return S.copy({...state,scroll:state.section==='home'?state.scroll:$('pf-record-scroll').scrollTop,homeScroll:state.section==='home'?$('pf-home').scrollTop:state.homeScroll});}
  function restore(source){if(source)state={...state,...source};render();B.writeRoute();requestAnimationFrame(()=>{$('pf-record-scroll').scrollTop=state.scroll||0;$('pf-home').scrollTop=state.homeScroll||0;$(state.section==='home'?'pf-title':'pf-gallery-title')?.focus({preventScroll:true});});}
  function onTab(tab){B.archive.classList.toggle('is-profile-mode',tab==='profile');if(tab==='profile'){render();requestAnimationFrame(()=>{$('pf-record-scroll').scrollTop=state.scroll;$('pf-home').scrollTop=state.homeScroll;});}}
  function retryActivities(){if(activityTask)return activityTask;activityTask=(async()=>{for(const [id,detail]of pendingActivities){await P.recordActivity(detail);pendingActivities.delete(id);}activityFailure='';storageStatus();})().finally(()=>{activityTask=null;});return activityTask;}
  window.addEventListener('memory:committed',event=>{const detail=event.detail,id=detail.record.id+':'+detail.record.revision;pendingActivities.set(id,detail);retryActivities().catch(()=>{activityFailure='记忆已保存，但最近动态尚未保留；可重试。';storageStatus();});});
  window.addEventListener('beforeunload',event=>{if(dirty||busy||processing){event.preventDefault();event.returnValue='';}});
  P.subscribe(()=>{if(loaded)render();});S.subscribe(()=>{if(loaded)render();});
  window.MemoryProfile={onTab,renderRail,decorateDetail,capture,restore,openCollection,route:()=>`#archive/profile${state.section==='home'?'':'/'+state.section}`,modal:{open:openModal,close:closeModal,error:showError,get token(){return modalToken;},setBusy(value){busy=value;},element:modal},flushActivities:retryActivities};
  Promise.all([S.ready,P.ready]).then(()=>{loaded=true;render();onTab(B.state.tab);});
})();

;
/* profile-export.js */
(() => {
  'use strict';
  const S=window.MemoryStore,P=window.ProfileStore,A=window.AssistantStore,M=window.MemoryProfile.modal;
  const $=id=>document.getElementById(id);
  const presets={rain:'assets/memory-rain.webp',coffee:'assets/memory-coffee.webp',sunset:'assets/memory-sunset.webp'};
  let opening=false,working=false,snapshot=null;
  function imageSources(value,result=new Set()){
    if(!value||typeof value!=='object')return result;
    for(const [key,v]of Object.entries(value)){
      if(['src','avatar','avatarSource'].includes(key)&&typeof v==='string'&&v)result.add(v);
      else if(v&&typeof v==='object')imageSources(v,result);
    }
    return result;
  }
  function selection(){return{drafts:$('pf-export-drafts').checked,trash:$('pf-export-trash').checked,conversations:$('pf-export-chats').checked};}
  function selectedData(options){
    const records=snapshot.records.filter(r=>!r.deletedAt),trash=options.trash?snapshot.records.filter(r=>r.deletedAt):[],ids=new Set([...records,...trash].map(r=>r.id));
    const conversations=options.conversations?S.copy(snapshot.conversations):[];
    for(const c of conversations)for(const m of c.messages||[])if(m.kind==='image')m.image={src:presets[m.preset]||presets.rain,origin:'preset-example'};
    const data={profile:snapshot.personal.profile,preferences:snapshot.personal.preferences,records,marks:snapshot.personal.marks.filter(m=>ids.has(m.id)),activities:snapshot.personal.events.filter(e=>ids.has(e.recordId))};
    if(options.drafts)data.drafts=snapshot.drafts;
    if(options.trash)data.trash=trash;
    if(options.conversations)data.conversations=conversations;
    return data;
  }
  function updateCount(){const images=imageSources(selectedData(selection())).size;$('pf-export-image-count').textContent=`包含 ${images} 份不同的图片来源（含头像与裁切原图），导出时内嵌副本。`;}
  async function open(){
    if(opening||working)return;opening=true;
    M.open('export','带走，属于你的记忆','JSON 文件包含可读的记录与图片副本，文件未加密。当前版本提供导出，尚不提供导入恢复。','<p class="pf-muted" role="status">正在读取本机档案…</p>');
    const token=M.token;
    try{
      let activityWarning='';
      try{await window.MemoryProfile.flushActivities();}catch{activityWarning='部分最近动态尚未保存，本次只导出已保存的动态。';}
      const [records,personal]=await Promise.all([S.snapshot(),P.snapshot()]);
      let conversations=[],chatError='';
      try{await window.MemoryAssistant?.flush();await A.ready;conversations=await A.list();}catch(e){chatError=e.message||'会话暂时无法读取';}
      if(token!==M.token)return;
      snapshot={...records,personal,conversations,warnings:activityWarning?[activityWarning]:[],at:new Date().toISOString()};
      const formal=records.records.filter(r=>!r.deletedAt).length,trash=records.records.filter(r=>r.deletedAt).length;
      $('pf-dialog-content').innerHTML=`<div class="pf-export-scope"><p>默认导出 <strong>${formal}</strong> 条正式记忆</p><small class="pf-muted">包括资料、偏好、成长／珍藏标记和对应的真实动态。</small><p class="pf-muted" id="pf-export-image-count"></p></div><div class="pf-export-options"><label><input type="checkbox" id="pf-export-drafts"/><span>同时导出草稿 · ${records.drafts.length} 份<small>包含未正式保存的文字、图片和编辑来源。</small></span></label><label><input type="checkbox" id="pf-export-trash"/><span>同时导出回收站 · ${trash} 条<small>保留已删除状态和原来的整理标记。</small></span></label><label><input type="checkbox" id="pf-export-chats" ${chatError?'disabled':''}/><span>同时导出小忆会话 · ${conversations.length} 个<small>${chatError?'会话暂不可读取；其他数据仍可导出。':'包含消息、查询范围和所用的预设示例图片。'}</small></span></label></div><p class="pf-settings-note">使用打开此窗口时的存档快照；之后的修改可重新打开再导出。图片可能让文件较大，请妥善保管包含个人内容的文件。</p><p class="pf-export-status" id="pf-export-status" role="status"></p><div class="pf-modal-actions"><button type="button" class="a-soft-button" data-pf-action="close">关闭</button><button type="button" class="a-soft-button pf-primary" id="pf-export-download">生成并下载 JSON</button></div>`;
      for(const id of ['pf-export-drafts','pf-export-trash','pf-export-chats'])$(id).addEventListener('change',updateCount);
      $('pf-export-download').addEventListener('click',()=>download().catch(M.error));
      if(activityWarning)$('pf-export-status').textContent=activityWarning;
      updateCount();
    }catch(e){if(token===M.token){$('pf-dialog-content').innerHTML='<p class="pf-muted">这次尚未生成文件。请关闭后重新尝试，已有数据不受影响。</p>';M.error(e);}}
    finally{opening=false;}
  }
  async function embed(src){
    if(/^data:image\/(webp|png|jpeg);base64,/.test(src))return src;
    if(!/^assets\/[a-zA-Z0-9_-]+\.webp$/.test(src))throw new Error('发现无法导出的图片来源，请核对图片后重试。');
    if(!/^https?:$/.test(location.protocol))throw new Error('请通过本地预览地址打开网站后导出，才能读取内置图片副本。');
    let response;
    try{response=await fetch(new URL(src,document.baseURI),{signal:AbortSignal.timeout(20000)});}
    catch{throw new Error('图片副本暂时无法读取，尚未生成文件。请确认本地预览服务仍在运行，然后重试。');}
    if(!response.ok)throw new Error('有一张图片没有读取成功，尚未生成文件。请保持本地预览服务开启后重试。');
    const blob=await response.blob();
    if(!blob.type.startsWith('image/'))throw new Error('图片响应格式不正确，尚未生成文件。');
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片副本读取失败，请重试。'));reader.readAsDataURL(blob);});
  }
  function replaceImages(value,refs){
    if(!value||typeof value!=='object')return;
    for(const [key,v]of Object.entries(value)){
      if(['src','avatar','avatarSource'].includes(key)&&typeof v==='string'&&v)value[key]=refs.get(v);
      else if(v&&typeof v==='object')replaceImages(v,refs);
    }
  }
  async function download(){
    if(working)return;working=true;M.setBusy(true);
    const button=$('pf-export-download'),options=selection();
    $('pf-dialog-error').hidden=true;button.disabled=true;
    const inputs=[...M.element.querySelectorAll('input[type=checkbox]')],disabledBefore=inputs.map(input=>input.disabled);
    inputs.forEach(input=>{input.disabled=true;});
    try{
      const data=S.copy(selectedData(options)),sources=[...imageSources(data)],media={},refs=new Map();
      for(let i=0;i<sources.length;i++){
        $('pf-export-status').textContent=`正在整理图片 ${i+1} / ${sources.length}…`;button.textContent='正在准备…';
        const id='image-'+String(i+1).padStart(4,'0'),dataUrl=await embed(sources[i]);
        media[id]={dataUrl,mimeType:dataUrl.slice(5,dataUrl.indexOf(';'))};refs.set(sources[i],'media:'+id);
      }
      replaceImages(data,refs);
      const payload={format:'memory-archive-export',version:1,exportedAt:new Date().toISOString(),snapshotAt:snapshot.at,options,warnings:snapshot.warnings,counts:{records:data.records.length,drafts:data.drafts?.length||0,trash:data.trash?.length||0,conversations:data.conversations?.length||0,images:sources.length},imageReferenceFormat:'media:<id> references media[id].dataUrl; all image bytes are embedded.',...data,media};
      const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),anchor=document.createElement('a');
      anchor.href=url;anchor.download='记忆档案馆-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
      $('pf-export-status').textContent=`文件已生成并交给浏览器下载（${(blob.size/1024/1024).toFixed(2)} MB）。请在浏览器下载记录中查看。`;
      button.textContent='已生成文件';
    }catch(e){$('pf-export-status').textContent='尚未生成文件；当前选择仍保留，可以重试。';button.disabled=false;button.textContent='重新生成 JSON';inputs.forEach((input,i)=>{input.disabled=disabledBefore[i];});throw e;}
    finally{working=false;M.setBusy(false);}
  }
  window.ProfileExport={open};
})();

;
/* app.js */
(() => {
  'use strict';

  const experience = document.querySelector('#experience');
  const scenes = [...document.querySelectorAll('.scene')];
  const reducedMotion = window.ArchivePreferences.motion;
  const finePointer = window.matchMedia('(pointer: fine)');
  const form = document.querySelector('#login-form');
  const username = document.querySelector('#username');
  const password = document.querySelector('#password');
  const consent = document.querySelector('#consent');
  const submit = document.querySelector('#login-submit');
  const status = document.querySelector('#form-status');
  const dialog = document.querySelector('#info-dialog');
  const dialogPrimary = document.querySelector('#dialog-primary');
  let currentScene = 'intro';
  let introTimer;
  let sceneTimer;
  let submitTimer;
  let closeTimer;
  let dialogAction = null;
  let lastDialogTrigger = null;
  let busy = false;

  // The state of this prototype stays in memory; no credentials are persisted.
  function setBusy(value) {
    busy = value;
    submit.disabled = value;
    submit.classList.toggle('is-loading', value);
    submit.setAttribute('aria-busy', String(value));
    submit.querySelector('.button-text').textContent = value ? '正在开启记忆…' : '开始使用';
    username.readOnly = value;
    password.readOnly = value;
    consent.disabled = value;
  }

  function cancelSubmission() {
    window.clearTimeout(submitTimer);
    setBusy(false);
    status.textContent = '';
  }

  function setScene(next, { focus = true, route = null } = {}) {
    if (!['intro', 'welcome', 'login', 'archive'].includes(next)) return;
    if(next!=='archive'&&window.RecordEditor?.isOpen()){
      window.MemoryArchive.bridge.writeRoute();
      window.RecordEditor.requestLeave(()=>setScene(next,{focus,route}));return;
    }
    window.clearTimeout(introTimer);
    window.clearTimeout(sceneTimer);
    cancelSubmission();
    if (next !== 'login') {
      password.value = '';
      resetPasswordVisibility();
      clearError('password');
    }
    document.body.classList.remove('intro-playing');
    const previous = currentScene;
    if (previous === 'archive' && next !== 'archive') window.MemoryArchive.deactivate();
    currentScene = next;
    experience.dataset.scene = next;
    scenes.forEach((scene) => {
      const active = scene.id === next;
      scene.classList.toggle('is-active', active);
      scene.classList.toggle('is-leaving', scene.id === previous && !active);
      scene.inert = !active;
      scene.setAttribute('aria-hidden', String(!active));
    });
    document.querySelectorAll('.scene-nav button').forEach((button) => {
      if (button.dataset.go === next) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    if (next === 'archive') {
      resetParallax();
      window.MemoryArchive.activate({ focus, route });
    } else {
      try { history.replaceState(null, '', `#${next}`); } catch { /* file:// remains usable. */ }
    }
    if (focus && next !== 'archive') {
      document.querySelector(`#${next} h1`).focus({ preventScroll: true });
    }
    sceneTimer = window.setTimeout(() => scenes.forEach((scene) => scene.classList.remove('is-leaving')), 650);
    if (next === 'intro') {
      // Restart the narrative progress line, including after replay.
      void experience.offsetWidth;
      document.body.classList.add('intro-playing');
      introTimer = window.setTimeout(() => {
        if (dialog.open) return;
        setScene('welcome', { focus: document.activeElement.closest?.('#intro') !== null });
      }, reducedMotion.matches ? 350 : 2900);
    }
  }

  document.querySelectorAll('[data-go]').forEach((button) => {
    button.addEventListener('click', () => setScene(button.dataset.go));
  });

  const particles = document.querySelector('#particles');
  for (let i = 0; i < 18; i += 1) {
    const particle = document.createElement('span');
    particle.className = 'particle';
    particle.style.cssText = `left:${(i * 37 + 11) % 96}%;top:${(i * 29 + 7) % 94}%;--duration:${5 + (i % 6)}s;--delay:-${i % 7}s`;
    particles.appendChild(particle);
  }

  const parallaxTarget = document.querySelector('.orb-parallax');
  let pointerFrame = 0;
  let pointerX = 0;
  let pointerY = 0;
  function resetParallax() {
    cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
    parallaxTarget.style.setProperty('--pointer-x', '0px');
    parallaxTarget.style.setProperty('--pointer-y', '0px');
  }
  experience.addEventListener('pointermove', (event) => {
    if (currentScene !== 'login' || !finePointer.matches || reducedMotion.matches || event.pointerType === 'touch') return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      if (currentScene !== 'login') return;
      const rect = experience.getBoundingClientRect();
      const x = ((pointerX - rect.left) / rect.width - 0.5) * 9;
      const y = ((pointerY - rect.top) / rect.height - 0.5) * 7;
      // Scope changes to one foreground layer, without invalidating the whole page.
      parallaxTarget.style.setProperty('--pointer-x', `${x.toFixed(2)}px`);
      parallaxTarget.style.setProperty('--pointer-y', `${y.toFixed(2)}px`);
    });
  }, { passive: true });
  experience.addEventListener('pointerleave', resetParallax);
  reducedMotion.addEventListener('change', resetParallax);

  function resetPasswordVisibility() {
    password.type = 'password';
    const toggle = document.querySelector('#toggle-password');
    toggle.setAttribute('aria-label', '显示密码');
    toggle.setAttribute('aria-pressed', 'false');
    toggle.querySelector('use').setAttribute('href', '#i-eye');
  }
  document.querySelector('#toggle-password').addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    const toggle = document.querySelector('#toggle-password');
    toggle.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    toggle.setAttribute('aria-pressed', String(show));
    toggle.querySelector('use').setAttribute('href', show ? '#i-eye-off' : '#i-eye');
  });

  function clearError(name) {
    document.querySelector(`#${name}-group`).classList.remove('has-error', 'nudge');
    document.querySelector(`#${name}-error`).textContent = '';
    document.querySelector(`#${name}`).removeAttribute('aria-invalid');
  }
  username.addEventListener('input', () => clearError('username'));
  password.addEventListener('input', () => clearError('password'));
  consent.addEventListener('change', () => clearError('consent'));

  const dialogCopy = {
    register: {
      title: '给记忆一个专属空间',
      body: '账户注册将在后续页面开放。\n现在无需填写账号或密码，直接点击“开始使用”即可进入演示档案馆。',
      button: '回到登录',
    },
    forgot: {
      title: '让记忆，再次与你相遇',
      body: '当前是前端交互演示，无需真实账户。\n直接点击“开始使用”即可继续；真实的密码找回功能将在账户服务接入后提供。',
      button: '继续体验',
    },
    terms: {
      title: '用户协议',
      body: '欢迎体验记忆档案馆。\n本网站用于设计作业与界面交互展示。记忆、图片和草稿保存在当前浏览器中，刷新后可以继续查看；不提供真实注册、身份验证或云端同步。',
      button: '我已了解',
    },
    privacy: {
      title: '珍视每一份私人记忆',
      body: '此演示不会上传、保存或记录你的用户名和密码，也不会使用统计追踪。\n输入仅保留在当前页面内存中。建议使用虚构信息体验，离开登录页后会清空密码。',
      button: '我已了解',
    },
  };

  function openDialog(copy, trigger, onPrimary = null, success = false) {
    window.clearTimeout(closeTimer);
    lastDialogTrigger = trigger || document.activeElement;
    dialogAction = onPrimary;
    dialog.classList.remove('is-closing');
    document.querySelector('#dialog-title').textContent = copy.title;
    document.querySelector('#dialog-body').textContent = copy.body;
    dialogPrimary.querySelector('span').textContent = copy.button;
    document.querySelector('#dialog-emblem use').setAttribute('href', success ? '#i-check' : '#i-spark');
    document.querySelector('#dialog-eyebrow').textContent = success ? 'A NEW MEMORY BEGINS' : 'ARCHIVE OF MEMORIES';
    if (!dialog.open) dialog.showModal();
    document.querySelector('#close-dialog').focus({ preventScroll: true });
  }

  function closeDialog(runAction = false) {
    if (!dialog.open || dialog.classList.contains('is-closing')) return;
    const action = runAction ? dialogAction : null;
    dialog.classList.add('is-closing');
    closeTimer = window.setTimeout(() => {
      dialog.close();
      dialog.classList.remove('is-closing');
      if (action) action();
      else if (lastDialogTrigger?.isConnected && !lastDialogTrigger.closest('[inert]')) lastDialogTrigger.focus({ preventScroll: true });
      dialogAction = null;
    }, reducedMotion.matches ? 0 : 170);
  }
  document.querySelectorAll('[data-dialog]').forEach((button) => {
    button.addEventListener('click', () => openDialog(dialogCopy[button.dataset.dialog], button));
  });
  document.querySelector('#close-dialog').addEventListener('click', () => closeDialog());
  dialogPrimary.addEventListener('click', () => closeDialog(true));
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    ['username', 'password', 'consent'].forEach(clearError);
    setBusy(true);
    status.textContent = '正在开启记忆…';
    submitTimer = window.setTimeout(() => {
      if (currentScene !== 'login') return;
      setScene('archive', { route: '#archive/view' });
    }, reducedMotion.matches ? 0 : 420);
  });

  document.addEventListener('archive:exit', () => setScene('welcome'));
  document.addEventListener('archive:info', (event) => openDialog(event.detail));
  window.addEventListener('hashchange', () => {
    const route = location.hash;
    const scene = route.slice(1).split('/')[0];
    if (dialog.open) { window.clearTimeout(closeTimer); dialog.close(); }
    setScene(['intro', 'welcome', 'login', 'archive'].includes(scene) ? scene : 'welcome', { route });
  });
  // Show the active scene immediately; hidden-page images must never gate entry.
  document.body.classList.add('is-ready');
  const initialRoute = location.hash;
  const initialScene = initialRoute.slice(1).split('/')[0];
  setScene(['intro', 'welcome', 'login', 'archive'].includes(initialScene) ? initialScene : 'intro', { focus: false, route: initialRoute });
  const syncVisibility = () => document.body.classList.toggle('page-hidden', document.hidden);
  document.addEventListener('visibilitychange', syncVisibility);
  syncVisibility();
})();
