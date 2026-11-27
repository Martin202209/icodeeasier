// ==UserScript==
// @name         iCode 做题情况 - 一键发下一题
// @namespace    icode-admin-ext
// @version      0.4.36
// @description  在「做题情况」页导出按钮旁加一个「发下一题」，并把学员表格的「有道ID」挪到最后一列、「学生昵称」挪到倒数第二列
// @author       小云
// @match        https://icode-admin.youdao.com/*
// @match        https://icode-admin-ext.youdao.com/*
// @match        https://oj.youdao.com/wap/studyingReport/*
// @match        https://oj.youdao.com/course/*
// @grant        unsafeWindow
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @connect      oj.youdao.com
// @run-at       document-start
// @homepageURL  https://github.com/Martin202209/icodeeasier
// @supportURL   https://github.com/Martin202209/icodeeasier/issues
// @downloadURL  https://cdn.jsdelivr.net/gh/Martin202209/icodeeasier@main/icode-oneclick-publish.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/Martin202209/icodeeasier@main/icode-oneclick-publish.user.js
// ==/UserScript==

(async function () {
  'use strict';

  // 代码页发送存活状态，管理页无需跨域读取窗口地址。
  if(location.hostname==='oj.youdao.com'&&location.pathname.startsWith('/course/')) {
    const token=new URLSearchParams(location.search).get('icodeViewer');
    if(token&&/^[a-zA-Z0-9-]+$/.test(token)) {
      const key='icode-viewer:'+token;
      const update=active=>GM_setValue(key,{url:location.href,active,time:Date.now()});
      let timer=null;
      function resume(){
        update(true);
        if(timer===null)timer=setInterval(()=>update(true),2000);
      }
      resume();
      window.addEventListener('pagehide',()=>{clearInterval(timer);timer=null;update(false);});
      window.addEventListener('pageshow',resume);
      window.addEventListener('hashchange',()=>update(true));
      window.addEventListener('popstate',()=>update(true));
      document.addEventListener('visibilitychange',()=>{if(!document.hidden)resume();});
    }
    return;
  }
  // 在应用请求前接管班级列表响应：全量反转后重新分页。
  if(location.hostname!=='oj.youdao.com') {
    const win=unsafeWindow;
    const nativeFetch=win.fetch.bind(win);
    function classListURL(value) {
      try {const url=new URL(value,location.href);return /^#\/class\/list(?:[?]|$)/.test(location.hash)&&url.origin==='https://icodecontest-online-api.youdao.com'&&url.pathname==='/api/admin/class/getClassList'?url:null;}catch(_){return null;}
    }
    async function reversedClasses(url) {
      const page=Number(url.searchParams.get('page')||1),size=Number(url.searchParams.get('size')||20);
      if(!Number.isInteger(page)||page<1||!Number.isInteger(size)||size<1) throw new Error('分页参数异常');
      const all=[];let first,total;
      for(let n=1;n<=500;n++) {
        const request=new URL(url);request.searchParams.set('page',n);
        const response=await nativeFetch(request.href,{credentials:'include',signal:AbortSignal.timeout(20000)});
        if(!response.ok) throw new Error('班级列表 HTTP '+response.status);
        const json=await response.json();
        if(Number(json.code)!==0||!Array.isArray(json.data?.list))throw new Error('班级列表格式异常');
        if(!first){first=json;total=Number(json.data.total);if(!Number.isInteger(total)||total<0)throw new Error('班级总数异常');}
        if(Number(json.data.total)!==total)throw new Error('班级列表采集期间有变动');
        all.push(...json.data.list);
        if(all.length>=total)break;
        if(!json.data.list.length||n===500)throw new Error('未取齐班级列表');
      }
      if(all.length!==total||new Set(all.map(c=>String(c.id))).size!==total)throw new Error('班级列表重复或不完整');
      return {...first,data:{...first.data,total,pages:Math.ceil(total/size),list:all.reverse().slice((page-1)*size,page*size)}};
    }
    win.fetch=async function(input,init) {
      const url=classListURL(typeof input==='string'||input instanceof URL?String(input):input?.url);
      if(url&&(!init?.method||init.method.toUpperCase()==='GET')&&(!input?.method||input.method==='GET')) {
        try {const result=await reversedClasses(url);if(init?.signal?.aborted)throw new DOMException('Aborted','AbortError');return new win.Response(JSON.stringify(result),{status:200,headers:{'Content-Type':'application/json'}});}
        catch(error){console.warn('[iCode 助手] 班级倒序失败，使用原始列表',error);}
      }
      return nativeFetch(input,init);
    };
    const proto=win.XMLHttpRequest.prototype,open=proto.open,send=proto.send,abort=proto.abort;
    const requests=new WeakMap();
    proto.open=function(method,url,async,...rest){requests.set(this,{url:method.toUpperCase()==='GET'&&async!==false?classListURL(url):null,cancelled:false});return open.call(this,method,url,async===undefined?true:async,...rest);};
    proto.abort=function(){const request=requests.get(this);if(request)request.cancelled=true;return abort.call(this);};
    proto.send=function(body){
      const request=requests.get(this);
      if(!request?.url)return send.call(this,body);
      const xhr=this;
      (async()=>{
        try {
          const result=await reversedClasses(request.url);
          if(request.cancelled||requests.get(xhr)!==request)return;
          const text=JSON.stringify(result);
          Object.defineProperty(xhr,'responseText',{configurable:true,get(){return xhr.readyState===4?text:'';}});
          Object.defineProperty(xhr,'response',{configurable:true,get(){return xhr.readyState===4?(xhr.responseType==='json'?result:text):null;}});
        }catch(error){console.warn('[iCode 助手] 班级倒序失败，使用原始列表',error);}
        if(!request.cancelled&&requests.get(xhr)===request)send.call(xhr,body);
      })().catch(console.error);
    };
  }
  // 题号链接统一复用一个顶层标签页，使代码页插件正常运行。
  if(location.hostname!=='oj.youdao.com') {
    const win=unsafeWindow,nativeOpen=win.open;
    let armed=false,viewer=null,viewerToken=null,viewerTarget=null;
    const reuseKey='icode-reuse-code-tab';
    let reuseEnabled=true;
    try {reuseEnabled=localStorage.getItem(reuseKey)!=='false';}catch(_){}
    const refreshKey='icode-auto-refresh-10s';
    let autoRefresh=false,nextRefresh=Date.now()+10000;
    try{autoRefresh=localStorage.getItem(refreshKey)==='true';}catch(_){}
    const colorKey='icode-color-enhance';
    let colorEnabled=false;
    try{colorEnabled=localStorage.getItem(colorKey)==='true';}catch(_){}
    function applyEnhancedColors() {
      if(!document.body)return;
      let style=document.getElementById('icode-enhanced-colors');
      if(!style){style=document.createElement('style');style.id='icode-enhanced-colors';style.textContent='[data-icode-color="correct"]{background-color:#1fd8ff!important}[data-icode-color="wrong"]{background-color:#ff461f!important}[data-icode-color="empty"]{background-color:#f0f0f0!important}';document.head.appendChild(style);}
      for(const el of document.querySelectorAll('[class*="tag___"], [data-icode-color]')) {
        let kind='';
        if(colorEnabled && (el.closest('tbody')||el.closest('.ant-pro-table-list-toolbar-title'))) {
          const bg=el.style.backgroundColor.replace(/\s/g,'').toLowerCase();
          if(bg.includes('60,207,60'))kind='correct';
          else if(bg.includes('255,42,42'))kind='wrong';
          else if(bg.includes('255,255,255')||bg==='transparent'||bg==='#fff'||bg==='#ffffff')kind='empty';
        }
        // 仅用 CSS 覆盖颜色，保留网页原始内联值，关闭开关即可还原。
        if(kind){if(el.dataset.icodeColor!==kind)el.dataset.icodeColor=kind;}
        else if(el.hasAttribute('data-icode-color'))el.removeAttribute('data-icode-color');
      }
    }
    setInterval(applyEnhancedColors,200);
    function mountReuseToggle() {
      const active=Array.from(document.querySelectorAll('.ant-tabs-tab-active')).some(e=>e.textContent.includes('做题情况'));
      if(!active)return;
      for(const list of document.querySelectorAll('.ant-pro-table-column-setting-list')) {
        if(!list.getClientRects().length)continue;
        const panel=list.closest('.ant-popover-inner-content')||list.parentElement;
        if(panel.querySelector('[data-icode-extra-settings]'))continue;
        const box=document.createElement('div');box.dataset.icodeExtraSettings='';box.style.cssText='border-top:1px solid #eee;margin-top:8px;padding:14px 16px 12px;display:flex;flex-direction:column;gap:10px;font:inherit';
        function toggle(name,kind,checked,change) {
          const label=document.createElement('label');label.className='ant-checkbox-wrapper';label.style.cssText='display:flex;align-items:center;margin-left:0;font:inherit';
          const check=document.createElement('span');check.className='ant-checkbox';
          const input=document.createElement('input');input.type='checkbox';input.className='ant-checkbox-input';input.checked=checked;input.dataset.icodeSetting=kind;input.setAttribute('aria-label',name);
          const inner=document.createElement('span');inner.className='ant-checkbox-inner';check.append(input,inner);
          const text=document.createElement('span');text.textContent=name;
          input.addEventListener('change',()=>change(input.checked));
          label.addEventListener('click',e=>e.stopPropagation());label.append(check,text);box.append(label);

        }
        toggle('OnlyOne代码页','reuse',reuseEnabled,value=>{reuseEnabled=value;try{localStorage.setItem(reuseKey,String(value));}catch(_){}syncSettings();});
        toggle('10s自动刷新','refresh',autoRefresh,value=>{autoRefresh=value;nextRefresh=Date.now()+10000;try{localStorage.setItem(refreshKey,String(value));}catch(_){}syncSettings();});
        toggle('色彩增强','color',colorEnabled,value=>{colorEnabled=value;try{localStorage.setItem(colorKey,String(value));}catch(_){}syncSettings();applyEnhancedColors();});
        panel.appendChild(box);syncSettings();
      }
    }
    function syncSettings(){document.querySelectorAll('[data-icode-setting]').forEach(input=>{
      input.checked=input.dataset.icodeSetting==='reuse'?reuseEnabled:input.dataset.icodeSetting==='refresh'?autoRefresh:colorEnabled;
      input.parentElement.classList.toggle('ant-checkbox-checked',input.checked);
      input.closest('label')?.classList.toggle('ant-checkbox-wrapper-checked',input.checked);
    });}

    setInterval(mountReuseToggle,500);
    window.addEventListener('storage',event=>{
      if(event.key===colorKey){colorEnabled=event.newValue==='true';applyEnhancedColors();}
      if(event.key===reuseKey)reuseEnabled=event.newValue!=='false';
      if(event.key===refreshKey){autoRefresh=event.newValue==='true';nextRefresh=Date.now()+10000;}
      syncSettings();
    });
    setInterval(()=>{
      if(!autoRefresh)return;
      if(document.hidden||collecting||publishing||snapshotting||arranging||openingSettings||!pageCtx()||!onReportTab()) {nextRefresh=Date.now()+10000;return;}
      if(Date.now()<nextRefresh)return;
      // 操作表单、下拉菜单或列设置时暂缓，避免编辑被刷新打断。
      if(Array.from(document.querySelectorAll('.ant-popover, .ant-modal, .ant-cascader-menus, .ant-spin-spinning')).some(e=>e.getClientRects().length))return;
      if(document.activeElement?.matches('input,textarea,[contenteditable="true"]'))return;
      const toolbar=findExportButton()?.closest('.ant-pro-table-list-toolbar');
      if(!toolbar)return;
      const reloads=Array.from(toolbar.querySelectorAll('span.anticon-reload[aria-label="reload"]')).filter(e=>e.getClientRects().length);
      if(reloads.length!==1)return;
      nextRefresh=Date.now()+10000;reloads[0].click();
    },500);
    function sameCodePageExceptLastNumber(actual,expected) {
      if(actual===expected)return true;
      try {
        const a=new URL(actual),b=new URL(expected);
        // 只允许完整 URL 最末尾的数字不同；路径、学生、查询参数等必须一致。
        const normalize=url=>url.href.replace(/\d+$/, '{last-number}');
        return /\d+$/.test(a.href)&&/\d+$/.test(b.href)&&normalize(a)===normalize(b);
      }catch(_){return false;}
    }
    function courseURL(value) {
      try {const url=new URL(String(value),location.href);return url.origin==='https://oj.youdao.com'&&/^\/course\/\d+\/\d+\/\d+\/?$/.test(url.pathname)&&url.searchParams.has('studentId')?url.href:null;}catch(_){return null;}
    }
    document.addEventListener('click',event=>{
      const target=event.target instanceof Element?event.target:null;
      const tag=target?.closest('span[class*="tag___"]');
      const active=Array.from(document.querySelectorAll('.ant-tabs-tab-active')).some(e=>e.textContent.includes('做题情况'));
      armed=!!(tag&&tag.closest('tbody tr')&&/^\d+$/.test(tag.textContent.trim())&&active);
      if(armed)setTimeout(()=>{armed=false;},0);
    },true);
    win.open=function(url,...args) {
      const target=armed&&reuseEnabled?courseURL(url):null;
      if(!target)return nativeOpen.call(this,url,...args);
      armed=false;
      // 后台标签页可能被节流或冻结，状态时间过久本身不代表页面已离开。
      let canReuse=false;
      try {
        const state=viewerToken?GM_getValue('icode-viewer:'+viewerToken,null):null;
        canReuse=!!(viewer&&!viewer.closed&&state?.active&&sameCodePageExceptLastNumber(state.url,viewerTarget));
      }catch(_){}
      if(canReuse) {
        const next=new URL(target);next.searchParams.set('icodeViewer',viewerToken);
        try {
          // 先清除旧地址的确认状态，等新页面报告后才能再次复用。
          GM_setValue('icode-viewer:'+viewerToken,{active:false,time:Date.now()});
          viewer.location=next.href;viewerTarget=next.href;
          try{viewer.focus();}catch(_){}
          return viewer;
        }catch(error){console.warn('[iCode 助手] 无法复用原窗口，将新建代码页',error);}
      }
      // 手动改址或状态未知时保留旧页面，用唯一窗口名避免覆盖搜索页面。
      const token=crypto.randomUUID();
      const next=new URL(target);next.searchParams.set('icodeViewer',token);
      const opened=nativeOpen.call(win,next.href,'icode-student-code-'+token);
      if(opened){
        if(viewerToken)GM_deleteValue('icode-viewer:'+viewerToken);
        viewer=opened;viewerToken=token;viewerTarget=next.href;
        try{viewer.focus();}catch(_){}
      }else window.alert('代码页未能打开，请允许此网站弹出窗口后重试。');
      return opened;
    };
  }
  if(document.readyState==='loading') await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));

  // 报告页仅负责读取当前报告，通过油猴存储返回，不访问管理页 DOM。
  const SCORE_PREFIX = 'icode-score-job:';
  if (location.hostname === 'oj.youdao.com') {
    (async () => {
      const token = new URLSearchParams(location.hash.slice(1)).get('icodeScoreJob');
      if (!token || !/^[a-zA-Z0-9-]+$/.test(token)) return;
      const key = SCORE_PREFIX + token;
      const job = await GM_getValue(key, null);
      if (!job || job.url !== location.origin + location.pathname || Date.now() - job.started > 90000) return;
      const until = Date.now() + 45000;
      while (Date.now() < until) {
        if (!(await GM_getValue(key, null))) return;
        const el = document.querySelector('[class*="ScoreBar_bar_text_score"]');
        let score = el?.textContent?.trim();
        if (!score) {
          for (const svg of document.querySelectorAll('svg')) {
            if (!svg.textContent.includes('分制')) continue;
            score = Array.from(svg.querySelectorAll('text, tspan')).map(e => e.textContent.trim()).find(t => /^\d+(\.\d+)?$/.test(t));
            if (score) break;
          }
        }
        if (score && /^\d+(\.\d+)?$/.test(score)) {
          await GM_setValue(key, { ...job, done: true, score });
          return;
        }
        await new Promise(r => setTimeout(r, 300));
      }
      await GM_setValue(key, { ...job, done: true, error: '报告加载超时或未找到分数' });
    })().catch(console.error);
    return;
  }

  let collecting = false, cancelCollection = false;
  const waitScore = ms => new Promise(r => setTimeout(r, ms));
  const cleanScoreText = el => (el?.textContent || '').replace(/\s+/g, '').toLowerCase();
  function collectionCheck(hash) {
    if (cancelCollection) throw new Error('已取消');
    if (location.hash !== hash) throw new Error('页面地址已变化，停止采集');
  }
  function currentTable() {
    // antd 滚动表格会拆分表头、表体，还可能存在固定列副本。
    const panes = Array.from(document.querySelectorAll('.ant-tabs-tabpane-active')).filter(e => e.getClientRects().length);
    const root = document;
    let tables = Array.from(root.querySelectorAll('table')).filter(t =>
      t.getClientRects().length && Array.from(t.querySelectorAll('tbody tr')).some(r => r.getClientRects().length && r.querySelectorAll('td').length >= 2 && !r.classList.contains('ant-table-measure-row')) &&
      !t.closest('.ant-table-fixed-left, .ant-table-fixed-right')
    );
    if (tables.length > 1) {
      const main = tables.filter(t => t.closest('.ant-table-body, .ant-table-content'));
      if (main.length) tables = main;
    }
    if (tables.length !== 1) throw new Error('学生表格定位失败：发现 ' + tables.length + ' 张数据表');
    return tables[0];
  }
  function scoreRows(table) {
    return Array.from(table.querySelectorAll('tbody tr')).filter(r =>
      r.getClientRects().length && r.querySelectorAll('td').length >= 2 &&
      !r.classList.contains('ant-table-measure-row') && !r.classList.contains('ant-table-placeholder')
    );
  }
  function scoreRowSignature(row) {
    return row.getAttribute('data-row-key') || Array.from(row.querySelectorAll('td')).map(c => c.textContent.trim()).join('~');
  }
  function scoreTableHeaders(table) {
    const scope = table.closest('.ant-table-wrapper') || table.closest('.ant-table') || table;
    const candidates = Array.from(scope.querySelectorAll('thead tr')).filter(row => row.getClientRects().length && !row.closest('.ant-table-fixed-left, .ant-table-fixed-right'));
    const row = candidates.find(row => Array.from(row.children).some(c => cleanScoreText(c) === '有道id'));
    if (!row) throw new Error('未找到包含有道ID的表头，请在列设置中显示该列');
    return Array.from(row.children).map(cleanScoreText);
  }
  async function switchScoreTab(name, hash) {
    collectionCheck(hash);
    const tabs = Array.from(document.querySelectorAll('[role="tab"]')).filter(e => cleanScoreText(e) === name);
    if (tabs.length !== 1) throw new Error('未找到唯一的“' + name + '”标签');
    tabs[0].click();
    await waitScore(900);
    let lastError = '';
    for (let i=0;i<100;i++) {
      collectionCheck(hash);
      if (!Array.from(document.querySelectorAll('.ant-spin-spinning')).some(e => e.getClientRects().length)) {
        try {
          const active = Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"], .ant-tabs-tab-active')).some(e => cleanScoreText(e) === name);
          if (active) return currentTable();
          lastError = '标签尚未切换完成';
        } catch (error) { lastError = error.message; }
      }
      await waitScore(200);
    }
    const empty = Array.from(document.querySelectorAll('.ant-tabs-tabpane-active .ant-empty-description')).filter(e => e.getClientRects().length).map(e => e.textContent.trim()).join('；');
    throw new Error(name + '：' + (empty || lastError || '等待数据超时') + '。请先确认该页已显示学生列表');
  }
  async function walkScorePages(hash, visit) {
    // 从第一页开始，避免用户当前停在后续页面导致遗漏。
    const initialTable = currentTable();
    const initialScope = initialTable.closest('.ant-pro-table') || initialTable.closest('.ant-table-wrapper');
    const first = initialScope?.querySelector('.ant-pagination-item-1');
    if (first && !first.classList.contains('ant-pagination-item-active')) {
      first.click();
      await waitScore(1200);
      for (let i=0;i<50;i++) {
        collectionCheck(hash);
        if (first.classList.contains('ant-pagination-item-active') && !initialScope.querySelector('.ant-spin-spinning')) break;
        if (i===49) throw new Error('返回第一页超时');
        await waitScore(200);
      }
    }
    const seen = new Set();
    for (let page=0;page<500;page++) {
      collectionCheck(hash);
      const table = currentTable();
      const rows = scoreRows(table);
      const signature = rows.map(scoreRowSignature).join('|');
      if (!signature || seen.has(signature)) throw new Error('分页数据重复或为空，停止以避免漏采');
      seen.add(signature);
      await visit(table, rows);
      collectionCheck(hash);
      const scope = table.closest('.ant-pro-table') || table.closest('.ant-table-wrapper');
      if (!scope) throw new Error('未找到分页容器');
      const next = scope.querySelector('.ant-pagination-next');
      if (!next || next.classList.contains('ant-pagination-disabled') || next.getAttribute('aria-disabled') === 'true' || next.querySelector('button')?.disabled) return;
      (next.querySelector('button') || next).click();
      let changed = false;
      for (let i=0;i<75;i++) {
        await waitScore(200); collectionCheck(hash);
        try {
          const newTable = currentTable();
          const sig = scoreRows(newTable).map(scoreRowSignature).join('|');
          if (sig && sig !== signature && !scope.querySelector('.ant-spin-spinning')) { changed=true; break; }
        } catch (_) {}
      }
      if (!changed) throw new Error('翻页超时，已保留已采集结果');
    }
    throw new Error('超过分页数量上限');
  }
  // 报告页是 Next.js 服务端渲染，分数直接内嵌在 HTML 的 __NEXT_DATA__ 里，无需打开标签页。
  function gmGetText(url, timeout) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, timeout, withCredentials: true,
        onload: res => resolve(res),
        onerror: () => reject(new Error('网络错误')),
        ontimeout: () => reject(new Error('请求超时')),
      });
    });
  }
  async function readReportScoreByApi(base) {
    const res = await gmGetText(base, 20000);
    if (res.status !== 200) throw new Error('HTTP ' + res.status);
    const match = String(res.responseText || '').match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) throw new Error('报告页缺少数据');
    const score = JSON.parse(match[1])?.props?.pageProps?.reportDetail?.examInfo?.score;
    if (typeof score !== 'number' || !Number.isFinite(score)) throw new Error('报告中未找到分数');
    return String(score);
  }
  async function readReportScore(url, hash) {
    const parsed = new URL(url, location.href);
    if (parsed.origin !== 'https://oj.youdao.com' || !/^\/wap\/studyingReport\/[a-zA-Z0-9]+$/.test(parsed.pathname)) throw new Error('报告地址不符合预期');
    collectionCheck(hash); assertReportSelection();
    try { return await readReportScoreByApi(parsed.origin + parsed.pathname); }
    catch (error) { console.warn('[iCode 助手] 接口读取分数失败，回退为打开报告页', error); }
    collectionCheck(hash); assertReportSelection();
    // 回退方式较重，限制同时打开的标签页数量。
    while (tabFallbackSlots >= 3) { collectionCheck(hash); await waitScore(200); }
    tabFallbackSlots++;
    try { return await readReportScoreTab(url, hash); } finally { tabFallbackSlots--; }
  }
  let tabFallbackSlots = 0;
  async function readReportScoreTab(url, hash) {
    const parsed = new URL(url, location.href);
    if (parsed.origin !== 'https://oj.youdao.com' || !parsed.pathname.startsWith('/wap/studyingReport/')) throw new Error('报告地址不符合预期');
    const token = crypto.randomUUID(), key = SCORE_PREFIX + token;
    const base = parsed.origin + parsed.pathname;
    let tab;
    try {
      await GM_setValue(key, { url: base, started: Date.now() });
      parsed.hash = new URLSearchParams({ icodeScoreJob: token }).toString();
      tab = GM_openInTab(parsed.href, { active: false, insert: true });
      const until = Date.now()+60000;
      while (Date.now()<until) {
        collectionCheck(hash);
        assertReportSelection();
        const result = await GM_getValue(key, null);
        if (result?.done) {
          if (result.error) throw new Error(result.error);
          return result.score;
        }
        await waitScore(300);
      }
      throw new Error('报告读取超时，请确认油猴在报告网站已启用');
    } finally { tab?.close(); await GM_deleteValue(key); }
  }
  function downloadScores(rows, name) {
    // 多行代码保留原文，仅对单行值做公式注入防护。
    const escape = value => {
      const text = String(value ?? '');
      const safe = /[\r\n]/.test(text) ? text : text.replace(/^[=+@-]/, match => "'" + match);
      return '"' + safe.replace(/"/g, '""') + '"';
    };
    const csv = '\uFEFF' + rows.map(row=>row.map(escape).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8;'}));
    const a=document.createElement('a'); a.href=url;
    a.download=(name||'学生成绩统计')+'_'+new Date().toISOString().replace(/[:.]/g,'-')+'.csv';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),10000);
  }

  /* ================= XLSX 导出（内置 ZIP，无外部依赖） ================= */
  const XLSX_CELL_LIMIT = 32767;
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  const utf8 = new TextEncoder();
  // 只存储不压缩：省掉 deflate 实现，体积对本场景可接受。
  function zipStore(files) {
    const locals = [], centrals = [];
    let offset = 0;
    for (const { name, data } of files) {
      const nameBytes = utf8.encode(name);
      const dataBytes = typeof data === 'string' ? utf8.encode(data) : data;
      const crc = crc32(dataBytes);
      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0x5821, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, dataBytes.length, true);
      lv.setUint32(22, dataBytes.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      locals.push(local, dataBytes);

      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x5821, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, dataBytes.length, true);
      cv.setUint32(24, dataBytes.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      central.set(nameBytes, 46);
      centrals.push(central);
      offset += local.length + dataBytes.length;
    }
    const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    return new Blob([...locals, ...centrals, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  function xlsxText(value) {
    // 去掉 XML 非法控制字符并遵守 Excel 单格长度上限。
    const text = String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
    return text.length > XLSX_CELL_LIMIT ? text.slice(0, XLSX_CELL_LIMIT) : text;
  }
  const xmlEscape = (text) => text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
  function colLetter(index) {
    let name = '';
    for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    return name;
  }
  const XLSX_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  function xlsxSheet(rows, widths) {
    const cols = (widths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const body = rows.map((row, r) => {
      // 第2行是题目信息，内容往往很长：按最大行数给出行高，避免打开后只显示一行。
      const infoLines = r === 1 && row[0] === '题目信息'
        ? Math.max(...row.map((value) => String(value ?? '').split('\n').length))
        : 0;
      const height = infoLines > 1 ? ` ht="${Math.min(409, Math.max(30, infoLines * 14))}" customHeight="1"` : '';
      return '<row r="' + (r + 1) + '"' + height + '>' + row.map((value, c) => {
        const ref = colLetter(c + 1) + (r + 1);
        // 首行加粗，其余自动换行并顶端对齐；全部按文本写入，避免代码被当公式解析。
        const style = r === 0 ? ' s="1"' : ' s="2"';
        return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEscape(xlsxText(value))}</t></is></c>`;
      }).join('') + '</row>';
    }).join('');
    return XLSX_HEAD + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      + (cols ? '<cols>' + cols + '</cols>' : '')
      + '<sheetData>' + body + '</sheetData></worksheet>';
  }
  function downloadXlsx(rows, name, widths) {
    const files = [
      { name: '[Content_Types].xml', data: XLSX_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + '</Types>' },
      { name: '_rels/.rels', data: XLSX_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '</Relationships>' },
      { name: 'xl/workbook.xml', data: XLSX_HEAD + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + '<sheets><sheet name="学生代码" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: XLSX_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        + '</Relationships>' },
      { name: 'xl/styles.xml', data: XLSX_HEAD + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
        + '<borders count="1"><border/></borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
        + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
      { name: 'xl/worksheets/sheet1.xml', data: xlsxSheet(rows, widths) },
    ];
    const url = URL.createObjectURL(zipStore(files));
    const a = document.createElement('a');
    a.href = url;
    a.download = (name || '学生代码快照') + '_' + new Date().toISOString().replace(/[:.]/g, '-') + '.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  let expectedReportSelection = null;
  function reportPicker() {
    const inputs=Array.from(document.querySelectorAll('input[id="lessonCascader"]')).filter(el=>el.closest('.ant-cascader-picker')?.getClientRects().length);
    if(inputs.length!==1) throw new Error('无法唯一定位考试选择器');
    return inputs[0].closest('.ant-cascader-picker');
  }
  function reportSelection() {
    return (reportPicker().querySelector('.ant-cascader-picker-label')?.textContent||'').split('/').map(t=>t.trim()).filter(Boolean);
  }
  function sameReportSelection(parts) { return JSON.stringify(reportSelection())===JSON.stringify(parts); }
  async function restoreReportSelection(parts,hash) {
    collectionCheck(hash);
    if(!sameReportSelection(parts)) {
      reportPicker().click();
      for(let depth=0;depth<parts.length;depth++) {
        let option=null;
        for(let attempt=0;attempt<50;attempt++) {
          collectionCheck(hash);
          const panels=Array.from(document.querySelectorAll('.ant-cascader-menus')).filter(el=>el.getClientRects().length);
          if(panels.length===1) {
            const menu=panels[0].querySelectorAll('.ant-cascader-menu')[depth];
            const options=menu?Array.from(menu.querySelectorAll('.ant-cascader-menu-item')).filter(el=>{
              const text=el.querySelector('.ant-cascader-menu-item-content')?.textContent||el.getAttribute('title')||el.textContent;
              return text.trim()===parts[depth] && !el.classList.contains('ant-cascader-menu-item-disabled');
            }):[];
            if(options.length===1) {option=options[0];break;}
          }
          await waitScore(200);
        }
        if(!option) throw new Error('无法恢复考试选项：'+parts[depth]+'，已停止采集');
        option.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
        option.click();
        await waitScore(300);
      }
    }
    let stableSince=0;
    for(let i=0;i<100;i++) {
      collectionCheck(hash);
      const loading=Array.from(document.querySelectorAll('.ant-spin-spinning')).some(el=>el.getClientRects().length);
      if(sameReportSelection(parts)&&!loading) {
        if(!stableSince) stableSince=Date.now();
        if(Date.now()-stableSince>=1200) {currentTable();return;}
      } else stableSince=0;
      await waitScore(200);
    }
    throw new Error('考试选项未恢复或列表加载超时，已停止采集');
  }
  function assertReportSelection() {
    if(expectedReportSelection && !sameReportSelection(expectedReportSelection)) throw new Error('考试筛选已变化，停止采集以避免成绩混入');
  }
  const SCORE_CONCURRENCY = 6;
  async function collectScoreBatch(tasks, process, save, check) {
    const results=new Array(tasks.length);
    let cursor=0, fatal=null;
    async function worker() {
      while(!fatal) {
        let index;
        try {check(); index=cursor++; if(index>=tasks.length) return; results[index]=await process(tasks[index]);}
        catch(error) {fatal=fatal||error; return;}
      }
    }
    await Promise.allSettled(Array.from({length:Math.min(SCORE_CONCURRENCY,tasks.length)},()=>worker()));
    // 全部在途任务结束后再翻页或导出；完成顺序不影响 CSV 行顺序。
    results.forEach(result=>{if(result) save(result);});
    if(fatal) throw fatal;
  }
  function showScoreProgress(text) {
    const live=document.getElementById('icode-score-collector-btn');
    if(live) live.textContent=text;
  }
  async function collectScores(button) {
    if (collecting) return;
    if (publishing || arranging || openingSettings) { window.alert('请等待发题或列设置调整完成后再采集'); return; }
    if (snapshotting) { window.alert('请等待代码快照完成或取消'); return; }
    let selectedReport;
    try { selectedReport=reportSelection(); if(selectedReport.length<2) throw new Error('请先选择课程和考试'); }
    catch(error) {window.alert(error.message);return;}
    if (!window.confirm('即将导出：'+selectedReport.join(' / ')+'。\n\n将通过接口并行读取各学生的报告分数（接口失败时自动回退为打开报告页）。\n\n采集期间请勿切换当前页面的班级、标签、筛选或分页，也不要关闭浏览器及自动打开的报告页。\n可以正常使用其他浏览器标签页。\n\n完成后会自动下载 CSV 并弹窗提示；再次点击按钮可取消并导出已采集结果。\n\n是否开始？')) return;
    collecting=true; cancelCollection=false;
    const hash=location.hash, info=new Map(), nicknames=new Map();
    const rows=[['有道 ID','学生昵称','备注姓名','本次测验分数','采集说明']];
    let failure='';
    try {
      button.textContent='取消采集（读取学生资料）';
      await switchScoreTab('做题情况',hash);
      await walkScorePages(hash,async(table, students)=>{
        const headers=scoreTableHeaders(table);
        const idIndex=headers.indexOf('有道id'), nickIndex=headers.findIndex(h=>h==='学生昵称'||h==='学员昵称'), remarkIndex=headers.indexOf('备注姓名');
        if (idIndex<0||nickIndex<0||remarkIndex<0) throw new Error('请在列设置中显示有道ID、学生昵称和备注姓名');
        for (const row of students) {
          const cells=Array.from(row.children);
          const text=i=>(cells[i]?.textContent||'').trim();
          const record={id:text(idIndex).replace(/\s*copy\s*$/i,''), nickname:text(nickIndex), remark:text(remarkIndex).replace(/\s*edit\s*$/i,'')};
          // 学生资料包含已退组学员，避免报告匹配时缺少 ID 和备注。
          if (!record.nickname) continue;
          if (row.dataset.rowKey) info.set(row.dataset.rowKey,record);
          if (record.id) info.set(record.id,record);
          const list=nicknames.get(record.nickname)||[]; list.push(record); nicknames.set(record.nickname,list);
        }
      });
      await switchScoreTab('学情报告',hash);
      button.textContent='取消采集（恢复考试筛选）';
      await restoreReportSelection(selectedReport,hash);
      expectedReportSelection=selectedReport;
      let completed=0;
      await walkScorePages(hash,async(table, students)=>{
        // 先快照当前页，避免并行任务持有会被重渲染的 DOM 节点。
        const tasks=students.map(row=>({
          key:row.dataset.rowKey,
          nickname:(row.querySelector('td')?.textContent||'').trim(),
          url:Array.from(row.querySelectorAll('a[href]')).find(a=>a.textContent.trim()==='预览')?.href,
        })).filter(task=>task.nickname&&!task.nickname.includes('已退组'));
        const check=()=>{collectionCheck(hash);assertReportSelection();};
        await collectScoreBatch(tasks,async task=>{
          check();
          const matches=nicknames.get(task.nickname)||[];
          const record=info.get(task.key)||(matches.length===1?matches[0]:null);
          let score='',note=record?'':'学生资料未匹配或昵称重复';
          try {
            if(!task.url) throw new Error('无预览链接或权限');
            score=await readReportScore(task.url,hash);
          } catch(error) {
            check();
            note=[note,error.message].filter(Boolean).join('；');
          }
          check(); completed++;
          showScoreProgress('取消采集（已采集 '+completed+' 人）');
          return [record?.id||'',task.nickname,record?.remark||'',score,note];
        },result=>rows.push(result),check);
      });
    } catch(error) { failure=error.message; }
    finally {
      if (rows.length>1) downloadScores(rows);
      expectedReportSelection=null;
      collecting=false; button.textContent='导出成绩';
      const liveButton=document.getElementById('icode-score-collector-btn');
      if(liveButton) liveButton.textContent='导出成绩';
      window.alert(failure ? '采集未完整完成：'+failure+'。已采集 '+(rows.length-1)+' 人；有结果时已导出。' : '采集完成，已导出 '+(rows.length-1)+' 人。请查看 CSV 中的采集说明列。');
    }
  }
  function mountScoreCollector() {
    const existing=document.getElementById('icode-score-collector-btn');
    const reportActive=Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"], .ant-tabs-tab-active')).some(e=>cleanScoreText(e)==='学情报告');
    if (!pageCtx() || !reportActive) { if(existing){ const wrapper=existing.closest('[data-icode-score-wrapper]'); (wrapper||existing).remove(); } return; }
    const anchors=Array.from(document.querySelectorAll('button')).filter(e=>cleanScoreText(e)==='生成报告' && e.getClientRects().length);
    if (anchors.length!==1) { existing?.remove(); return; }
    const anchor=anchors[0];
    const anchorItem=anchor.closest('.ant-space-item');
    let button=existing;
    if (!button) {
      button=document.createElement('button');button.type='button';button.id='icode-score-collector-btn';
      button.textContent=collecting?'取消采集':'导出成绩';
      button.addEventListener('click',()=>{if(collecting){cancelCollection=true;button.textContent='正在取消…';}else collectScores(button).catch(console.error);});
    }
    if (!collecting) button.textContent='导出成绩';
    else if (cancelCollection) button.textContent='正在取消…';
    button.className=anchor.className;
    button.title='导出学生测验成绩；采集时再次点击可取消';
    // 复用相邻按钮的 antd 样式；不复制禁用状态和事件。
    if (anchorItem) {
      let wrapper=button.closest('[data-icode-score-wrapper]');
      if (!wrapper) { wrapper=document.createElement('div');wrapper.className=anchorItem.className;wrapper.dataset.icodeScoreWrapper='';wrapper.style.cssText=anchorItem.style.cssText;wrapper.appendChild(button); }
      wrapper.style.marginLeft='8px';
      if (anchorItem.nextElementSibling!==wrapper) anchorItem.after(wrapper);
    } else {
      button.style.marginLeft='8px';
      if (anchor.nextElementSibling!==button) anchor.after(button);
    }
  }
  setInterval(mountScoreCollector,1000);


  /* ================= 配置 ================= */
  const API = location.protocol + '//icodecontest-online-api.youdao.com';
  const VERSION = '0.4.36';
  const DRY_RUN = false;      // true = 只算不发
  const BTN_TEXT = '发下一题';  // 两个字的话 antd 会自动插空格，尽量别用两字
  const NEXT_MODE = 'sequence'; // 'sequence' 顺序推进（默认） | 'gap' 只补最早的洞

  /* ================= 工具 ================= */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const norm = (s) => (s || '').replace(/\s+/g, '');

  async function jget(path) {
    const res = await fetch(API + path, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data?.code != null && Number(data.code) !== 0) throw new Error(data.msg || '接口失败');
    return data;
  }
  async function jpost(path, body) {
    const res = await fetch(API + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data?.code != null && Number(data.code) !== 0) throw new Error(data.msg || '接口失败');
    return data;
  }

  function pageCtx() {
    const hash = location.hash || '';
    const m = hash.match(/^#\/class\/(\d+)/);
    if (!m) return null;
    const q = {};
    const qs = hash.split('?')[1];
    if (qs) qs.split('&').forEach((kv) => {
      const i = kv.indexOf('=');
      if (i > 0) q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    return { classId: m[1], sourceType: q.sourceType || 'xbk' };
  }

  /** 拉取题目列表并算出「下一题」 */
  async function loadProblems(ctx, lesson, type) {
    const res = await jget(
      `/api/admin/lesson/getProblemListPublishTypeOfLessonWithClass?lessonId=${lesson.id}&type=${type}&classId=${ctx.classId}`
    );
    const problems = (res?.data || []).slice().sort((a, b) => a.orderNum - b.orderNum);
    if (!problems.length) throw new Error('该课时下没有题目');
    const published = problems.filter((p) => Number(p.publishType) === 1);
    const unpublished = problems.filter((p) => Number(p.publishType) !== 1);
    return { problems, published, unpublished, next: pickNext(published, unpublished) };
  }

  /** 选题：默认顺序推进（已发布最大序号之后的题），没有后续则补最早的洞 */
  function pickNext(published, unpublished) {
    if (!unpublished.length) return null;
    if (NEXT_MODE === 'gap') return unpublished[0];
    const maxPublished = published.reduce((m, p) => Math.max(m, p.orderNum), 0);
    return unpublished.find((p) => p.orderNum > maxPublished) || unpublished[0];
  }

  /** 当前是否在「做题情况」tab */
  function onReportTab() {
    const active = $('.ant-tabs-tab-active');
    return !!active && (active.textContent || '').includes('做题情况');
  }

  /** 读顶部级联选择器：课程 / 课时 / 类型 */
  function readCascader() {
    const el = Array.from(document.querySelectorAll('input[id="lessonCascader"]')).map(e=>e.closest('.ant-cascader-picker')).find(e=>e?.getClientRects().length)?.querySelector('.ant-cascader-picker-label');
    if (!el) return null;
    const parts = (el.textContent || '').split('/').map((s) => s.trim()).filter(Boolean);
    if (parts.length < 3) return null;
    return {
      courseTitle: parts[0],
      lessonTitle: parts[1],
      typeLabel: parts[2],
      type: parts[2].includes('课后作业') ? 2 : 1,
    };
  }

  // 从页面原生 Cascader 已加载选项中解析课时，不使用后台默认课时。
  function selectedNativeLesson(sel) {
    const pickers=Array.from(document.querySelectorAll('input[id="lessonCascader"]')).map(e=>e.closest('.ant-cascader-picker')).filter(e=>e&&e.getClientRects().length);
    if(pickers.length!==1) return null;
    const found=new Map();
    const expected=[sel.courseTitle,sel.lessonTitle,sel.typeLabel];
    for(let el=pickers[0];el&&el!==document.body;el=el.parentElement) {
      const fiberKey=Object.keys(el).find(k=>k.startsWith('__reactFiber$')||k.startsWith('__reactInternalInstance$'));
      let fiber=fiberKey?el[fiberKey]:null;
      for(let depth=0;fiber&&depth<50;depth++,fiber=fiber.return) {
        const props=fiber.memoizedProps;
        if(!Array.isArray(props?.options)) continue;
        const fields=props.fieldNames||{};
        const labelKey=fields.label||'label',valueKey=fields.value||'value',childrenKey=fields.children||'children';
        let level=props.options,lessonNode=null,valid=true;
        for(let i=0;i<expected.length;i++) {
          const matches=level.filter(o=>typeof o?.[labelKey]==='string'&&norm(o[labelKey])===norm(expected[i]));
          if(matches.length!==1){valid=false;break;}
          if(i===1) lessonNode=matches[0];
          level=matches[0][childrenKey]||[];
        }
        if(valid&&lessonNode&&/^\d+$/.test(String(lessonNode[valueKey]))) {
          found.set(String(lessonNode[valueKey]),{id:lessonNode[valueKey],title:sel.lessonTitle});
        }
      }
    }
    return found.size===1?Array.from(found.values())[0]:null;
  }

  /* ================= 核心 ================= */
  async function doPublishNext(ui, allHomework = false) {
    const originalHash = location.hash;
    const ctx = pageCtx();
    if (!ctx) throw new Error('不在班级页面');

    const sel = readCascader();
    if (!sel) throw new Error('读不到顶部筛选（课程/课时/类型），请确认在「做题情况」页');

    ui.busy('查询中…');

    // 1. 课程 + 课时
    const courses = await jget(
      `/api/admin/course/getTuringCoursesByClass?page=1&size=999&classId=${ctx.classId}&sourceType=${ctx.sourceType}&fillLesson=true`
    );
    const matches = (courses?.data?.list || []).filter(c => c.turingCourseTitle === sel.courseTitle);
    if (matches.length !== 1) throw new Error('课程无法唯一匹配，停止发布');
    const course = matches[0];
    if (!course) throw new Error('未找到课程');

    const matchedLessons=(course.lessonList || []).filter(l=>norm(l.title)===norm(sel.lessonTitle));
    const nativeLesson=selectedNativeLesson(sel);
    let lesson=matchedLessons.length===1?matchedLessons[0]:nativeLesson;
    if(nativeLesson&&lesson&&String(nativeLesson.id)!==String(lesson.id)) throw new Error('页面课时ID与课程接口不一致，停止发布');
    if (!lesson) throw new Error('未能从课程接口或页面选项唯一定位课时“'+sel.lessonTitle+'”，停止发布。请提供课程接口返回数据以进一步适配');

    const publishType = allHomework ? 2 : sel.type;
    // 2. 题目列表 + 3. 选「下一题」
    let { problems, published, next } = await loadProblems(ctx, lesson, publishType);
    if (!next) {
      ui.ok('本课时 ' + problems.length + ' 题已全部发布 🎉');
      return;
    }

    // 点击后直接发布；试运行仅展示名称。
    if (DRY_RUN) {
      ui.ok(allHomework ? '🧪 将发布全部课后题，共'+problems.length+'题' : '🧪《' + next.title + '》');
      return;
    }

    // 5. 提交前重新拉一次：接口是全量覆盖，查询期间若别人也发了题，
    //    拿旧集合提交会把别人的题撤下，所以以最新状态为准
    ui.busy('校验中…');
    const fresh = await loadProblems(ctx, lesson, publishType);
    if (!fresh.next) {
      ui.ok('本课时 ' + fresh.problems.length + ' 题已全部发布 🎉');
      return;
    }
    if (!allHomework && String(fresh.next.id) !== String(next.id)) throw new Error('题目状态已变化，请重新点击确认');
    problems = fresh.problems;
    published = fresh.published;
    next = fresh.next;

    // 6. 提交（覆盖语义：最新已发布 ∪ 下一题）
    if (location.hash !== originalHash || !onReportTab() || JSON.stringify(readCascader()) !== JSON.stringify(sel)) throw new Error('页面筛选已变化，请重新操作');
    ui.busy('发布中…');
    const res = await jpost('/api/admin/lesson/publishLessonProblem', {
      lessonId: lesson.id,
      problemIdList: allHomework ? problems.map(p => p.id) : published.map((p) => p.id).concat(next.id),
      type: publishType,
      classId: ctx.classId,
    });
    if (res?.code !== 0) throw new Error('发布失败：' + (res?.msg || JSON.stringify(res)));

    ui.ok(allHomework ? '本节课后题已全部发布（'+problems.length+'题）' : '《' + next.title + '》');

    // 7. 发布成功后点击当前工具栏的原生刷新图标。
    await sleep(600);
    if (location.hash !== originalHash || !onReportTab() || JSON.stringify(readCascader()) !== JSON.stringify(sel)) return;
    const toolbar = findExportButton()?.closest('.ant-pro-table-list-toolbar');
    const reloads = $$('span.anticon-reload[aria-label="reload"]', toolbar || document)
      .filter(el => el.isConnected && el.getClientRects().length > 0);
    if (reloads.length === 1) {
      reloads[0].click();
    } else {
      ui.ok('发题成功，未能唯一定位刷新按钮，请手动刷新');
      console.warn('[iCode 助手] 发题成功，但刷新按钮数量异常：', reloads.length);
    }

  }

  /* ================= UI ================= */
  let publishing = false;
  const UI = {
    btn: null,
    textEl: null,
    timer: null,
    busy(text) {
      if (!this.btn) return;
      clearTimeout(this.timer);
      this.btn.disabled = true;
      this.textEl.textContent = text || '处理中…';
    },
    ok(text) {
      if (!this.btn) return;
      this.textEl.textContent = text;
      this.btn.disabled = false;
      this.flash();
    },
    reset() {
      if (!this.btn) return;
      this.btn.disabled = false;
      this.textEl.textContent = this.defaultText || BTN_TEXT;
    },
    flash() {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.reset(), 6000);
    },
  };

  function findExportButton() {
    return $$('button.ant-btn').find((b) => (b.textContent || '').replace(/\s/g, '') === '导出');
  }

  function mount() {
    if (!pageCtx() || !onReportTab()) return;
    if (document.getElementById('icode-next-problem-btn')) return;

    const exportBtn = findExportButton();
    if (!exportBtn) return;

    const item = exportBtn.closest('.ant-space-item');
    if (!item || !item.parentElement) return;

    const wrap = document.createElement('div');
    wrap.className = 'ant-space-item';
    wrap.style.marginLeft = '8px';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'icode-next-problem-btn';
    // 和「导 出」完全一致的 antd 主按钮样式
    btn.className = 'ant-btn ant-btn-primary';
    btn.title = '发布当前课时（按上面筛选）的下一道题  ·  v' + VERSION;

    const span = document.createElement('span');
    span.textContent = BTN_TEXT;
    btn.appendChild(span);
    wrap.appendChild(btn);
    item.after(wrap);

    UI.btn = btn;
    UI.textEl = span;

    btn.addEventListener('click', async () => {
      if (btn.disabled || publishing || collecting) return;
      if (snapshotting) { window.alert('请等待代码快照完成或取消'); return; }
      publishing = true;
      try {
        await doPublishNext(UI);
      } catch (e) {
        UI.ok('❌ ' + (e.message || e));
      } finally { publishing = false; }
    });
  }


  function mountAllHomework() {
    if(!pageCtx()||!onReportTab()||document.getElementById('icode-all-homework-btn'))return;
    const next=document.getElementById('icode-next-problem-btn');
    const item=next?.closest('.ant-space-item');if(!item)return;
    const wrap=document.createElement('div');wrap.className='ant-space-item';wrap.style.marginLeft='8px';
    const button=document.createElement('button');button.type='button';button.id='icode-all-homework-btn';button.className=next.className;
    button.title='一次发布当前所选课时的全部课后作业题';
    const text=document.createElement('span');text.textContent='发all课后题';button.appendChild(text);wrap.appendChild(button);item.after(wrap);
    const ui=Object.assign(Object.create(UI),{btn:button,textEl:text,timer:null,defaultText:'发all课后题'});
    button.addEventListener('click',async()=>{
      if (publishing || collecting || button.disabled) return;
      if (snapshotting) { window.alert('请等待代码快照完成或取消'); return; }
      publishing=true;
      try{await doPublishNext(ui,true);}catch(error){ui.ok('❌ '+(error.message||error));}finally{publishing=false;}
    });
  }
  setInterval(mountAllHomework,200);

  /* ================= 学生代码快照 ================= */
  // var 声明以便上方自动刷新守卫提前读取，避免 TDZ。
  var snapshotting = false;
  let cancelSnapshot = false;
  const STATUS_TEXT = {
    accepted: '答案正确', ac: '答案正确',
    'wrong answer': '答案错误', wa: '答案错误',
    'compile error': '编译错误', ce: '编译错误', 'compilation error': '编译错误',
    'runtime error': '运行错误', re: '运行错误',
    'time limit exceeded': '运行超时', tle: '运行超时',
  };
  function statusText(status, score) {
    const raw = String(status ?? '').trim();
    const hit = STATUS_TEXT[raw.toLowerCase()];
    if (hit) return hit;
    if (raw.toLowerCase().includes('partial')) return score == null || score === '' ? '部分正确' : '部分正确 ' + score;
    return raw;
  }
  async function fetchStudents(lessonId, type, turingCourseId, ctx, sourceType) {
    const out = [];
    for (let page = 1; page <= 50; page++) {
      const res = await jget(`/api/admin/class/getStudentList?page=${page}&size=200&lessonId=${lessonId}&type=${type}&turingCourseId=${turingCourseId}&classId=${ctx.classId}&sourceType=${sourceType}`);
      const list = res?.data?.list || [];
      out.push(...list);
      if (!list.length || page >= Number(res?.data?.pages || 1)) break;
    }
    return out;
  }
  // 探测只取首页，避免多组合尝试时翻页开销。
  async function probeStudents(lessonId, type, turingCourseId, ctx, sourceType) {
    const res = await jget(`/api/admin/class/getStudentList?page=1&size=200&lessonId=${lessonId}&type=${type}&turingCourseId=${turingCourseId}&classId=${ctx.classId}&sourceType=${sourceType}`);
    return res?.data || {};
  }
  // 参照 Python 脚本：用 URL 末段的 youdaoCourseId 取课时列表，课时 ID 空间可能与班级接口不同。
  async function youdaoCourseLessons(youdaoCourseId, lessonTitle) {
    if (!youdaoCourseId) return [];
    try {
      const res = await jget(`/api/admin/course/getTuringCoursesByYoudaoCourseIdFillLesson?page=1&size=999&youdaoCourseId=${youdaoCourseId}`);
      const out = [];
      for (const c of res?.data?.list || []) {
        const turingCourseId = c.turingCourseId ?? c.id;
        for (const l of c.lessonList || []) {
          if (norm(l.title) !== norm(lessonTitle)) continue;
          out.push({ turingCourseId, lessonId: l.id });
        }
      }
      return out.filter(x => x.turingCourseId != null && x.lessonId != null);
    } catch (error) {
      console.warn('[iCode 助手] 有道课程课时读取失败', error);
      return [];
    }
  }
  function studentProblems(stu) {
    for (const key of ['problems', 'problemList', 'lessonProblems', 'lessonProblemList']) {
      const raw = stu?.[key];
      const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : null;
      if (list?.length) return list;
    }
    return [];
  }
  function studentUserId(stu) {
    return stu.userId ?? stu.studentUserId ?? stu.studentId ?? stu.id ?? stu.uid ?? '';
  }
  // 学生题目条目字段名不统一，统一取出 problemId/类型/名称。
  function readProblem(entry) {
    if (entry == null) return null;
    if (typeof entry !== 'object') return { problemId: entry, problemType: null, title: '' };
    const nested = entry.problem || entry.problemInfo || {};
    const problemId = entry.problemId ?? entry.id ?? nested.id ?? nested.problemId;
    if (problemId == null) return null;
    // problemType：1=选择题 2=编程题 3=填空题；未知类型按编程题处理。
    const rawType = entry.problemType ?? entry.type ?? nested.problemType ?? nested.type;
    const problemType = rawType == null || rawType === '' ? null : Number(rawType);
    if (problemType === 1 || problemType === 3) return null;
    return {
      problemId,
      problemType: entry.lessonProblemType ?? entry.lessonProblemTypeValue ?? problemType,
      title: entry.title ?? nested.title ?? '',
      orderNum: Number(entry.orderNum ?? nested.orderNum ?? NaN),
    };
  }
  // 导出用时间：2026.09.13 18:27（去秒、点号分隔）。
  function exportTime(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/);
    if (!match) return text;
    const [, year, month, day, hour, minute] = match;
    return `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${minute}`;
  }
  // 状态列形如「答案正确 100」；只有答案正确才算通过。
  function verdictOf(statusTextValue) {
    return /^答案正确/.test(statusTextValue) ? '✅ 正确' : '❌ 错误';
  }
  const NO_SUBMISSION = '(无提交记录)';
  // 题目详情接口字段名在不同课时版本间有出入，逐个候选取第一个非空值。
  function pickField(obj, keys) {
    for (const key of keys) {
      const value = obj?.[key];
      if (value != null && value !== '') return value;
    }
    return '';
  }
  // 折叠多余空白、保留段落换行，避免 xlsx 单元格出现大段空格。
  function compactText(value) {
    return String(value ?? '').replace(/\r\n?/g, '\n')
      .split('\n').map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim())
      .filter(Boolean).join('\n');
  }
  // 题目详情：POST /api/course/lesson/problem/detail（接口 8）。
  async function fetchProblemDetail(courseId, lessonId, problemId, lessonProblemType) {
    const base = { courseId: String(courseId), lessonId: String(lessonId), problemId: String(problemId) };
    try {
      const res = await jpost('/api/course/lesson/problem/detail', lessonProblemType == null ? base : { ...base, lessonProblemType });
      return res?.data || null;
    } catch (error) {
      // 个别课时不接受 lessonProblemType，退回不带该字段再试一次。
      if (lessonProblemType == null) throw error;
      const res = await jpost('/api/course/lesson/problem/detail', base);
      return res?.data || null;
    }
  }
  // 与 Python 版 extract_problem_info 一致：题目名称/描述/输入/输出/样例/提示。
  function formatProblemInfo(detail, fallbackTitle) {
    if (!detail) return '';
    const lines = [];
    const title = compactText(pickField(detail, ['title', 'problemTitle', 'name'])) || compactText(fallbackTitle);
    if (title) lines.push('题目名称：' + title);
    const desc = compactText(pickField(detail, ['description', 'problemDescription', 'content', 'desc']));
    if (desc) lines.push('题目描述：\n' + desc);
    const input = compactText(pickField(detail, ['inputDescription', 'inputDesc', 'input']));
    if (input) lines.push('输入描述：\n' + input);
    const output = compactText(pickField(detail, ['outputDescription', 'outputDesc', 'output']));
    if (output) lines.push('输出描述：\n' + output);
    const rawSamples = pickField(detail, ['samples', 'sampleList', 'exampleList', 'examples']);
    const samples = Array.isArray(rawSamples) ? rawSamples : [];
    samples.forEach((sample, index) => {
      if (typeof sample === 'string' || typeof sample === 'number') {
        const text = compactText(sample);
        if (text) lines.push('样例' + (index + 1) + '：' + text);
        return;
      }
      const sin = compactText(pickField(sample, ['inputSample', 'input', 'in', 'sampleInput']));
      const sout = compactText(pickField(sample, ['outputSample', 'output', 'out', 'sampleOutput']));
      const parts = [];
      if (sin) parts.push('输入：' + sin);
      if (sout) parts.push('输出：' + sout);
      if (parts.length) lines.push('样例' + (index + 1) + '：' + parts.join('；'));
    });
    const hint = compactText(pickField(detail, ['hint', 'tips', 'prompt']));
    if (hint) lines.push('提示：\n' + hint);
    return lines.join('\n\n');
  }
  async function mapLimit(items, limit, fn) {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await fn(items[index], index);
      }
    });
    await Promise.all(workers);
  }
  // 宽表：第1行表头，第2行题目信息，第3行起每名学生一行，每关四列（代码 / 是否正确 / 提交时间 / 状态）。
  function buildWideRows(students, levelIds, results, problemInfo) {
    const header = ['学生姓名', '学生昵称'];
    for (let i = 1; i <= levelIds.length; i++) {
      header.push(`第${i}关代码`, `第${i}关是否正确`, `第${i}关提交时间`, `第${i}关状态`);
    }
    const rows = [header];
    if (problemInfo && problemInfo.size) {
      const infoLine = ['题目信息', ''];
      for (const levelId of levelIds) infoLine.push(problemInfo.get(String(levelId)) || '', '', '', '');
      rows.push(infoLine);
    }
    for (const row of students) {
      const line = [row.name, row.nickname];
      for (const levelId of levelIds) {
        const hit = results.get(row.userId + '|' + levelId);
        if (!hit || !hit.latest) {
          line.push(NO_SUBMISSION, '❌ 错误', '无', hit?.note ? '读取失败' : '未提交');
          continue;
        }
        line.push(hit.latest.code || '', verdictOf(hit.status), exportTime(hit.latest.submitTime), hit.status);
      }
      rows.push(line);
    }
    return rows;
  }
  async function fetchSubmissions(courseId, lessonId, problemId, lessonProblemType, studentUserId) {
    const out = [];
    for (let page = 1; page <= 100; page++) {
      // 与 Python 脚本一致：data= 走 JSON body，form 编码会被服务端 415。
      const res = await jpost('/api/course/lesson/problem/mySubmission', {
        page, size: 100, courseId: String(courseId), lessonId: String(lessonId),
        problemId: String(problemId), lessonProblemType, studentUserId: String(studentUserId),
      });
      const data = res?.data;
      if (!data) break;
      out.push(...(data.list || []));
      if (page >= Number(data.pages || 1)) break;
    }
    return out;
  }
  function latestSubmission(list) {
    let best = null;
    for (const sub of list) {
      const time = Date.parse(String(sub.submitTime || '').replace(/-/g, '/')) || 0;
      if (!best || time >= best.time) best = { time, sub };
    }
    return best?.sub || null;
  }
  async function collectSnapshot(ui) {
    if (snapshotting) return;
    snapshotting = true; cancelSnapshot = false;
    try { await runSnapshot(ui); }
    finally { snapshotting = false; }
  }
  async function runSnapshot(ui) {
    const ctx = pageCtx();
    if (!ctx) throw new Error('不在班级页面');
    const sel = readCascader();
    if (!sel) throw new Error('读不到顶部筛选（课程/课时/类型），请确认在「做题情况」页');
    ui.busy('查询学生…');
    const courses = await jget(`/api/admin/course/getTuringCoursesByClass?page=1&size=999&classId=${ctx.classId}&sourceType=${ctx.sourceType}&fillLesson=true`);
    const course = (courses?.data?.list || []).find(c => c.turingCourseTitle === sel.courseTitle);
    if (!course) throw new Error('未找到课程「' + sel.courseTitle + '」');
    const lesson = (course.lessonList || []).find(l => norm(l.title) === norm(sel.lessonTitle));
    if (!lesson) throw new Error('未找到课时「' + sel.lessonTitle + '」');
    // 课程 ID / 课时 ID / sourceType 随接口版本不同，探测出学生带题目最多的组合。
    const urlCourseId = (location.hash.match(/^#\/class\/\d+\/(\d+)/) || [])[1];
    const lessonCandidates = [];
    const pushCandidate = (turingCourseId, lessonId) => {
      if (turingCourseId == null || lessonId == null) return;
      const key = turingCourseId + ':' + lessonId;
      if (!lessonCandidates.some(x => x.key === key)) lessonCandidates.push({ key, turingCourseId, lessonId });
    };
    pushCandidate(course.turingCourseId ?? course.id, lesson.id);
    pushCandidate(course.id, lesson.id);
    pushCandidate(urlCourseId, lesson.id);
    for (const extra of await youdaoCourseLessons(urlCourseId, sel.lessonTitle)) {
      pushCandidate(extra.turingCourseId, extra.lessonId);
    }
    // sourceType 只影响班级维度的过滤，探测结果里带上有效值。
    const sourceTypes = [ctx.sourceType, 'group', 'xbk'].filter((v, i, arr) => v && arr.indexOf(v) === i);
    let bestScore = -1, picked = null, pickedData = null, students = [];
    const probeLog = [];
    for (const candidate of lessonCandidates) {
      for (const source of sourceTypes) {
        let data = {};
        try { data = await probeStudents(candidate.lessonId, sel.type, candidate.turingCourseId, ctx, source); }
        catch (error) { probeLog.push(candidate.key + '/' + source + ' 请求失败：' + error.message); continue; }
        const list = data.list || [];
        const score = list.reduce((sum, stu) => sum + studentProblems(stu).length, 0);
        probeLog.push(candidate.key + '/' + source + ' ' + list.length + '人 ' + score + '题');
        console.info('[iCode 助手] 探测', candidate.key, source, list.length, '人', score, '题目');
        if (score > bestScore) { bestScore = score; picked = { ...candidate, source }; pickedData = data; students = list; }
        if (score > 0) break;
      }
      if (bestScore > 0) break;
    }
    if (!picked || !students.length) throw new Error('该课时下没有学生（探测：' + probeLog.join('；') + '）');
    const { turingCourseId, lessonId, source: sourceType } = picked;
    if (Number(pickedData?.total || 0) > students.length && Number(pickedData?.pages || 1) > 1) {
      const full = await fetchStudents(lessonId, sel.type, turingCourseId, ctx, sourceType);
      if (full.length > students.length) students = full;
    }
    const titles = new Map();
    let lessonProblems = [];
    try {
      const { problems, published } = await loadProblems(ctx, { id: lessonId }, sel.type);
      // 学生数据缺题目字段时用它兜底；优先已发布，未发布则用全部题目。
      const source = published?.length ? published : problems;
      lessonProblems = source
        .map(p => ({ problemId: p.id, problemType: Number(p.problemType), title: p.title || '', orderNum: Number(p.orderNum) }))
        // problemType 未知时保留，只剔除明确的选择题/填空题。
        .filter(p => p.problemId != null && p.problemType !== 1 && p.problemType !== 3);
      for (const p of lessonProblems) titles.set(String(p.problemId), p.title);
    } catch (error) { console.warn('[iCode 助手] 题目列表读取失败', error); }
    const tasks = [];
    const studentRows = [];
    for (const stu of students) {
      const userId = studentUserId(stu);
      if (!userId) continue;
      const name = stu.noteName || stu.userNickName || String(userId);
      const nickname = stu.userNickName || '';
      studentRows.push({ userId, name, nickname });
      for (const entry of studentProblems(stu)) {
        const prob = readProblem(entry);
        if (!prob) continue;
        if (prob.title && !titles.get(String(prob.problemId))) titles.set(String(prob.problemId), prob.title);
        tasks.push({ userId, name, problemId: prob.problemId, problemType: prob.problemType || sel.type, orderNum: prob.orderNum });
      }
    }
    // 学生列表不带题目信息时，退回用课时题目 × 全部学生。
    if (!tasks.length) {
      console.warn('[iCode 助手] 学生数据缺少题目字段，改用课时题目组合', students[0]);
      for (const stu of students) {
        const userId = studentUserId(stu);
        if (!userId) continue;
        const name = stu.noteName || stu.userNickName || String(userId);
        if (!studentRows.some(row => row.userId === userId)) studentRows.push({ userId, name, nickname: stu.userNickName || '' });
        for (const prob of lessonProblems) {
          tasks.push({ userId, name, problemId: prob.problemId, problemType: sel.type, orderNum: prob.orderNum });
        }
      }
    }
    if (!tasks.length) {
      // 定位不到题目时把接口原始结构暴露出来，便于适配字段。
      console.warn('[iCode 助手] 未取到编程题。学生样本：', students[0]);
      console.warn('[iCode 助手] 课时题目样本：', lessonProblems[0]);
      console.warn('[iCode 助手] 探测记录：', probeLog);
      ui.reset();
      window.alert('该课时下没有可取的编程题。\n\n探测：' + probeLog.join('\n') +
        '\n\n学生字段：' + Object.keys(students[0] || {}).join(', ') +
        '\n学生题目数：' + studentProblems(students[0] || {}).length +
        '\n课时题目数：' + lessonProblems.length +
        '\n\n已把接口原始数据打印到控制台（Console），可据此适配字段。');
      return;
    }
    if (!window.confirm('即将通过接口读取 '+sel.courseTitle+' / '+sel.lessonTitle+' / '+sel.typeLabel+' 下 '+students.length+' 名学生、'+tasks.length+' 份题目作答（每人取最新一次提交），并附上每关题目信息。\n\n采集期间请勿切换当前页面的班级、标签或筛选。\n可以正常使用其他浏览器标签页。\n\n再次点击按钮可取消并导出已取到的结果。\n\n是否开始？')) { ui.reset(); return; }
    const hash = location.hash;
    // 关卡列顺序：优先题目序号，缺序号时按首次出现顺序。
    const levelIds = [];
    for (const task of tasks) {
      const key = String(task.problemId);
      if (!levelIds.includes(key)) levelIds.push(key);
    }
    levelIds.sort((a, b) => {
      const orderA = tasks.find(t => String(t.problemId) === a)?.orderNum;
      const orderB = tasks.find(t => String(t.problemId) === b)?.orderNum;
      const hasA = Number.isFinite(orderA), hasB = Number.isFinite(orderB);
      if (hasA && hasB) return orderA - orderB;
      if (hasA !== hasB) return hasA ? -1 : 1;
      return levelIds.indexOf(a) - levelIds.indexOf(b);
    });
    // 第二行题目信息：逐题调用详情接口，失败时退回题目列表里的标题。
    ui.busy('读取题目信息…');
    const problemInfo = new Map();
    const detailTasks = levelIds.map((levelId) => {
      const task = tasks.find(t => String(t.problemId) === levelId);
      return { levelId, problemId: levelId, problemType: task?.problemType ?? sel.type, title: titles.get(String(levelId)) || task?.title || '' };
    });
    await mapLimit(detailTasks, 6, async (item) => {
      try {
        const text = formatProblemInfo(await fetchProblemDetail(turingCourseId, lessonId, item.problemId, item.problemType), item.title);
        problemInfo.set(String(item.levelId), text || item.title || '');
      } catch (error) {
        console.warn('[iCode 助手] 题目详情读取失败', item.problemId, error);
        problemInfo.set(String(item.levelId), (item.title ? '题目名称：' + item.title + '\n\n' : '') + '(题目详情读取失败：' + (error.message || error) + ')');
      }
    });
    const results = new Map();
    let completed = 0, failure = '';
    const check = () => {
      if (cancelSnapshot) throw new Error('已取消');
      if (location.hash !== hash) throw new Error('页面地址已变化，停止采集');
    };
    try {
      await collectScoreBatch(tasks, async task => {
        check();
        let latest = null, note = '';
        try {
          latest = latestSubmission(await fetchSubmissions(turingCourseId, lessonId, task.problemId, task.problemType, task.userId));
        } catch (error) { note = error.message; }
        check(); completed++;
        ui.busy('取消快照（已取 ' + completed + '/' + tasks.length + '）');
        const status = latest ? statusText(latest.status, latest.score) : '';
        results.set(task.userId + '|' + task.problemId, { latest, status, note });
        return null;
      }, () => {}, check);
    } catch (error) { failure = error.message; }
    finally {
      const rows = studentRows.length && results.size ? buildWideRows(studentRows, levelIds, results, problemInfo) : [];
      if (rows.length) {
        const widths = [18, 18];
        for (let i = 0; i < levelIds.length; i++) widths.push(90, 12, 20, 16);
        downloadXlsx(rows, '学生代码快照', widths);
      }
      ui.ok(failure ? '❌ ' + failure : '已导出 ' + studentRows.length + ' 名学生');
      window.alert(failure
        ? '快照未完整完成：' + failure + '。已取 ' + completed + '/' + tasks.length + ' 份作答；有结果时已导出。'
        : '快照完成，已导出 ' + studentRows.length + ' 名学生 × ' + levelIds.length + ' 关（第2行为题目信息）。');
    }
  }
  function mountSnapshot() {
    if (!pageCtx() || !onReportTab() || document.getElementById('icode-snapshot-btn')) return;
    const all = document.getElementById('icode-all-homework-btn');
    const item = all?.closest('.ant-space-item');
    if (!item) return;
    const wrap = document.createElement('div'); wrap.className = 'ant-space-item'; wrap.style.marginLeft = '8px';
    const button = document.createElement('button'); button.type = 'button'; button.id = 'icode-snapshot-btn'; button.className = all.className;
    button.title = '通过接口取当前课时下所有同学此刻的最新代码（导出 xlsx）';
    const text = document.createElement('span'); text.textContent = '代码快照';
    button.appendChild(text); wrap.appendChild(button); item.after(wrap);
    // 快照期间保持可点击，以便再次点击取消。
    const ui = {
      timer: null,
      busy(value) { text.textContent = value || '处理中…'; },
      ok(value) { text.textContent = value; clearTimeout(ui.timer); ui.timer = setTimeout(() => { ui.reset(); }, 6000); },
      reset() { clearTimeout(ui.timer); text.textContent = '代码快照'; },
    };
    button.addEventListener('click', async () => {
      if (snapshotting) { cancelSnapshot = true; text.textContent = '正在取消…'; return; }
      if (publishing || collecting) return;
      try { await collectSnapshot(ui); } catch (error) { ui.ok('❌ ' + (error.message || error)); }
    });
  }
  setInterval(mountSnapshot, 200);

  /* 使用网页原生列设置拖拽，不移动表格 DOM。 */
  const attempted = new WeakSet();
  let arranging = false;
  const listSelector = '.ant-pro-table-column-setting-list';
  const titleSelector = '.ant-pro-table-column-setting-list-item-title';
  const items = list => $$(titleSelector, list);
  const label = el => norm(el.textContent).toLowerCase();
  const visible = el => el.isConnected && el.getClientRects().length > 0;
  // 隐藏标签页里 rAF 可能不触发，加计时器兜底，避免拖拽流程卡死。
  const nextFrame = () => new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(finish);
    setTimeout(finish, 50);
  });

  // 表头已经是「学生昵称 → 有道id」且后面没有其它可配置列时，完全不用再打开列设置。
  function columnsLookArranged() {
    try {
      const headers = scoreTableHeaders(currentTable());
      const nick = headers.indexOf('学生昵称');
      const id = headers.indexOf('有道id');
      if (nick < 0 || id !== nick + 1) return false;
      return headers.slice(id + 1).every(text => !text || /操作|action/.test(text));
    } catch (_) { return false; }
  }

  // 列设置弹层动画结束（条目数量与位置稳定）再拖拽，通常 100~200ms 就够。
  async function waitSettingsSettled(timeout = 800) {
    const deadline = Date.now() + timeout;
    let signature = '';
    while (Date.now() < deadline) {
      const list = $$(listSelector).filter(visible)[0];
      if (list && items(list).length) {
        const rect = list.getBoundingClientRect();
        const next = [rect.top, rect.left, rect.width, rect.height, items(list).length].join(',');
        if (next === signature) return true;
        signature = next;
      }
      await sleep(50);
    }
    return $$(listSelector).some(visible);
  }

  async function moveToEnd(list, name, fast) {
    const titles = items(list);
    const sourceTitle = titles.find(el => label(el) === name);
    const lastTitle = titles[titles.length - 1];
    if (!sourceTitle || !lastTitle) throw new Error('列设置条目不完整');
    if (sourceTitle === lastTitle) return;
    const source = sourceTitle.closest('[draggable="true"]');
    const target = lastTitle.closest('[draggable="true"]');
    if (!source || !target) throw new Error('未找到原生拖拽节点');
    const transfer = new DataTransfer();
    transfer.setData('text/plain', name);
    transfer.effectAllowed = 'move';
    const fire = (node, type, x, y) => node.dispatchEvent(new DragEvent(type, {
      bubbles: true, cancelable: true, dataTransfer: transfer,
      clientX: x, clientY: y,
    }));
    const from = source.getBoundingClientRect();
    fire(source, 'dragstart', from.left + from.width / 2, from.top + from.height / 2);
    try {
      target.scrollIntoView({ block: 'nearest' });
      const to = target.getBoundingClientRect();
      const x = to.left + to.width / 2, y = to.bottom - 1;
      fire(target, 'dragenter', x, y);
      fire(target, 'dragover', x, y);
      // 快速模式只等一帧，慢速模式保留原来的 150ms。
      if (fast) await nextFrame();
      else await sleep(150);
      if (!visible(list) || !onReportTab()) throw new Error('列设置已关闭');
      fire(target, 'drop', x, y);
    } finally { fire(source, 'dragend', from.left, from.top); }
    const deadline = Date.now() + (fast ? 400 : 8000);
    while (Date.now() < deadline) {
      if (fast) await nextFrame();
      else await sleep(100);
      const updated = items(list);
      if (updated.length && label(updated[updated.length - 1]) === name) return;
    }
    throw new Error('网页未接受模拟拖拽，请手动调整列顺序');
  }

  let columnReadyState = null;
  function columnsTableReady() {
    let table;
    try { table=currentTable(); } catch (_) { columnReadyState=null; return false; }
    const scope=table.closest('.ant-pro-table')||table.closest('.ant-table-wrapper')||table;
    const loading=Array.from(scope.querySelectorAll('.ant-spin-spinning, [aria-busy="true"]')).some(visible);
    const rows=scoreRows(table);
    const headers=Array.from(scope.querySelectorAll('thead tr')).filter(visible);
    if(loading||!rows.length||!headers.length) {columnReadyState=null;return false;}
    const cells=Array.from(headers[headers.length-1].children);
    if(!cells.length||!rows.some(row=>row.querySelectorAll('td').length===cells.length)) {columnReadyState=null;return false;}
    const picker=Array.from(document.querySelectorAll('.ant-cascader-picker-label')).filter(visible).map(e=>e.textContent).join('|');
    const signature=location.hash+'|'+picker+'|'+cells.map(c=>norm(c.textContent)).join('|')+'|'+rows.map(scoreRowSignature).join('|');
    if(!columnReadyState||columnReadyState.table!==table||columnReadyState.signature!==signature) {
      columnReadyState={table,signature,since:Date.now()};
      return false;
    }
    return Date.now()-columnReadyState.since>=400;
  }

  async function arrangeNativeColumns() {
    if (collecting || arranging || !pageCtx() || !onReportTab()) return;
    if (!openingSettings && !columnsTableReady()) return;
    const lists = $$(listSelector).filter(visible);
    if (lists.length !== 1) return;
    const list = lists[0];
    if (attempted.has(list)) return;
    const names = items(list).map(label);
    if (names[1] !== '有道id' || names[2] !== '学生昵称') return;
    if (names.filter(n => n === '有道id').length !== 1 || names.filter(n => n === '学生昵称').length !== 1) return;
    attempted.add(list);
    arranging = true;
    const startHash=location.hash;
    try {
      for(let attempt=1;attempt<=5;attempt++) {
        if(collecting || location.hash!==startHash || !onReportTab() || !visible(list)) return;
        try {
          // 第 1 次用无等待的快速拖拽，失败后回到原来的保守节奏。
          const fast = attempt === 1;
          // 重试时继续处理可能已经移动了一列的状态。
          await moveToEnd(list, '学生昵称', fast);
          await moveToEnd(list, '有道id', fast);
          const result=items(list).map(label);
          if(result.slice(-2).join('|')!=='学生昵称|有道id') throw new Error('列顺序校验失败');
          console.info('[iCode 助手] 原生列调整成功，第 '+attempt+' 次尝试');
          return;
        } catch(error) {
          console.warn('[iCode 助手] 列调整第 '+attempt+'/5 次失败：',error.message);
          if(attempt===5) UI.ok('列调整失败（已尝试5次）：'+error.message);
          else await sleep(400);
        }
      }
    } finally { arranging=false; }
  }

  let openingSettings = false;
  const openedTables = new WeakMap();
  async function ensureNativeSettings() {
    if (collecting || openingSettings || arranging || !pageCtx() || !onReportTab()) return;
    if (!columnsTableReady()) return;
    if ($$(listSelector).some(visible)) { await arrangeNativeColumns(); return; }
    // 表头顺序已正确时直接跳过，避免每次进页都弹一下列设置。
    if (columnsLookArranged()) return;
    const exportBtn = findExportButton();
    // 工具栏和表格不一定处于同一个 ant-table-wrapper 中。
    const toolbar = exportBtn?.closest('.ant-pro-table-list-toolbar');
    let triggers = $$('.ant-pro-table-list-toolbar-setting-item > span.anticon-setting[aria-label="setting"]', toolbar || document).filter(visible);
    if (triggers.length !== 1) return;
    const trigger = triggers[0];
    const scope = trigger;
    const key = location.hash;
    const previous = openedTables.get(scope);
    if (previous?.key === key && (previous.done || previous.count >= 5 || Date.now() - previous.time < 400)) return;
    const attempt = { key, count: previous?.key === key ? previous.count + 1 : 1, time: Date.now(), done: false };
    openedTables.set(scope, attempt);
    openingSettings = true;
    let opened = false;
    try {
      trigger.click();
      for (let i = 0; i < 60; i++) {
        await sleep(50);
        if (location.hash !== key || !onReportTab()) return;
        if ($$(listSelector).some(visible)) { opened = true; break; }
      }
      if (!opened) { UI.ok('列设置未打开：请手动点击齿轮'); console.warn('[iCode 助手] 列设置未打开'); return; }
      attempt.done = true;
      // 等弹层动画稳定再拖拽，比固定 sleep(500) 快一截。
      await waitSettingsSettled();
      await arrangeNativeColumns();
    } finally {
      // 仅收起本次由脚本打开的面板。
      if (opened && trigger.isConnected && location.hash === key && $$(listSelector).some(visible)) trigger.click();
      openingSettings = false;
    }
  }

  const completionSortState=new WeakMap();
  function completionNumber(cell) {
    const match=(cell?.textContent||'').replace(/\s/g,'').match(/^(\d+(?:\.\d+)?)%$/);
    return match?Number(match[1]):null;
  }
  function submissionTime(cell) {
    const text=(cell?.textContent||'').trim();
    const match=text.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if(!match)return null;
    const [,year,month,day,hour,minute,second='0']=match;
    const value=new Date(+year,+month-1,+day,+hour,+minute,+second).getTime();
    return Number.isFinite(value)?value:null;
  }
  function mountCompletionSort() {
    if(collecting||!pageCtx()||!onReportTab()) return;
    let table;try{table=currentTable();}catch(_){return;}
    const scope=table.closest('.ant-table-wrapper')||table.closest('.ant-table')||table;
    const headers=Array.from(scope.querySelectorAll('thead th')).filter(th=>visible(th)&&norm(th.querySelector('.ant-pro-core-label-tip-title')?.textContent||th.childNodes[0]?.textContent)&&['得分率','最近提交时间'].includes(norm(th.querySelector('.ant-pro-core-label-tip-title')?.textContent||th.childNodes[0]?.textContent)));
    if(!headers.length) return;
    // 已提供原生排序时保持原生交互。
    if(headers.some(th=>th.classList.contains('ant-table-column-has-sorters')||th.querySelector('.ant-table-column-sorters'))) return;
    let state=completionSortState.get(scope);
    if(!state){state={column:'得分率',direction:null,originalRows:[],originalKeys:[]};completionSortState.set(scope,state);}
    for(const th of headers) {
      const column=norm(th.querySelector('.ant-pro-core-label-tip-title')?.textContent||th.childNodes[0]?.textContent);
      const direction=state.column===column?state.direction:null;
      let button=th.querySelector('[data-icode-completion-sort]');
      if(!button){
        button=document.createElement('button');button.type='button';button.dataset.icodeCompletionSort='';
        button.style.cssText='border:0;background:transparent;padding:0 3px;margin-left:4px;cursor:pointer;vertical-align:middle;line-height:1;color:#8c8c8c';
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 16 20');svg.setAttribute('width','12');svg.setAttribute('height','16');svg.setAttribute('aria-hidden','true');
        for(const [name,d] of [['up','M8 2L14 8H2Z'],['down','M8 18L2 12H14Z']]){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);path.dataset.direction=name;svg.appendChild(path);}
        button.appendChild(svg);
        button.addEventListener('click',event=>{event.stopPropagation();if(collecting)return;state.direction=state.column!==column?'desc':state.direction===null?'desc':state.direction==='desc'?'asc':null;state.column=column;mountCompletionSort();});
        th.appendChild(button);
      }
      button.title='当前页'+column+'排序'+(column==='得分率'?'（相同则按完成率）':'')+'：'+(direction==='desc'?'降序（点击升序）':direction==='asc'?'升序（点击恢复默认）':'点击降序');
      button.setAttribute('aria-label',button.title);
      th.setAttribute('aria-sort',direction==='desc'?'descending':direction==='asc'?'ascending':'none');
      for(const path of button.querySelectorAll('path')) path.setAttribute('fill',path.dataset.direction===(direction==='asc'?'up':direction==='desc'?'down':'')?'#1890ff':'#bfbfbf');
    }
    const selected=headers.filter(th=>norm(th.querySelector('.ant-pro-core-label-tip-title')?.textContent||th.childNodes[0]?.textContent)===state.column);
    const mainHeader=selected.find(th=>!th.closest('.ant-table-fixed-left, .ant-table-fixed-right'))||selected[0];
    if(!mainHeader)return;
    const headerCells=Array.from(mainHeader.parentElement.children);
    const index=headerCells.indexOf(mainHeader);
    const completionIndex=headerCells.findIndex(th=>norm(th.querySelector('.ant-pro-core-label-tip-title')?.textContent||th.childNodes[0]?.textContent)==='完成率');
    const nicknameIndex=headerCells.findIndex(th=>['学生昵称','学员昵称'].includes(norm(th.textContent)));
    const rows=scoreRows(table), parent=rows[0]?.parentElement;
    if(!parent||rows.some(row=>row.parentElement!==parent||row.querySelector('td[colspan]'))) return;
    const keys=rows.map(row=>row.dataset.rowKey||'');
    const sameSet=state.originalRows.length===rows.length&&rows.every(row=>state.originalRows.includes(row));
    if(!sameSet) {
      const sameKeys=keys.every(Boolean)&&state.originalKeys.length===keys.length&&keys.every(key=>state.originalKeys.includes(key));
      state.originalRows=sameKeys?state.originalKeys.map(key=>rows.find(row=>row.dataset.rowKey===key)):rows.slice();
      state.originalKeys=state.originalRows.map(row=>row.dataset.rowKey||'');
    }
    const original=state.originalRows;
    const sorted=original.slice();
    if(state.direction) {
      if(nicknameIndex<0) return;
      const eligible=original.map((row,i)=>({row,i,value:state.column==='最近提交时间'?submissionTime(row.children[index]):completionNumber(row.children[index]),completion:completionNumber(row.children[completionIndex])}))
        .filter(item=>!item.row.children[nicknameIndex]?.textContent.includes('已退组'));
      const slots=eligible.map(item=>item.i);
      eligible.sort((a,b)=>{
        if(a.value===null) return b.value===null?a.i-b.i:1;
        if(b.value===null) return -1;
        const primary=state.direction==='desc'?b.value-a.value:a.value-b.value;
        if(primary)return primary;
        if(state.column==='最近提交时间')return a.i-b.i;
        if(a.completion===null)return b.completion===null?a.i-b.i:1;
        if(b.completion===null)return -1;
        return (state.direction==='desc'?b.completion-a.completion:a.completion-b.completion)||a.i-b.i;
      });
      slots.forEach((slot,i)=>{sorted[slot]=eligible[i].row;});
    }
    if(sorted.some((row,i)=>row!==rows[i])) for(const row of sorted) parent.appendChild(row);
    // 同步旧版 antd 固定列副本，以行 key 对齐。
    const rank=new Map(sorted.map((row,i)=>[row.dataset.rowKey,i]).filter(([key])=>key));
    for(const body of scope.querySelectorAll('.ant-table-fixed-left tbody, .ant-table-fixed-right tbody')) {
      const fixed=Array.from(body.children).filter(row=>rank.has(row.dataset.rowKey));
      const ordered=fixed.slice().sort((a,b)=>rank.get(a.dataset.rowKey)-rank.get(b.dataset.rowKey));
      if(ordered.some((row,i)=>row!==fixed[i])) ordered.forEach(row=>body.appendChild(row));
    }
  }
  setInterval(mountCompletionSort,500);

  mount();
  setInterval(() => { mount(); ensureNativeSettings(); }, 200);
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled || arranging) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; ensureNativeSettings(); }, 250);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  console.info('[iCode 助手] v' + VERSION + ' 已加载；自动打开列设置并调整');
})();
