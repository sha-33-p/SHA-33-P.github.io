/**
 * 大麦抢票助手 - 前端逻辑（手机本地运行）
 * 作者：songshan.li (ID: 17099618)
 *
 * 说明：
 *  - 纯前端，无任何后端，所有数据存于本机 localStorage（密码用 Web Crypto 加密）。
 *  - 自动化范围：倒计时到点→自动打开大麦购票页→自动点击「立即购买/选场次/选票档/提交订单」
 *    →（可选）自动点「去支付」跳支付宝。支付动作需用户本人完成。
 *  - 由于浏览器安全限制，脚本无法真正"读写"大麦原生 App 的内部 DOM；
 *    本工具通过「在新标签页打开大麦 H5 页 + 模拟点击」实现辅助。
 *    原生 App 内的精确自动点击需在安卓端配合 Auto.js / 无障碍服务（见 README）。
 */

const $ = (id) => document.getElementById(id);

// ---------- 日志 ----------
function log(msg, level = 'info') {
  const box = $('log');
  const line = document.createElement('div');
  line.className = `log-line ${level}`;
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  line.textContent = `[${t}] ${msg}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}
function setStage(s) { $('stage').firstChild.textContent = `状态：${s} `; }

// ---------- 本地加密存储 ----------
const enc = {
  // 用设备固定盐 + 口令派生密钥（简化版，仅防明文泄露）
  async deriveKey(pass) {
    const enc = new TextEncoder();
    const keyMat = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode('damai-grab-salt'), iterations: 100000, hash: 'SHA-256' },
      keyMat, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  },
  async encrypt(text, pass) {
    const key = await this.deriveKey(pass);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
    return btoa(String.fromCharCode(...iv) + '|' + btoa(String.fromCharCode(...new Uint8Array(ct))));
  },
  async decrypt(blob, pass) {
    try {
      const [ivB64, ctB64] = blob.split('|');
      const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
      const ct = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));
      const key = await this.deriveKey(pass);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      return new TextDecoder().decode(pt);
    } catch { return ''; }
  }
};

const STORE_KEY = 'damai_grab_cfg_v1';
function saveConfig() {
  const cfg = {
    username: $('username').value,
    showUrl: $('showUrl').value,
    session: $('session').value,
    priceTier: $('priceTier').value,
    quantity: $('quantity').value,
    recipient: $('recipient').value,
    saleTime: $('saleTime').value,
    autoPay: $('autoPay').checked,
    payMethod: $('payMethod').value,
    saveAcc: $('saveAcc').checked,
    sessions: [...$('session').options].map(o => o.value).filter(Boolean),
    tiers: [...$('priceTier').options].map(o => o.value).filter(Boolean),
  };
  if (cfg.saveAcc && $('password').value) {
    // 用账号作为加密口令，本地保存密文
    enc.encrypt($('password').value, cfg.username || 'default').then(ct => {
      cfg.passwordEnc = ct;
      localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
      log('success', '配置已加密保存到本机');
    });
  } else {
    delete cfg.passwordEnc;
    localStorage.setItem(STORE_KEY, JSON.stringify(cfg));
    log('success', '配置已保存到本机');
  }
}

function loadConfig() {
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return;
  try {
    const cfg = JSON.parse(raw);
    $('username').value = cfg.username || '';
    $('showUrl').value = cfg.showUrl || '';
    $('session').value = cfg.session || '';
    $('priceTier').value = cfg.priceTier || '';
    $('quantity').value = cfg.quantity || 1;
    $('recipient').value = cfg.recipient || '';
    $('saleTime').value = cfg.saleTime || '';
    $('autoPay').checked = cfg.autoPay !== false;
    $('payMethod').value = cfg.payMethod || '';
    $('saveAcc').checked = cfg.saveAcc !== false;
    fillSelect('session', cfg.sessions || [], '场次');
    fillSelect('priceTier', cfg.tiers || [], '票档');
    $('session').value = cfg.session || '';
    $('priceTier').value = cfg.priceTier || '';
    $('autoPayPill').textContent = cfg.autoPay ? '去支付:开' : '去支付:关';
    $('autoPayPill').className = 'pill' + (cfg.autoPay ? ' on' : '');
  } catch (e) { log('error', '读取配置失败'); }
}

// ---------- 倒计时 ----------
let timer = null;
function startCountdown(targetTs) {
  clearInterval(timer);
  timer = setInterval(() => {
    const left = targetTs - Date.now();
    if (left <= 0) {
      $('countdown').textContent = '00:00:00';
      clearInterval(timer);
      return;
    }
    const h = String(Math.floor(left / 3600000)).padStart(2, '0');
    const m = String(Math.floor((left % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
    $('countdown').textContent = `${h}:${m}:${s}`;
  }, 250);
}

// ---------- 自动点击（在打开的购票页内模拟） ----------
// 通过注入脚本在新标签页执行点击；大麦 H5 页面元素会动态加载，这里用关键词+选择器兜底
function autoClickInTab(win, keywords, desc, opts = {}) {
  return new Promise((resolve) => {
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      // 支付方式等可能是 button/a，也可能是 li/label/div（带图标）
      const sel = opts.wide
        ? 'button, a, li, label, [class*="pay"], [class*="channel"], [class*="method"], [role="radio"]'
        : 'button, [class*="btn"], [class*="buy"], [class*="submit"], a';
      const nodes = win.document.querySelectorAll(sel);
      let hit = null;
      nodes.forEach(el => {
        const txt = (el.innerText || el.textContent || el.title || el.getAttribute('aria-label') || '').trim();
        if (keywords.some(k => txt.includes(k))) hit = el;
      });
      if (hit) {
        clearInterval(iv);
        log('step', `点击：${desc}（${hit.innerText || hit.title || hit.getAttribute('aria-label')}）`);
        hit.click();
        setTimeout(resolve, 800);
      } else if (tries > (opts.tries || 20)) {
        clearInterval(iv);
        log('warn', `未找到「${desc}」，${opts.manual || '可能需手动操作'}`);
        resolve();
      }
    }, 400);
  });
}

/**
 * 在订单确认页选择指定支付工具（支付宝/微信/银行卡/花呗等）
 * 大麦订单页支付方式多为可点击的列表项，按文本匹配点击
 */
async function selectPayMethod(win, method) {
  if (!method) return;
  log('info', `调整支付工具为：${method}`);
  await autoClickInTab(win, [method], `支付工具(${method})`, {
    wide: true,
    tries: 25,
    manual: '未在页面找到该支付方式，请手动选择',
  });
}

// ---------- 主流程 ----------
let running = false, aborted = false;

/**
 * 提交订单（锁定门票）带自动重试。
 * 开售瞬间官网极易卡死/转圈，单次「提交订单」经常失败或页面无反应，
 * 此处循环重试：直到成功进入订单确认页（出现「去支付」按钮）或达最大次数/被中止。
 * 作者：songshan.li (ID: 17099618)
 */
async function submitOrderWithRetry(tab, cfg) {
  const maxTry = 12;          // 最大提交次数
  const intervalMs = 800;     // 每次重试间隔
  for (let i = 1; i <= maxTry; i++) {
    if (aborted) { log('warn', '重试被中止'); return false; }
    log('step', `提交订单 第 ${i}/${maxTry} 次`);
    await autoClickInTab(tab, ['提交订单', '确认订单'], '提交订单（锁定门票）', { tries: 12 });

    // 等待 1.2s 看是否进入订单确认页（出现「去支付」）
    await new Promise(r => setTimeout(r, 1200));
    const reached = await checkPageHas(tab, ['去支付', '立即支付', '提交支付', '收银台', '选择支付方式']);
    if (reached) {
      log('success', `门票已锁定（第 ${i} 次提交成功）`);
      return true;
    }
    log('warn', `第 ${i} 次未锁定成功（可能售罄/卡单），1.2s 后重试...`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

/** 检查页面是否已出现某组关键词（用于判断是否进入目标页） */
function checkPageHas(win, keywords) {
  return new Promise((resolve) => {
    try {
      const nodes = win.document.querySelectorAll('button, a, li, [class*="pay"], [class*="channel"], [role="radio"]');
      let found = false;
      nodes.forEach(el => {
        const txt = (el.innerText || el.textContent || el.title || el.getAttribute('aria-label') || '').trim();
        if (keywords.some(k => txt.includes(k))) found = true;
      });
      resolve(found);
    } catch { resolve(false); }
  });
}

async function startGrab() {
  if (running) { log('warn', '任务进行中'); return; }
  saveConfig();
  const cfg = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  const targetTs = cfg.saleTime ? new Date(cfg.saleTime).getTime() : 0;
  if (!targetTs || isNaN(targetTs)) { log('error', '请先设置有效的开售时间'); return; }

  running = true; aborted = false;
  setStage('等待开售');
  log('info', `开售时间：${new Date(targetTs).toLocaleString('zh-CN')}`);
  log('info', '已开启「提交订单自动重试」（最多 12 次），可大幅减少手动兜底。');
  startCountdown(targetTs);

  // 等待到点
  await new Promise(res => {
    const chk = setInterval(() => {
      if (aborted || Date.now() >= targetTs) { clearInterval(chk); res(); }
    }, 200);
  });
  if (aborted) { setStage('已中止'); return; }

  setStage('执行中');
  log('success', '开售！打开购票页...');

  // 打开大麦购票页（新标签页）
  const url = cfg.showUrl || 'https://m.damai.cn/';
  const tab = window.open(url, '_blank');
  if (!tab) { log('error', '浏览器拦截了新窗口，请允许弹窗后重试'); return; }
  await new Promise(r => setTimeout(r, 3000));

  // 自动点击序列（在官网/H5 页面上操作，不控制原生 App）
  await autoClickInTab(tab, ['立即购买', '立即预定', '选座购买'], '立即购买');
  if (cfg.session) await autoClickInTab(tab, [cfg.session], `场次(${cfg.session})`);
  if (cfg.priceTier) await autoClickInTab(tab, [cfg.priceTier, '看台', '内场'], `票档(${cfg.priceTier})`);
  // 数量
  const qty = Math.max(1, parseInt(cfg.quantity) || 1);
  for (let i = 1; i < qty; i++) await autoClickInTab(tab, ['+', '增加'], '增加数量');

  // 锁定门票：提交订单（带自动重试）
  const locked = await submitOrderWithRetry(tab, cfg);
  if (!locked) {
    setStage('需手动兜底');
    log('error', '自动提交未达到锁定状态：可能已售罄、或官网持续卡单。');
    log('warn', '请立即在官网页面手动点「提交订单」！本脚本已停，但页面仍在。');
    showManualAlert();
    running = false;
    return;
  }

  log('success', '门票已锁定，等待订单确认页加载...');
  await new Promise(r => setTimeout(r, 1200));

  // 调整支付工具
  await selectPayMethod(tab, cfg.payMethod);

  // 点「去支付」：尝试唤起支付宝/微信（这一步由脚本点击，
  // 但能否真正拉起 App 取决于官网与系统弹窗，需本人点"允许打开"）
  await autoClickInTab(tab, ['去支付', '立即支付', '提交支付'], '去支付（唤起支付）');
  await new Promise(r => setTimeout(r, 1200));

  // 到此停止：锁票+选支付+点去支付已完成，跳 App / 输密码由本人完成
  setStage('待本人支付');
  log('success', '门票已锁定，支付工具已选好，已点击「去支付」。');
  log('warn', '请现在在手机上：允许打开支付宝/微信 → 完成付款。切勿退出页面，订单有时效！');
  showPayAlert(cfg.payMethod);
  startPayGuard();
  running = false;
}

/**
 * 自动提交失败、需要人工兜底时的全屏提示（震动+语音+醒目红字）
 * 作者：songshan.li (ID: 17099618)
 */
function showManualAlert() {
  let mask = document.getElementById('manualMask');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'manualMask';
    mask.style.cssText = `position:fixed;inset:0;z-index:9998;background:rgba(120,0,0,.85);
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      color:#fff;text-align:center;padding:24px;`;
    document.body.appendChild(mask);
  }
  mask.innerHTML = `
    <div style="font-size:54px">🚨</div>
    <div style="font-size:22px;font-weight:800;margin:10px 0">请立即手动抢票！</div>
    <div style="font-size:15px;opacity:.95;margin-bottom:8px">脚本自动提交未锁定门票</div>
    <div style="font-size:14px;opacity:.9;margin-bottom:18px">马上切到官网页面，猛点「提交订单」！手快有手慢无</div>
    <button id="manualClose" style="padding:14px 40px;border:none;border-radius:30px;font-size:16px;font-weight:700;
      background:#fff;color:#b71c1c">我知道了</button>`;
  mask.style.display = 'flex';
  document.getElementById('manualClose').onclick = () => { mask.style.display = 'none'; };
  if (navigator.vibrate) navigator.vibrate([600, 200, 600, 200, 600]);
  try {
    const u = new SpeechSynthesisUtterance('请立即手动抢票，手快有手慢无');
    u.lang = 'zh-CN'; speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch {}
}

/**
 * 弹出"请本人支付"的大幅提示（语音+震动+全屏遮罩）
 * 作者：songshan.li (ID: 17099618)
 */
function showPayAlert(method) {
  let mask = document.getElementById('payMask');
  if (!mask) {
    mask = document.createElement('div');
    mask.id = 'payMask';
    mask.style.cssText = `position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.82);
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      color:#fff;text-align:center;padding:24px;`;
    document.body.appendChild(mask);
  }
  mask.innerHTML = `
    <div style="font-size:54px">💳</div>
    <div style="font-size:22px;font-weight:800;margin:10px 0">请立即完成支付</div>
    <div style="font-size:15px;opacity:.9;margin-bottom:6px">门票已锁定，支付工具：${method || '默认'}</div>
    <div style="font-size:13px;opacity:.8;margin-bottom:18px">允许打开支付App → 指纹/密码付款。订单有时效，勿退出！</div>
    <button id="payDone" style="padding:14px 40px;border:none;border-radius:30px;font-size:16px;font-weight:700;
      background:linear-gradient(90deg,#ff3d8b,#ff6a3d);color:#fff">我已支付完成</button>
    <button id="payClose" style="margin-top:12px;background:none;border:1px solid rgba(255,255,255,.4);
      color:#fff;padding:8px 20px;border-radius:20px;font-size:13px">关闭提示</button>`;
  mask.style.display = 'flex';
  document.getElementById('payDone').onclick = () => {
    mask.style.display = 'none';
    log('info', '已标记支付完成。如未实际支付，请回到订单页确认。');
    clearInterval(window._payGuard);
  };
  document.getElementById('payClose').onclick = () => { mask.style.display = 'none'; };
  // 震动 + 语音提醒（手机支持时）
  if (navigator.vibrate) navigator.vibrate([400, 200, 400]);
  try {
    const u = new SpeechSynthesisUtterance('门票已锁定，请立即完成支付');
    u.lang = 'zh-CN'; speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch {}
}

/**
 * 支付倒计时保护：提示订单剩余时效（默认按 5 分钟估算，可在配置扩展）
 * 作者：songshan.li (ID: 17099618)
 */
function startPayGuard(seconds = 300) {
  clearInterval(window._payGuard);
  const deadline = Date.now() + seconds * 1000;
  window._payGuard = setInterval(() => {
    const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    const m = String(Math.floor(left / 60)).padStart(2, '0');
    const s = String(left % 60).padStart(2, '0');
    if (document.getElementById('payMask')) {
      const tip = document.getElementById('payGuardTip');
      if (!tip) {
        const t = document.createElement('div');
        t.id = 'payGuardTip'; t.style.cssText = 'margin-top:14px;font-size:13px;color:#ffd166';
        document.getElementById('payMask').appendChild(t);
      }
      document.getElementById('payGuardTip').textContent = `订单剩余时效：${m}:${s}`;
    }
    if (left <= 0) {
      clearInterval(window._payGuard);
      log('error', '订单支付时效可能已过期，门票或已释放，请立即回官网订单页确认！');
    }
  }, 1000);
}

function abortGrab() { aborted = true; log('warn', '已发送中止'); running = false; }

// ---------- 自动抓取（书签桥接，跨页同步） ----------
const GRAB_KEY = 'damai_grab_scraped_v1';

// 书签脚本源码：在大麦详情页运行，读取场次/票档/开售时间并写入 localStorage
const BOOKMARK_SRC = `
(function(){
  try {
    var txt = function(el){return (el&&(el.innerText||el.textContent)||'').replace(/\\s+/g,' ').trim();};
    var sessions=[], tiers=[], saleTime='';
    // 场次：含"月""日"的可点击项
    document.querySelectorAll('*').forEach(function(el){
      if(el.children.length===0){
        var t=txt(el);
        if(/\\d+月\\d+[日号]?/.test(t) && t.length<40) sessions.push(t);
        if(/(\\d+元|VIP|看台|内场|看台|包厢)/.test(t) && t.length<30) tiers.push(t);
      }
    });
    // 开售时间：含"开售""开抢"文案附近
    var body=document.body.innerText;
    var m=body.match(/(开售|开抢)[^\\n]*?(\\d{1,2}[月-]\\d{1,2}[日\\s]?[\\d:]*)/);
    if(m) saleTime=m[2].replace(/[日\\s]/g,' ').trim();
    var data={url:location.href, sessions:[...new Set(sessions)].slice(0,12), tiers:[...new Set(tiers)].slice(0,12), saleTime:saleTime, ts:Date.now()};
    localStorage.setItem('${GRAB_KEY}', JSON.stringify(data));
    alert('已抓取：'+data.sessions.length+'个场次, '+data.tiers.length+'个票档'+(data.saleTime?('，开售:'+data.saleTime):''));
  } catch(e){ alert('抓取失败：'+e.message); }
})();
`;
// 转成可拖到书签栏的 javascript: 链接
const BOOKMARK_URL = 'javascript:' + encodeURIComponent(BOOKMARK_SRC);

/** 把抓取结果填入下拉框 */
function applyScraped(data) {
  if (!data) return;
  if (data.url) { $('showUrl').value = data.url; }
  if (data.saleTime) { $('saleTime').value = parseSaleTime(data.saleTime); }
  fillSelect('session', data.sessions, '场次');
  fillSelect('priceTier', data.tiers, '票档');
  $('grabState').textContent = `已抓取 ${data.sessions.length}场/${data.tiers.length}档`;
  $('grabState').className = 'pill on';
  log('success', `已自动获取：场次${data.sessions.length}个、票档${data.tiers.length}个${data.saleTime ? '、开售' + data.saleTime : ''}`);
}

function fillSelect(id, arr, label) {
  const sel = $(id);
  sel.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = ''; empty.textContent = `— 选${label} —`;
  sel.appendChild(empty);
  (arr || []).forEach(v => {
    if (!v) return;
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  });
}

/** 把"7月20日 19:30"之类的文案转成 datetime-local 值（年份取当年） */
function parseSaleTime(s) {
  const m = String(s).match(/(\\d{1,2})[月-](\\d{1,2})[日\\s]*?(\\d{1,2})?:?(\\d{2})?/);
  if (!m) return '';
  const y = new Date().getFullYear();
  const mo = String(m[1]).padStart(2, '0');
  const d = String(m[2]).padStart(2, '0');
  const h = (m[3] || '0').padStart(2, '0');
  const mi = (m[4] || '0').padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${mi}`;
}

/** 监听其他标签页写入的抓取结果（storage 事件跨标签页同步） */
window.addEventListener('storage', (e) => {
  if (e.key === GRAB_KEY && e.newValue) {
    try { applyScraped(JSON.parse(e.newValue)); } catch {}
  }
});

// ---------- 事件绑定 ----------
$('saveBtn').onclick = saveConfig;
$('autoPay').onchange = () => {
  $('autoPayPill').textContent = $('autoPay').checked ? '去支付:开' : '去支付:关';
  $('autoPayPill').className = 'pill' + ($('autoPay').checked ? ' on' : '');
};
$('startBtn').onclick = startGrab;
$('abortBtn').onclick = abortGrab;
$('openBtn').onclick = () => {
  const url = $('showUrl').value || 'https://m.damai.cn/';
  window.open(url, '_blank');
};

// 书签：展示代码 + 复制
$('bmCode').textContent = BOOKMARK_URL.slice(0, 80) + '…';
$('copyBookmark').onclick = async () => {
  try {
    await navigator.clipboard.writeText(BOOKMARK_URL);
    log('success', '抓取书签已复制，请添加到浏览器书签栏，名称自取（如"抓取大麦"）。');
  } catch {
    log('warn', '复制失败，请长按下方书签代码手动复制。');
  }
};

loadConfig();
// 启动时若有历史抓取结果，直接回填
try {
  const hist = localStorage.getItem(GRAB_KEY);
  if (hist) applyScraped(JSON.parse(hist));
} catch {}
log('info', '就绪。在大麦详情页点「抓取大麦」书签→回来即可自动获取场次/票档/开售时间。');
