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
