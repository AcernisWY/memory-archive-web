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
