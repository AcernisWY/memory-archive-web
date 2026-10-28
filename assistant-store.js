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
