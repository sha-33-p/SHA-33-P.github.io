/**
 * 大麦 App 抢票脚本（安卓本地无障碍自动化 · 可视化版）
 * 作者：songshan.li (ID: 17099618)
 *
 * 运行环境：安卓手机安装 Auto.js / 振飞脚本 App，
 *           在 App 内"导入此脚本"运行（需授予无障碍权限 + 悬浮窗权限）。
 *
 * 可视化：本脚本使用 Auto.js 的 ui 布局，在手机上弹出表单窗口，
 *        像网页控制台一样填写：演出链接/搜索词、场次、票档、数量、支付工具、开售时间，
 *        点「开始抢票」即可，无需手动改代码。
 *
 * 功能：开售时间到 → 解锁屏幕 → 启动大麦 App → 打开演出详情
 *       → 自动点「立即购买」→ 选场次 → 选票档 → 选数量 → 提交订单（锁定，带自动重试）
 *       → 选支付工具 → 点「去支付」→ 停止，由本人完成支付。
 *
 * 说明：脚本只负责"抢+锁票+点去支付"，不自动填支付密码，不绕过任何安全验证。
 *       不同手机/大麦版本控件文本、Activity 可能不同，请按真机微调关键词。
 *       华为鸿蒙对无障碍自动化管控较严，需在「设置→辅助功能→无障碍」手动授权，
 *       并保持屏幕常亮、关闭省电限制，避免后台被杀。
 */

// ===================== 可视化界面 =====================
ui.layout(
  <vertical padding="16" bg="#1a1140">
    <text text="🎫 大麦抢票助手" textSize="22sp" textColor="#ffffff" textStyle="bold" gravity="center" marginBottom="4"/>
    <text text="手机本地运行 · 安卓/鸿蒙通用 · 不自动填支付密码" textSize="12sp" textColor="#cccccc" gravity="center" marginBottom="12"/>

    <card bg="#ffffff14" cornerRadius="12" padding="12" marginBottom="12">
      <vertical>
        <text text="① 演出（二选一填写）" textSize="14sp" textColor="#7ec8ff" marginBottom="6"/>
        <text text="演出 Deep Link（分享里的 damai:// 链接）" textSize="12sp" textColor="#ffffff" marginBottom="2"/>
        <input id="deeplink" hint="如 damai://showticket?..." textColor="#ffffff" bg="#00000040" marginBottom="8"/>
        <text text="或 演出名（用于 App 内搜索）" textSize="12sp" textColor="#ffffff" marginBottom="2"/>
        <input id="keyword" hint="如 周杰伦演唱会" textColor="#ffffff" bg="#00000040" marginBottom="4"/>
      </vertical>
    </card>

    <card bg="#ffffff14" cornerRadius="12" padding="12" marginBottom="12">
      <vertical>
        <text text="② 抢票参数" textSize="14sp" textColor="#7ec8ff" marginBottom="6"/>
        <text text="场次关键词（留空=点第一个）" textSize="12sp" textColor="#ffffff" marginBottom="2"/>
        <input id="session" hint="如 7月20日 19:30" textColor="#ffffff" bg="#00000040" marginBottom="8"/>
        <text text="票档关键词（留空=点第一个）" textSize="12sp" textColor="#ffffff" marginBottom="2"/>
        <input id="tier" hint="如 看台580" textColor="#ffffff" bg="#00000040" marginBottom="8"/>
        <horizontal>
          <vertical weight="1" marginRight="6">
            <text text="数量" textSize="12sp" textColor="#ffffff" marginBottom="2"/>
            <input id="quantity" inputType="number" hint="1" text="1" textColor="#ffffff" bg="#00000040"/>
          </vertical>
          <vertical weight="1" marginLeft="6">
            <text text="支付工具" textSize="12sp" textColor="#ffffff" marginBottom="2"/>
            <spinner id="payMethod" entries="支付宝|微信支付|银行卡|花呗" textColor="#ffffff"/>
          </vertical>
        </horizontal>
      </vertical>
    </card>

    <card bg="#ffffff14" cornerRadius="12" padding="12" marginBottom="12">
      <vertical>
        <text text="③ 开售时间" textSize="14sp" textColor="#7ec8ff" marginBottom="6"/>
        <text text="格式：2026-07-21 20:00:00（手机本地时间）" textSize="12sp" textColor="#ffffff" marginBottom="2"/>
        <input id="saleTime" hint="2026-07-21 20:00:00" textColor="#ffffff" bg="#00000040" marginBottom="4"/>
      </vertical>
    </card>

    <checkBox id="hasPass" text="设备有锁屏密码（开售后脚本会等你手动解锁）" textColor="#ffffff" textSize="12sp" marginBottom="10"/>

    <button id="startBtn" text="▶ 开始抢票" bg="#ff3d8b" textColor="#ffffff" textSize="16sp" padding="14" marginBottom="8"/>
    <button id="abortBtn" text="■ 中止" bg="#b71c1c" textColor="#ffffff" padding="12"/>

    <text id="log" text="" textSize="11sp" textColor="#9effa0" bg="#00000050" padding="10" marginBottom="4" h="180"/>
  </vertical>
);

// ===================== 工具函数 =====================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function uiLog(msg) {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = '[' + t + '] ' + msg;
  ui.run(() => { ui.log.text(ui.log.text() + line + '\n'); });
  console.log(line);
}

/** 点击文本匹配的控件（自动尝试 text / desc） */
function clickText(keywords, timeout = 2000) {
  for (const k of (Array.isArray(keywords) ? keywords : [keywords])) {
    let w = text(k).findOne(timeout);
    if (!w) w = desc(k).findOne(timeout);
    if (w) {
      const b = w.bounds();
      click(b.centerX(), b.centerY());
      uiLog('点击：' + k);
      return true;
    }
  }
  return false;
}

/** 页面是否包含某关键词（用于判断进入了哪个页） */
function pageHas(keywords) {
  for (const k of keywords) {
    if (text(k).exists() || desc(k).exists()) return true;
  }
  return false;
}

/** 解锁屏幕（上滑；有密码锁会暂停等待本人输入） */
function unlock(withPass) {
  if (!device.isScreenOn()) { device.wakeUp(); sleep(600); }
  swipe(device.width / 2, device.height * 0.8, device.width / 2, device.height * 0.2, 300);
  sleep(800);
  if (withPass) {
    uiLog('提示：设备有锁屏密码，请现在手动解锁，脚本暂停 6 秒');
    sleep(6000);
  }
}

/** 启动大麦并进入演出详情 */
function openShow(cfg) {
  uiLog('启动大麦 App...');
  if (cfg.deeplink) {
    app.startActivity({ action: 'android.intent.action.VIEW', data: cfg.deeplink });
  } else {
    app.launch('cn.damai');
    sleep(3000);
    if (cfg.keyword) {
      clickText(['搜索'], 2000);
      sleep(800);
      setText(cfg.keyword);
      sleep(1000);
      clickText([cfg.keyword], 2000);
      sleep(2000);
    }
  }
  sleep(3000);
}

/**
 * 提交订单并自动重试，直到进入支付/收银台页或次数耗尽
 * 作者：songshan.li (ID: 17099618)
 */
async function submitWithRetry(cfg) {
  for (let i = 1; i <= cfg.maxRetry; i++) {
    if (aborted) { uiLog('重试被中止'); return false; }
    uiLog('提交订单 第 ' + i + '/' + cfg.maxRetry + ' 次');
    clickText(['提交订单', '确认订单'], 1500);
    await sleep(1200);
    if (pageHas(['去支付', '立即支付', '收银台', '选择支付方式'])) {
      uiLog('门票已锁定（第 ' + i + ' 次成功）');
      return true;
    }
    uiLog('第 ' + i + ' 次未锁定，重试...');
    await sleep(800);
  }
  return false;
}

// ===================== 中止信号 =====================
let aborted = false;

// ===================== 主流程 =====================
async function main(cfg) {
  uiLog('==== 大麦 App 抢票脚本启动 ====');
  const targetTs = new Date(cfg.saleTime.replace(/-/g, '/')).getTime();
  if (isNaN(targetTs)) { uiLog('错误：开售时间格式不正确'); return; }
  uiLog('开售时间：' + cfg.saleTime + '，提交最多重试 ' + cfg.maxRetry + ' 次');

  while (Date.now() < targetTs) {
    if (aborted) { uiLog('已中止'); return; }
    await sleep(1000);
  }
  uiLog('开售！开始执行');

  unlock(cfg.hasPass);
  openShow(cfg);

  if (cfg.deeplink || cfg.keyword) {
    clickText(['立即购买', '立即预定', '选座购买'], 2500);
    await sleep(1500);
  }

  if (cfg.session) {
    clickText([cfg.session], 2500);
  } else {
    const s = textMatches(/.*(月|日|场).*/).findOne(2500);
    if (s) { const b = s.bounds(); click(b.centerX(), b.centerY()); uiLog('选中第一个场次'); }
  }
  await sleep(1000);

  if (cfg.tier) {
    clickText([cfg.tier], 2500);
  } else {
    const t = descMatches(/.*(元|VIP|看台|内场|包厢).*/).findOne(2500)
          || textMatches(/.*(元|VIP|看台|内场|包厢).*/).findOne(2500);
    if (t) { const b = t.bounds(); click(b.centerX(), b.centerY()); uiLog('选中第一个票档'); }
  }
  await sleep(1000);

  for (let i = 1; i < cfg.quantity; i++) { clickText(['+', '增加'], 1200); await sleep(400); }

  const locked = await submitWithRetry(cfg);
  if (!locked) {
    uiLog('自动提交未锁定门票！请立即手动点「提交订单」！');
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([600, 200, 600]);
    return;
  }

  await sleep(800);
  if (cfg.payMethod) {
    clickText([cfg.payMethod], 2500);
    await sleep(800);
  }
  clickText(['去支付', '立即支付', '提交支付'], 2500);
  uiLog('已点击「去支付」。请在手机上允许打开支付宝/微信并完成付款。订单有时效，勿退出！');
  if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([400, 200, 400]);
}

// ===================== 事件绑定（界面作用域）=====================
ui.startBtn.click(() => {
  aborted = false;
  const cfg = {
    deeplink: ui.deeplink.text().toString().trim(),
    keyword: ui.keyword.text().toString().trim(),
    session: ui.session.text().toString().trim(),
    tier: ui.tier.text().toString().trim(),
    quantity: Math.max(1, parseInt(ui.quantity.text().toString().trim()) || 1),
    payMethod: ui.payMethod.text().toString().trim(),
    saleTime: ui.saleTime.text().toString().trim(),
    hasPass: ui.hasPass.checked(),
    maxRetry: 15,
  };
  if (!cfg.deeplink && !cfg.keyword) { uiLog('请至少填写演出链接或演出名'); return; }
  if (!cfg.saleTime) { uiLog('请填写开售时间'); return; }
  uiLog('配置已读取，开始后台运行...');
  // 自动化操作需在独立线程执行，避免阻塞 UI
  threads.start(function () { main(cfg); });
});

ui.abortBtn.click(() => {
  aborted = true;
  uiLog('已发送中止信号');
});

uiLog('就绪。填写参数后点「开始抢票」，开售前请保持屏幕常亮、大麦已登录。');
