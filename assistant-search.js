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
