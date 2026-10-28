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
