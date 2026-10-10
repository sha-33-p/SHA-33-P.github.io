/**
 * 模拟手机点击脚本：自动跳转支付宝登录页面（可视化版）
 * 作者：songshan.li (ID: 17099618)
 *
 * 运行环境：安卓手机安装 Auto.js / 振飞脚本 App，
 *           在 App 内"导入此脚本"运行（需授予无障碍权限 + 悬浮窗权限）。
 *
 * 可视化：使用 Auto.js 的 ui 布局，在手机上弹出表单窗口，
 *        选择目标 App（支付宝/微信）、是否含锁屏密码，点「开始」即可，无需改代码。
 *
 * 功能：解锁屏幕 → 回到桌面 → 启动目标 App → 若未登录则点击「登录」进入登录页。
 * 说明：脚本只负责"打开并进入登录页"，账号密码由本人输入，不自动填密。
 *
 * 注意：不同手机/系统版本坐标、控件文本可能不同，请按真机微调关键词。
 *       华为鸿蒙对无障碍自动化管控较严，需在「设置→辅助功能→无障碍」手动授权。
 */

// ===================== 可视化界面 =====================
ui.layout(
  <vertical padding="16" bg="#1a1140">
    <text text="🔓 登录页跳转助手" textSize="22sp" textColor="#ffffff" textStyle="bold" gravity="center" marginBottom="4"/>
    <text text="自动解锁 → 启动 App → 进入登录页（不自动填密码）" textSize="12sp" textColor="#cccccc" gravity="center" marginBottom="12"/>

    <card bg="#ffffff14" cornerRadius="12" padding="12" marginBottom="12">
      <vertical>
        <text text="目标 App" textSize="14sp" textColor="#7ec8ff" marginBottom="6"/>
        <spinner id="target" entries="支付宝|微信" textColor="#ffffff"/>
        <text text="支付宝包名 com.eg.android.AlipayGphone / 微信包名 com.tencent.mm" textSize="11sp" textColor="#bbbbbb" marginTop="6"/>
      </vertical>
    </card>

    <checkBox id="hasPass" text="设备有锁屏密码（脚本会等你手动解锁）" textColor="#ffffff" textSize="12sp" marginBottom="10"/>

    <button id="startBtn" text="▶ 开始跳转" bg="#ff3d8b" textColor="#ffffff" textSize="16sp" padding="14" marginBottom="8"/>
    <button id="abortBtn" text="■ 关闭" bg="#b71c1c" textColor="#ffffff" padding="12"/>

    <text id="log" text="" textSize="11sp" textColor="#9effa0" bg="#00000050" padding="10" marginBottom="4" h="160"/>
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

/** 尝试解锁（上滑；有密码锁会暂停等待本人输入） */
function unlock(withPass) {
  if (!device.isScreenOn()) { device.wakeUp(); sleep(600); }
  swipe(device.width / 2, device.height * 0.8, device.width / 2, device.height * 0.2, 300);
  sleep(800);
  if (withPass) {
    uiLog('提示：设备有锁屏密码，请现在手动解锁，脚本暂停 6 秒');
    sleep(6000);
  }
}

/** 点击文本匹配的控件 */
function clickText(keywords, timeout = 2000) {
  for (const k of keywords) {
    let w = text(k).findOne(timeout);
    if (!w) w = desc(k).findOne(timeout);
    if (w) { w.click(); uiLog('点击：' + k); return true; }
  }
  return false;
}

// App 包名映射
const PACKAGES = {
  '支付宝': 'com.eg.android.AlipayGphone',
  '微信': 'com.tencent.mm',
};

/** 登录入口关键词（不同 App 文案不同，尽量覆盖） */
const LOGIN_KEYWORDS = {
  '支付宝': ['登录', '立即登录', '手机号登录', '一键登录'],
  '微信': ['登录', '切换账号', '更多', '风险提示', '登录微信'],
};

/** 主流程 */
function run(cfg) {
  const pkg = PACKAGES[cfg.target] || PACKAGES['支付宝'];
  uiLog('==== 开始：跳转 ' + cfg.target + ' 登录页 ====');
  unlock(cfg.hasPass);
  home();
  sleep(800);
  uiLog('启动 ' + cfg.target + '...');
  app.launch(pkg);
  sleep(3500);
  const hit = clickText(LOGIN_KEYWORDS[cfg.target] || ['登录'], 2500);
  if (hit) {
    uiLog('已进入/触发 ' + cfg.target + ' 登录页');
  } else {
    uiLog('未识别到登录入口，可能已登录或页面结构不同，请手动确认');
  }
  sleep(1500);
  uiLog('完成：' + cfg.target + ' 应已停留在登录页，请本人输入账号密码登录。');
  uiLog('（脚本不自动填写密码，安全合规）');
}

// ===================== 事件绑定 =====================
ui.startBtn.click(() => {
  const cfg = {
    target: ui.target.text().toString().trim(),
    hasPass: ui.hasPass.checked(),
  };
  uiLog('配置已读取，开始执行...');
  threads.start(function () { run(cfg); });
});

ui.abortBtn.click(() => {
  uiLog('已关闭窗口');
  ui.finish();
});

uiLog('就绪。选择目标 App，点「开始跳转」。脚本停在你的登录页，由你本人输入密码。');
