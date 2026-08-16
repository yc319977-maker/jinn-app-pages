/* ============================================================
 * app.js — 第二大脑 · jinn 的成长工作台
 * 纯前端 / 无构建 / 移动+桌面 / 本地优先 + 可选 Supabase 同步
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------- 通用工具 ---------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const ymd = (d = new Date()) => {
    const z = new Date(d); const off = z.getTimezoneOffset() * 60000;
    return new Date(z - off).toISOString().slice(0, 10);
  };
  const today = () => ymd();
  const addDays = (n, base = new Date()) => ymd(new Date(new Date(base).getTime() + n * 86400000));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (v, d = 0) => Number(v || 0).toLocaleString('zh-CN', { maximumFractionDigits: d });
  // 统计一份 state 的"活数据"条数（与 db.js liveCount 对应，供导入校验使用）
  function liveCountOf(s) {
    if (!s || typeof s !== 'object') return 0;
    let n = 0;
    ['tasks', 'growth', 'inspirations', 'content', 'hotspots', 'customers', 'ecommerce', 'english', 'health', 'income', 'reviews', 'decisions'].forEach((k) => { if (Array.isArray(s[k])) n += s[k].length; });
    if (s.aiProfile && typeof s.aiProfile === 'object') n += Object.keys(s.aiProfile).length;
    return n;
  }
  // 任务 / 记录统一分类常量（单一来源：所有下拉框、标签、配色都从这里取）
  // 任务分类统一为 5 类（新增/编辑任务下拉唯一来源）。历史旧分类值(biz/grow/company/private/content/无) 一律不改数据，仅经 LEGACY_CAT_LABELS 兜底显示。
  const TASK_CATS = [
    { v: 'personal', t: '个人' },
    { v: 'work', t: '工作' },
    { v: 'ecom', t: '电商' },
    { v: 'ip', t: 'IP内容' },
    { v: 'edu', t: '教育' },
  ];
  // 历史旧分类显示兜底（task.cat 值绝不改写，仅保证旧值仍能正确显示名称/配色）
  const LEGACY_CAT_LABELS = { '': '未分类', content: '内容', biz: '商业', grow: '成长', company: '公司', private: '私人' };
  const catName = (c) => { const x = TASK_CATS.find((o) => o.v === c); return x ? x.t : (LEGACY_CAT_LABELS[c] || ''); };
  const catClass = (c) => { const x = TASK_CATS.find((o) => o.v === c); return x ? x.v : (c || ''); };
  // 任务类型统一常量（单一来源：正式任务表单、标签从此取）
  const TASK_TYPES = [
    { v: 'core', t: '核心推进' },
    { v: 'todo', t: '普通待办' },
    { v: 'temp', t: '临时记录' },
  ];
  const typeName = (t) => { const x = TASK_TYPES.find((o) => o.v === t); return x ? x.t : ''; };

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  /* ---------------- 状态 ---------------- */
  const App = window.App = { state: null, current: 'home', folds: {}, homeQuoteShift: 0 };

  function ensure() {
    const s = App.state;
    ['tasks', 'growth', 'inspirations', 'content', 'hotspots', 'customers',
      'ecommerce', 'english', 'health', 'income', 'reviews', 'decisions'].forEach((k) => {
        if (!Array.isArray(s[k])) s[k] = [];
      });
    if (!s.aiProfile) s.aiProfile = {};
    if (!s.meta) s.meta = {};
    if (!Array.isArray(s.trash)) s.trash = [];
    if (!Array.isArray(s.purged)) s.purged = [];
    if (!Array.isArray(s.dates)) s.dates = [];   // 首页「重要日期」：仅补空数组，零迁移
    // 习惯配置（仅补空数组 + 首次种子，零迁移）：内置「英语」「健康」通过 kind 关联到原有 english/health 数组，历史打卡完全保留
    if (!Array.isArray(s.habitLogs)) s.habitLogs = [];   // 自定义习惯的打卡记录
    if (!Array.isArray(s.habits)) {
      s.habits = [
        { id: 'sys-english', name: '英语', icon: '📚', kind: 'english', active: true, order: 1, createdAt: today() },
        { id: 'sys-health', name: '健康', icon: '💪', kind: 'health', active: true, order: 2, createdAt: today() },
      ];
    }
  }

  // —— 一次性安全迁移：把 jinn 自己记录的历史任务导入现有 tasks 数据源 ——
  // 数据安全铁律：① 幂等——标记 __mig.historicalTasksV1，重复运行绝不重复创建；
  //         ② 去重——按 日期+标题(归一)+完成状态 比对现有 tasks，疑似重复跳过并计数（不自动合并、不删现有）；
  //         ③ 仅追加——不删/不改/不重置任何已有任务，保留原始日期，未完成自动进入"需要继续推进"；
  //         ④ 统一数据源——全部写入 App.state.tasks，与月视图/每日进步/任务列表共用同一对象（不建第二套）。
  function migrateHistoricalTasks() {
    const s = App.state;
    if (!Array.isArray(s.tasks)) s.tasks = [];
    s.__mig = s.__mig || {};
    if (s.__mig.historicalTasksV1) return;   // 已迁移过 → 直接跳过，防重复
    // 清单：[日期, 标题, 是否完成, 区域]；日期 '' = 无日期灵感（不伪造日期）
    const HIST = [
      ['2026-06-26','找林林签公会',true,'content'],
      ['2026-06-26','发官号视频',true,'content'],
      ['2026-06-26','剪自己开学典礼视频',true,'content'],
      ['2026-06-26','7月团播安排',true,'content'],
      ['2026-06-26','教阿姨教育直播',false,'edu'],
      ['2026-06-26','团播缺的东西',true,'content'],
      ['2026-06-26','新人下来签规则单',true,'content'],
      ['2026-06-26','和白宇确认阿妮达 妆容考核是否通过',true,''],
      ['2026-06-26','教育《百问》、SOP整理',true,'edu'],
      ['2026-06-26','小红书解封',true,''],
      ['2026-06-26','看玉姐发的小红书',false,''],
      ['2026-06-28','剪美妆视频（向下看箭头、胶水不要挤太多文字提醒）',true,'content'],
      ['2026-06-28','发官号视频',true,'content'],
      ['2026-06-28','转移电脑文件',true,''],
      ['2026-06-28','群内发放视频让他们发',true,'content'],
      ['2026-06-29','拍学姐视频（ai选题）',true,'content'],
      ['2026-06-30','让翻译妆教视频',true,'content'],
      ['2026-07-01','整理桌面文件',false,''],
      ['2026-07-01','把选题：留学清单整理',true,'edu'],
      ['2026-07-01','曼皇渠道ppt 增加校园风采',false,'edu'],
      ['2026-07-01','曼皇学校教育直播 理思路',false,'edu'],
      ['2026-07-01','录自己学历查询视频【一周后】',false,'content'],
      ['2026-07-01','电商工作交接 内容分工',true,'ecom'],
      ['2026-07-01','安排主播带货直播',true,'ecom'],
      ['2026-07-01','玉姐给学姐号发的视频进行仿拍',true,'content'],
      ['2026-07-01','买散热器',false,''],
      ['2026-07-01','网页进度（给虾哥周老师他们发教程）',false,'edu'],
      ['2026-07-01','各个群里周老师视频 发消息',true,'edu'],
      ['2026-07-01','安排切片发送',true,'content'],
      ['2026-07-02','老乡的朋友学费问题',true,'edu'],
      ['2026-07-02','教育费用整合！',true,'edu'],
      ['2026-07-02','备课',true,'edu'],
      ['2026-07-03','妆教视频配音、音效等',true,'content'],
      ['2026-07-03','家长会 公司的翻译把上次玉姐安排他们问的那个问题的那一段截取出来，然后把它剪成一个视频',true,'edu'],
      ['2026-07-03','上次是让雨宁问的，找一下宇宁问的那个片段',true,'edu'],
      ['2026-07-03','发官号视频',true,'content'],
      ['2026-07-04','确认电商主播上班时间，让玉娇管考勤',true,'ecom'],
      ['2026-07-04','发学姐号视频',true,'content'],
      ['2026-07-04','拍摄：一个女生独自去曼谷',false,'content'],
      ['2026-07-04','找nun和玉娇确认他们的休息时段',true,'ecom'],
      ['2026-07-08','自己小红书发视频',true,'content'],
      ['2026-07-08','微信项目介绍话术整理',false,'biz'],
      ['2026-07-08','玉姐采访视频内容整理',true,'content'],
      ['2026-07-09','看AI课程的回放',false,'edu'],
      ['2026-07-09','取消gpt会员',true,''],
      ['2026-07-12','做NM公司的资料（介绍资料）',false,'biz'],
      ['2026-07-18','拍一人去曼谷视频',true,'content'],
      ['2026-07-18','整理目前所有家长高频问题、问题回答的话术等',false,'edu'],
      ['2026-07-18','问成人留学',true,'edu'],
      ['','ec无界',false,''],
      ['','创业机会',false,''],
      ['','回馈给学弟学妹',false,''],
      ['','马来留学',false,''],
      ['','回馈给泰国',false,''],
      ['2026-08-04','TAP',true,''],
      ['2026-08-04','pr群任务',true,'biz'],
      ['2026-08-04','杨老师资料整合并上传网盘',true,'edu'],
      ['2026-08-07','学校Pr学生实操落地的前置工作',false,'edu'],
      ['2026-08-07','个人工作台',true,'grow'],
      ['2026-08-15','美瞳',true,''],
      ['2026-08-15','工作台优化',false,'grow'],
      ['2026-08-15','做作业',false,'edu'],
      ['2026-08-15','电钻达人对接',true,'ecom'],
      ['2026-08-15','备经济学课',false,'edu'],
      ['2026-08-16','找阿妮达谈话 罚300',false,''],
      ['2026-08-16','上传TK视频',false,'content'],
    ];
    const norm = (t) => (t || '').trim().toLowerCase();
    const seen = new Set(s.tasks.filter((t) => t && t.date != null).map((t) => (t.date || '') + '|' + norm(t.title) + '|' + (t.done ? 1 : 0)));
    let added = 0, skipped = 0;
    HIST.forEach((it) => {
      const date = it[0], title = (it[1] || '').trim(), done = !!it[2], cat = it[3] || '';
      if (!title) return;
      const key = (date || '') + '|' + norm(title) + '|' + (done ? 1 : 0);
      if (seen.has(key)) { skipped++; return; }   // 疑似重复：保留现有，不自动合并/不删
      s.tasks.push({
        id: uid(), type: 'todo', title, cat,
        date: date || '',                         // 无日期灵感保留空 date，不伪造日期
        done, doneAt: done ? (date || '') : '',
        canceled: false, order: Date.now(),
        note: date ? '' : '灵感·选题（无日期，保留不造日期）',
      });
      seen.add(key); added++;
    });
    s.__mig.historicalTasksV1 = true;
    App._migReport = { added, skipped, total: HIST.length };
    if (added) save();
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;       // 倒计时结束清空，让自动拉取可以再次覆盖
      DB.saveAll(App.state);
    }, 350);
  }
  function commit() { ensure(); save(); render(); }

  /* ---------------- 模块导航 ---------------- */
  const MODULES = [
    { id: 'home', name: '首页', short: '首页', icon: '🏠' },
    { id: 'today', name: '每日进步', short: '进步', icon: '🌱', home: true },
    { id: 'month', name: '月度成长', short: '月历', icon: '📅' },
    { id: 'growth', name: '成长地图', short: '成长', icon: '🗺️' },
    { id: 'content', name: '婧婧内容宇宙', short: '内容', icon: '🎬' },
    { id: 'crm', name: '教育 CRM', short: '教育', icon: '🌿' },
    { id: 'ecom', name: '电商实验室', short: '电商', icon: '🛒' },
    { id: 'aiprofile', name: 'AI 档案', short: 'AI', icon: '🤖' },
    { id: 'trash', name: '回收站', short: '回收站', icon: '🗑️' },
  ];

  function renderNav() {
    const sb = $('#sidebar');
    const counts = navCounts();
    sb.innerHTML = `<div class="brand">
        <img src="icon-512.png" alt=""><div><b>JINN GROW</b><small>成长工作台</small></div></div>` +
      MODULES.map((m) => {
        const n = counts[m.id] || 0;
        const badge = n > 0 ? `<span class="nav-badge">${n > 99 ? '99+' : n}</span>` : '';
        return `<button class="nav-item ${m.id === App.current ? 'active' : ''}" data-act="nav" data-id="${m.id}">
          <span class="ic">${m.icon}</span><span class="nav-label">${m.name}</span>${badge}</button>`;
      }).join('');
  }

  // 各模块顶部数字气泡：只提醒「待办 / 新热点 / 回收站」三类，避免制造压力
  function navCounts() {
    const s = App.state;
    const td = today();
    // 内容宇宙气泡：只统计「真正需要拍的内容」= 状态为「待制作」的选题
    // （不统计热点数量 / 灵感数量 / 链接数量 / 已发布数量 / 其他内容数量）
    const toShoot = s.content.filter((c) => c.status === '待制作').length;
    return {
      today: s.tasks.filter((t) => !t.canceled && !t.done && t.date === td && (t.type === 'core' || t.type === 'todo')).length,
      month: 0,
      growth: 0,
      inspiration: 0,
      content: toShoot,
      crm: 0,
      ecom: 0,
      self: 0,
      aiprofile: 0,
      trash: (s.trash || []).length,
    };
  }

  function setPage(title) { $('#pageTitle').textContent = title; }
  // 记住当前浏览位置（模块 + 内容宇宙子视图），刷新后恢复，不跳回首页
  function saveView() {
    try {
      localStorage.setItem('sb_view', JSON.stringify({
        current: App.current, contentView: contentView, contentCol: contentCol, inspKind: inspKind
      }));
    } catch (e) { /* localStorage 不可用时忽略 */ }
  }
  function navigate(id) {
    if (id !== 'today') App.todayFilter = null;   // 离开每日进度时清除过滤跳转视图
    if (id !== 'month') App.monthFilter = null;   // 离开月度成长时清除展开过滤
    App.current = id; renderNav(); render(); saveView();
    const m = MODULES.find((x) => x.id === id);
    if (m) setPage(m.name);
    window.scrollTo(0, 0);
  }

  /* ---------------- 弹窗 / 表单 ---------------- */
  const modalHost = $('#modalHost'), modalBox = $('#modalBox');
  function closeModal() { modalHost.classList.remove('show'); modalBox.innerHTML = ''; }
  function showModal(html) { modalBox.innerHTML = html; modalHost.classList.add('show'); }

  // fields: [{key,label,type,options,placeholder,value,hint}]
  function openForm(title, fields, initial, onSave) {
    initial = initial || {};
    const body = fields.map((f) => {
      const v = initial[f.key] != null ? initial[f.key] : (f.value != null ? f.value : '');
      let ctrl;
      if (f.type === 'textarea') ctrl = `<textarea name="${f.key}" class="${esc(f.cls || '')}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
      else if (f.type === 'select') ctrl = `<select name="${f.key}">` + (f.options || []).map((o) =>
        `<option value="${esc(o.v)}" ${o.v === v ? 'selected' : ''}>${esc(o.t)}</option>`).join('') + `</select>`;
      else if (f.type === 'series') ctrl = `<div class="series-picker">` + (f.options || SERIES_LIST).map((o) => {
        const sname = o.v != null ? o.v : o, slabel = o.t != null ? o.t : o, m = SERIES_META[sname] || {};
        const sel = (sname === v) ? 'checked' : '';
        return `<label class="series-opt ${sel}" style="--sc:${m.color || '#9DB8C9'};--sb:${m.bg || '#eef2f5'}">
          <input type="radio" name="${f.key}" value="${esc(sname)}" ${sel}>
          <span class="series-ic">${m.icon || '🎬'}</span><span>${esc(slabel)}</span></label>`;
      }).join('') + `</div>`;
      else ctrl = `<input name="${f.key}" type="${f.type || 'text'}" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}">`;
      return `<div class="field"><label>${esc(f.label)}</label>${ctrl}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
    }).join('');
    showModal(`<h3>${esc(title)}</h3>${body}
      <div class="modal-actions">
        <button class="btn ghost" data-act="close-modal">取消</button>
        <button class="btn" data-act="submit-form">保存</button>
      </div>`);
    modalBox.querySelector('[data-act="submit-form"]').onclick = () => {
      const fd = {}; fields.forEach((f) => {
        const el = modalBox.querySelector(`[name="${f.key}"]`);
        fd[f.key] = el ? el.value.trim() : '';
      });
      const ok = onSave(fd); if (ok !== false) closeModal();
    };
  }

  function openSheet(title, items) {
    const grid = items.map((it, i) =>
      `<button class="btn soft sm" style="width:100%;justify-content:flex-start;margin-bottom:8px" data-sheet="${i}">
        <span>${it.icon || '•'}</span><span>${esc(it.label)}</span></button>`).join('');
    showModal(`<h3>${esc(title)}</h3>${grid}
      <div class="modal-actions"><button class="btn ghost" data-act="close-modal">关闭</button></div>`);
    modalBox.querySelectorAll('[data-sheet]').forEach((b) => {
      b.onclick = () => { const it = items[+b.dataset.sheet]; closeModal(); it.onClick(); };
    });
  }

  /* ---------------- AI 启发式（无需联网） ---------------- */
  function classifyInspiration(text) {
    const t = (text || '').toLowerCase();
    const map = [
      { c: 'content', w: ['视频', '脚本', '选题', '拍摄', '小红书', '抖音', '内容', '号', '剪辑', '文案'] },
      { c: 'edu', w: ['教育', '学校', '校园', '学生', '家长', '升学', '留学', '泰国教育', '课程', '老师'] },
      { c: 'ecom', w: ['电商', '店铺', '选品', '带货', '商品', '淘宝', '抖音小店', '产品'] },
      { c: 'biz', w: ['商业', '创业', '机会', '变现', '合作', '模式', '生意', '项目', '营收'] },
      { c: 'grow', w: ['英语', '学习', '成长', '习惯', '健康', '读书', '自律', '冥想'] },
    ];
    let best = 'content', score = 0;
    map.forEach((m) => {
      const hit = m.w.filter((k) => t.includes(k.toLowerCase()));
      // 避免重叠词重复计分：若一个命中词被同类的更长命中词包含，则不计
      const s = hit.filter((k) => !hit.some((o) => o !== k && o.includes(k))).length;
      if (s > score) { score = s; best = m.c; }
    });
    return best;
  }
  const ROUTE = {
    content: { mod: 'content', make: (t) => ({ col: 'campus', title: t, status: '灵感' }) },
    edu: { mod: 'tasks', make: (t) => ({ type: 'todo', title: t, cat: 'edu' }) },
    ecom: { mod: 'ecommerce', make: (t) => ({ category: 'product', title: t }) },
    biz: { mod: 'decisions', make: (t) => ({ question: t }) },
    grow: { mod: 'tasks', make: (t) => ({ type: 'todo', title: t, cat: 'grow' }) },
  };
  function analyzeReview(r) {
    const tips = [];
    const mins = (r.tomorrow || '').length;
    if (mins > 0 && (r.tomorrow || '').split(/[；;。\n]/).filter((x) => x.trim()).length >= 4)
      tips.push('🌿 明天列出了较多事项，留意是否「过度承担」——挑出 1 件最影响长期的事先做完。');
    const words = (r.done + ' ' + r.ignored).split(/\s+|，|,|。|；|;|\n/).filter((w) => w.length >= 2);
    const freq = {}; words.forEach((w) => freq[w] = (freq[w] || 0) + 1);
    const rep = Object.keys(freq).filter((w) => freq[w] >= 3);
    if (rep.length) tips.push('🔁 发现重复出现的主题「' + rep.slice(0, 3).join('、') + '」，可能有「重复消耗」，考虑用系统/模板一次性解决。');
    if ((r.good || '').length && !(r.improve || '').length)
      tips.push('✨ 你记录了很多做得好的地方，很好。也试着写一条「可优化的小步」，成长会更稳。');
    if (!tips.length) tips.push('🪞 暂无明显风险信号。保持节奏，明天继续向前一步。');
    return tips.join('\n');
  }
  function suggestHot(text) {
    const t = (text || '').toLowerCase();
    let col = 'campus', dir = '从你的真实体验出发，做一个具体、可感的角度。';
    if (t.includes('泰国') || t.includes('留学') || t.includes('海外')) { col = 'thailand'; dir = '用「带你看」的视角，记录真实生活与文化差异。'; }
    else if (t.includes('校园') || t.includes('学校') || t.includes('学生') || t.includes('教育')) { col = 'campus'; dir = '讲一个具体的学生/家长故事，比讲道理更打动人。'; }
    else if (t.includes('采访') || t.includes('人物') || t.includes('故事')) { col = 'listens'; dir = '用「听你说」的方式，让人开口讲自己的故事。'; }
    else if (t.includes('商业') || t.includes('创业') || t.includes('机会')) { col = 'listens'; dir = '用一个真实发生的小事开场，讲你的判断和背后的理由，真诚一点。'; }
    return { col, dir };
  }
  /* ---------------- 选题栏目：AI 内容方向建议（本地启发式） ---------------- */
  const SERIES_LIST = ['婧婧听你说', '婧婧带你看泰国', '婧婧带你看校园'];
  // 在三个固定系列中自动匹配最合适的（用户可在编辑里手动改，不自动扩张新系列）
  function matchSeries(text) {
    const t = (text || '').toLowerCase();
    if (/(最重要|重要|值不值得|怎么选|重新选择|感悟|观点|看法|经历|故事|学姐|公司|团队|创业|商业|成长|女性|听你说|你还会|如果.*选|为什么.*选|纠结)/.test(t)) return '婧婧听你说';
    if (/(上课|大学|校园|开学|宿舍|专业|作业|考试|真实上课|食堂|图书馆|教学楼)/.test(t)) return '婧婧带你看校园';
    if (/(泰国|生活|踩坑|注意|避坑|攻略|美食|旅游|签证|电话卡|现金|交通|住宿|消费|物价|文化差异)/.test(t)) return '婧婧带你看泰国';
    if (/(留学|学生|教育|升学)/.test(t)) return '婧婧带你看校园';
    return '婧婧带你看泰国';
  }
  // 输入一个粗糙想法 / 具体标题，产出「内容骨架」（不生成成稿）。
  // 关键铁律：所有内容都必须【绑定到这个具体标题本身】，禁止「可以结合XX」之类泛话。
  // 纯本地启发式、无联网、无法获取平台真实视频 → 结论里明确说明，绝不编造。
  // 链接灵感自动分析：基于抓到的标题/简介，给出「为什么值得参考 / 怎么迁移」（锚定到具体标题）
  function buildInspAnalysis(title, desc, platform, series) {
    const topic = (title || '').trim() || '这条链接';
    const why = '「' + topic + '」——你「' + series + '」已有的真实经验正好能接住它：从你亲历的一个具体场景讲起，比泛泛而谈更可信。'
      + (desc ? '（链接里提到：' + desc.slice(0, 60) + (desc.length > 60 ? '…' : '') + '）' : '');
    const how = '把「' + topic + '」变成你的内容：① 用你自己的口吻重讲一遍（别照搬）；② 补一个你亲历的真实细节 / 反转；③ 落到「' + series + '」能持续做的方向，做成小系列。';
    return { why: why, how: how };
  }
  // 去掉常见虚词，提取标题里有信息量的「焦点词」，让建议真正围绕这个话题本身
  function focusWord(title) {
    const t = (title || '').replace(/(怎么|如何|为什么|吗|呢|啊|吧|的|了|是|一个|可以|应该|需要|攻略|合集|测评|走红|爆火|升温|热|现状|真实|记录|分享|看看|带你看|听你说|！|？|\?|，|,|。|\.|、|：|:|；|;)/g, '');
    return (t.trim() || (title || '')).slice(0, 16);
  }
  // ---- 内容方向知识库：按「三系列 + 信号词」给出真正具体的踩坑点 / 场景 / 受众 / 拍法 ----
  // 纯本地、无联网、无 LLM：用结构化领域知识替代「泛模板」，让每条方向都落到具体画面。
  const DIRECTION_KB = {
    '婧婧带你看泰国': {
      domain: '泰国生活 / 文化差异 / 实用避坑',
      why: '你人就在泰国，第一视角拍真实发生的事，比任何搬运都可信；避坑 / 物价 / 文化差异是搜索量最高、最容易被收藏的三类。',
      scenes: ['刚落地机场', '第一天出门坐突突', '去 7-11 换汇', '交房租那天', '找按摩', '吃街边小吃'],
      pits: [
        { keys: ['打车', '突突', '出租', '交通', '出行', '怎么去'], title: '机场 / 路边打车不打表',
          detail: '刚落地在机场打出租车，司机常直接说 no meter、开口价翻倍；用 Grab 先看好预估再上车，突突车一定要先讲价再上车。',
          shoot: '开头拍「我刚落地在机场，司机过来就说不打表，我当场打开 Grab 给他看价格」' },
        { keys: ['换汇', '汇率', '现金', '钱', '人民币', '取'], title: '7-11 / 路边换汇被吃汇率',
          detail: '在便利店或路边用人民币换泰铢常被压汇率；带银联卡 ATM 直接取，或去 Super Rich 换更划算。',
          shoot: '拍一张机场汇率牌 vs 我 ATM 取款的短信，算清楚差多少' },
        { keys: ['电话卡', '上网', '流量', 'happy', '卡', '网络'], title: '到了才买 tourist 卡被忽悠',
          detail: '机场 happy 卡套餐比市区贵不少；提前在本地店或网上买 AIS / True 旅游卡，确认含流量天数。',
          shoot: '拍我手机里 True 卡套餐页面 + 当场测一下网速' },
        { keys: ['签证', '落地签', '免签', '材料', '照片', '入境'], title: '免签后仍需带够现金 + 落地签照片',
          detail: '免签方便但海关可能抽查现金；落地签要 2 寸白底照片和回程单，现场重拍很贵。',
          shoot: '拍我背包里提前准备的照片 + 回程单，列一张清单' },
        { keys: ['物价', '房租', '生活', '消费', '花', '贵', '便宜', '一个月', '开销'], title: '泰国到底便不便宜',
          detail: '街边小吃很便宜，但商场餐厅、咖啡、房租和国内一二线差不多；房租市中心一居约 8000-15000 泰铢起。',
          shoot: '拍我一周真实账单：吃饭 / 交通 / 房租 / 日用品，逐项报数' },
        { keys: ['注意', '避坑', '坑', '千万别', '警惕', '雷', '别'], title: '第一次来最容易踩的 5 个坑',
          detail: '不打表、换汇亏、突突绕路、按摩店不正规、插座是 Type F 要带转换头。',
          shoot: '列 5 个坑，每个配一个你真实经历的小场景' },
        { keys: ['美食', '吃', '餐厅', '街边', '小吃', '芒果'], title: '街边小吃卫生与价格',
          detail: '认准本地人排队的摊；椰子约 40 泰铢、芒果糯米饭 80-120、船面 50-80。',
          shoot: '拍一个本地人排队的摊 + 我实吃，报价格' },
        { keys: ['住宿', '酒店', '民宿', '公寓', '租房', '住'], title: '租房 / 住哪里',
          detail: '市中心公寓 vs 远郊，通勤和价格权衡；签合同看押金退不退、含不含水电网。',
          shoot: '拍我现在住的房间真实样子 + 报月租' },
        { keys: ['文化', '禁忌', '礼仪', '习俗', '礼貌'], title: '本地文化禁忌',
          detail: '进寺庙遮肩膝、脱鞋；不摸他人头；左手被认为不洁；给小费但不是必须。',
          shoot: '拍我进寺庙穿搭 + 讲 3 个最容易犯的礼仪错' }
      ]
    },
    '婧婧带你看校园': {
      domain: '留学 / 校园真实日常',
      why: '你在校园 / 留学场景里，直接拍真实样子；学生党和家长最爱看「真实不修饰」的内容。',
      scenes: ['开学第一天', '宿舍 unpacking', '食堂打饭', '选课当晚', '期末周'],
      pits: [
        { keys: ['宿舍', '房间', '住', '公寓'], title: '留学 / 大学宿舍真实样子',
          detail: '和国内容易不同：可能一人间或小套，公共厨房洗衣房，电费另算。',
          shoot: '实拍我现在房间，不改造，讲月租和设施' },
        { keys: ['食堂', '吃', '饭', '餐厅'], title: '食堂暗访一餐',
          detail: '看厨房干不干净、一顿多少钱、有没有真好吃的，拍真实体验。',
          shoot: '拍我打饭全过程 + 实际价格牌' },
        { keys: ['选课', '课程', '上课', '考试', '专业'], title: '选课避坑',
          detail: '先修后修顺序、教授给分、要不要抢课，问学长最稳。',
          shoot: '拍我课表 + 讲当时怎么选的' },
        { keys: ['留学', '出国', '准备', '申请', '中介'], title: '如果重新来一次',
          detail: '语言、资金、中介、住宿提前多久准备，踩过的坑列出来。',
          shoot: '清单式口播，4 个我当时踩的坑' },
        { keys: ['差异', '文化', '同学', '老师', '上课'], title: '上课的真实差异',
          detail: '小组作业、发言占比、Office Hour，和国内不一样的点。',
          shoot: '拍一节真实课后的感受 + 具体不一样的地方' }
      ]
    },
    '婧婧听你说': {
      domain: '女性轻创业 / 成长 / 真实故事',
      why: '你正在做女性轻创业 + 内容，真实故事本身就是反焦虑素材；用「听你说」让人开口。',
      scenes: ['做副业第一个月', '被学妹问', '采访朋友', '深夜复盘'],
      pits: [
        { keys: ['创业', '副业', '变现', '收入', '赚钱', '赚'], title: '我做副业第一年真实收入',
          detail: '内容副业从 0 到第一笔收入的时间线；别只说「能赚」，把账单 / 后台数据拍出来。',
          shoot: '拍后台数据 / 账单，讲哪个月开始有第一笔收入' },
        { keys: ['学姐', '说', '过来人', '经验', '问'], title: '学弟学妹问我最多的 3 个问题',
          detail: '具体提问 + 你的真实回答，不灌鸡汤。',
          shoot: '拍一条提问截图 + 口播回答' },
        { keys: ['故事', '经历', '真实', '听你说', '采访', '人物'], title: '采访一个真实的人',
          detail: '找一个留学生 / 创业者，听他说，不替他总结。',
          shoot: '对谈形式，开头抛一个具体问题' },
        { keys: ['焦虑', '选择', '纠结', '迷茫', '怕'], title: '我当年也这样，后来…',
          detail: '讲一个具体的小事 + 转折，给共鸣，不贩卖焦虑。',
          shoot: '开头「我曾经也…，后来…」' },
        { keys: ['女性', '成长', '独立'], title: '女性做内容是不是更吃亏 / 更吃香',
          detail: '从你真实体验讲，不喊口号。',
          shoot: '讲一个你遇到的具体偏见或机会' }
      ]
    }
  };
  // 简易「是否重复」检测：扫描已有选题，命中共享 2 字词组则提示，避免重复发
  function findDup(title) {
    const base = (title || '').replace(/[\s！!，,。.、：:？?；;]/g, '');
    if (base.length < 3) return [];
    const tok = (s) => new Set((s.match(/[一-龥]{2}/g) || []));
    const A = tok(base);
    const res = [];
    (App.state.content || []).forEach((c) => {
      if (!c.title || c.kind === 'link' || c.kind === 'note') return;
      const ct = c.title.replace(/[\s！!，,。.、：:？?；;]/g, '');
      if (ct.includes(base) || base.includes(ct)) { res.push(c.title); return; }
      if (base.length >= 4 && ct.length >= 4) {
        const B = tok(ct); let n = 0; A.forEach((t) => { if (B.has(t)) n++; });
        if (n >= 2) res.push(c.title);
      }
    });
    return res.slice(0, 3);
  }
  // 内容方向建议：用知识库产出「具体到可拍」的内容，不再泛泛而谈
  function suggestDirection(title, idea) {
    const raw = (title || '') + ' ' + (idea || '');
    const t = raw.toLowerCase();
    const topic = (title || '').trim() || '这个想法';
    const series = matchSeries(raw);
    const kb = DIRECTION_KB[series] || DIRECTION_KB['婧婧带你看泰国'];
    // 选最匹配的坑点：标题 + 想法里命中 keys 最多的排前面
    const scored = kb.pits.map((p) => ({ p, hit: p.keys.filter((k) => raw.includes(k)).length })).sort((a, b) => b.hit - a.hit);
    const matched = scored.filter((x) => x.hit > 0).map((x) => x.p);
    const top = matched[0] || kb.pits[0];
    const focus = focusWord(topic);
    const isAvoid = /(注意|避坑|坑|千万别|警惕|雷|别|防)/.test(t);
    // 开头（前 3 秒）：给一个具体可拍的场景，不绕弯子
    let hook = '开头（前 3 秒）直接上具体画面，不要念标题：' + (top.shoot || ('拍你最近一次关于「' + focus + '」的真实画面'));
    if (isAvoid) hook += '。避坑类可说「我在泰国第 N 天，刚踩了一个坑——」';
    // 具体内容：把命中的坑点摊开成「具体能讲的点」（禁止只说「注意交通/现金/签证」）
    const pickList = (isAvoid && matched.length < 3) ? kb.pits.slice(0, 3) : (matched.length ? matched : kb.pits.slice(0, 3));
    let about;
    if (isAvoid) {
      about = '别只说「注意交通 / 现金 / 签证」，要逐个拆成具体场景：\n' + pickList.map((p, i) => (i + 1) + '. ' + p.title + '：' + p.detail).join('\n');
    } else if (matched.length) {
      about = '围绕「' + topic + '」可以讲的具体点：\n' + matched.map((p, i) => (i + 1) + '. ' + p.title + '：' + p.detail).join('\n');
    } else {
      about = '围绕「' + topic + '」先锁定一个你真实经历过的侧面（例如：' + kb.scenes.slice(0, 3).join(' / ') + '），用具体画面讲，不要只下结论。';
    }
    // 具体拍法
    const shoot = '拍摄：' + (top.shoot || '用第一视角拍你正在做的那件事') + '。' + kb.why +
      ' 中段把上面的点逐个讲清楚（每个配一个真实画面），结尾给一个观众今天能用的小动作或一句开放提问。';
    // 延伸选题
    const extend = [
      '同一坑点的「进阶版」：把上面一个点从头到尾走一遍',
      '反向选题：「我做对了的 3 件事」',
      '同系列联动：和「' + series + '」另一期串成小系列'
    ].join('；');
    // 额外：为什么适合我的账号 / 可参考案例 / 是否重复
    let extraLabel = '为什么适合我的账号', extra = kb.why;
    if (/(案例|真实|经历|故事|亲历)/.test(t)) { extraLabel = '可加入的真实案例'; extra = '用你亲历的一个关于「' + top.title + '」的具体小事当主线，比列观点更抓人。'; }
    else if (/(家长|学生|女生|女性|小白|新手|普通人)/.test(t)) { extraLabel = '目标受众'; extra = '开头点明「这条讲给谁听」：关于「' + focus + '」，让家长 / 学生 / 小白一眼觉得和自己有关。'; }
    else if (/(赚钱|副业|创业|变现|收入)/.test(t)) { extraLabel = '可参考的真实数据'; extra = '别只说「能赚」——把你的后台数据 / 账单拍出来，讲清楚从 0 到第一笔收入花了多久。'; }
    const dup = findDup(topic);
    if (dup.length) extra += ' ⚠️ 已有相似选题「' + dup.join('、') + '」，建议换切入或不重复发。';
    return { hook: hook, about: about, shoot: shoot, series: series, extend: extend, extra: extra, extraLabel: extraLabel, pits: matched.map((p) => p.title) };
  }

  function renderDirection(x) {
    const d = x.direction; if (!d) return '';
    const series = x.series || d.series || '婧婧带你看泰国';
    const topic = (x.title || '').trim() || '这个想法';
    const hook = d.hook || ('从「' + topic + '」切入，抓住观众最关心的真实痛点。');
    const about = d.about || ('围绕「' + topic + '」拆成几个具体侧面，用你亲历的细节讲具体。');
    const shoot = d.shoot || '用你最自然的方式讲——学姐视角、真实经历、少修饰。';
    const extend = d.extend || '同一主题的更多角度、听众自己的故事、可做成系列的几集方向。';
    // 诚实说明「我没法自动抓到别人的具体视频」（平台 CORS 限制），但给可借的具体形式 / 场景
    let refOther;
    if (x.link && x.linkType === 'real') {
      refOther = '原内容链接已存（见上方「具体内容链接」），点开直接看别人怎么拍；重点学它的【开头钩子 / 中段结构 / 结尾留互动】，换成你的口吻。';
    } else {
      const kb = DIRECTION_KB[series];
      const scenes = kb ? kb.scenes : [];
      const pits = (d.pits && d.pits.length) ? d.pits : [];
      refOther = '我无法自动抓到别人具体视频（平台 CORS 限制，不伪装）。你可以借：① 点开原链接看【开头钩子 / 中段结构 / 结尾留互动】换成你的口吻；② 下面这些可拍的具体场景任选一个做你的版本：' + (pits.length ? pits.join('、') : scenes.slice(0, 3).join('、')) + '。';
    }
    const myAngle = d.extra ? ('【' + (d.extraLabel || '补充') + '】' + d.extra) : ('从你「' + series + '」的身份出发，讲你最真实的一次经历。');
    const open = App.folds['dir-' + x.id] ? 'open' : '';
    return `<div class="fold ${open}">
      <div class="fold-head" data-act="fold" data-target="dir-${x.id}"><span class="arrow">▸</span><span class="fold-t">内容方向建议（点击展开）</span></div>
      <div class="fold-body"><div class="dir-box">
        <div class="dir-seg"><b>【这个话题】</b>${esc(topic)}</div>
        <div class="dir-seg"><b>【别人常见怎么做】</b>${esc(refOther)}</div>
        <div class="dir-seg"><b>【我可以怎么借】</b>${esc(hook)}</div>
        <div class="dir-seg"><b>【我可以拍成什么】</b>${esc(about)}</div>
        <div class="dir-seg"><b>【参考拍摄方式】</b>${esc(shoot)}</div>
        <div class="dir-seg"><b>【我的内容切入】</b>${esc(myAngle)}</div>
        <div class="dir-seg"><b>【推荐系列】</b>${renderSeriesTag(series)}</div>
        <div class="dir-seg"><b>【延伸选题】</b>${esc(extend)}</div>
      </div></div></div>`;
  }
  // 重新生成方向：不直接覆盖旧版。生成「新版本」与「当前版本」并列对比，由用户选「使用新版 / 保留旧版」。
  // 旧版会留存（最多保留最近 3 个历史版本），当前版本不会因误触消失。
  function genDir(id) {
    const x = App.state.content.find((c) => c.id === id); if (!x) return;
    const cur = x.direction || suggestDirection(x.title, x.idea);
    const nv = suggestDirection(x.title, x.idea);
    const cmp = (label, a, b) => `<div class="vd-col"><div class="vd-h">${label}</div><div class="vd-old">${esc(a || '（无）')}</div><div class="vd-new">${esc(b)}</div></div>`;
    showModal(`<h3>✨ 生成内容方向（新版本）</h3>
      <div class="tiny muted" style="margin-bottom:10px">不会直接覆盖旧版：对比后选「使用新版」或「保留旧版」。旧版已留存，可随时再次生成替换。</div>
      <div class="vd-box">
        ${cmp('核心判断（我可以怎么借）', cur.hook, nv.hook)}
        ${cmp('可以拍成什么', cur.about, nv.about)}
        ${cmp('参考拍摄方式', cur.shoot, nv.shoot)}
        ${cmp('推荐系列', cur.series || '—', nv.series)}
        ${cmp('延伸选题', cur.extend, nv.extend)}
      </div>
      <div class="modal-actions">
        <button class="btn ghost" data-act="close-modal">保留旧版</button>
        <button class="btn" id="useNewDir">使用新版</button>
      </div>`);
    modalBox.querySelector('#useNewDir').onclick = () => {
      x.directionVersions = [{ hook: cur.hook, about: cur.about, shoot: cur.shoot, series: cur.series, extend: cur.extend, ts: Date.now() }].concat(x.directionVersions || []).slice(0, 3);
      x.direction = nv; x.series = nv.series; x.col = SERIES_COL[nv.series] || x.col;
      save(); closeModal(); renderContent();
      toast('已用新版本替换，旧版已留存可回看 🔁');
    };
  }

  /* ============================================================
   *  渲染：今日工作台
   * ============================================================ */
  function renderToday() {
    const s = App.state, td = today();
    // 首页数字点击跳转：过滤视图（真实任务，不复制；数量与来源严格一致）
    if (App.todayFilter) {
      const list = App.todayFilter === 'todo'
        ? s.tasks.filter((t) => !t.canceled && !t.done && (t.type === 'core' || t.type === 'todo') && t.date === td)
        : s.tasks.filter((t) => !t.canceled && t.done && (t.doneAt || t.date) === td);
      const label = App.todayFilter === 'todo' ? '今日待办（核心 + 普通）' : '今日已完成';
      let h = `<div class="hero"><div class="hi">${greet()}</div><div class="big">${label}</div>
        <div class="sub">${list.length} 项 · 真实任务</div></div>`;
      h += `<div class="card"><h3>✅ ${label} <span class="tag">${list.length} 项</span></h3>`;
      h += list.length ? list.map(taskRow).join('') : `<div class="empty"><span class="em">🌿</span>这里还没有任务。</div>`;
      h += `</div><div style="margin-top:10px"><button class="btn ghost sm" data-act="today-clear-filter">← 返回每日进度</button></div>`;
      $('#view').innerHTML = h; return;
    }
    const tasks = s.tasks.filter((t) => !t.canceled);
    const core = tasks.filter((t) => t.type === 'core' && t.date === td && !t.done);
    const todo = tasks.filter((t) => t.type === 'todo' && t.date === td && !t.done);
    const temp = tasks.filter((t) => t.type === 'temp' && t.date === td && !t.done);
    const pending = tasks.filter((t) => t.date < td && !t.done);
    const doneToday = tasks.filter((t) => t.done && (t.doneAt || t.date) === td);

    // —— 每日进步：顶部轻量区 + 下方四个独立模块（同源 tasks；顶部只轻量显示「今天完成 X 条」可点击，不展示完成任务列表）——
    const cnDate = `${td.slice(0, 4)}年${+td.slice(5, 7)}月${+td.slice(8, 10)}日`;
    // 【顶部轻量区域】
    let html = `<div class="card daily-top">
      <div class="daily-top-head">
        <div class="hi">${greet()}</div>
        <div class="big">今天，先推进最重要的事</div>
        <div class="sub">${cnDate}</div>
      </div>`;
    // 「今天完成 X 条」轻量入口：点击进入今日已完成真实过滤视图（todayFilter='done'；直接读 App.state.tasks，不复制/不新建）
    html += `<button class="done-entry" data-act="home-jump" data-kind="done">
      <span class="de-ic">✓</span><span class="de-t">今天完成</span><span class="de-n">${doneToday.length}</span><span class="de-arrow">条 →</span>
    </button>`;
    html += `</div>`;

    // 🎯 今日必做（核心推进）—— 独立模块
    html += `<div class="card"><h3>🎯 今日必做 <span class="tag">核心推进</span></h3>`;
    html += core.length ? core.map(taskRow).join('') : `<div class="empty"><span class="em">🎯</span>今天还没有必须推进的核心事项。</div>`;
    html += `<div class="quick-add"><input id="qa-core" placeholder="今天最影响长期发展的一件事…">
      <button class="btn sm" data-act="add-task" data-type="core">添加</button></div></div>`;

    // 📝 今日待办 —— 独立模块
    html += `<div class="card"><h3>📝 今日待办 <span class="tag">普通任务</span></h3>`;
    html += todo.length ? todo.map(taskRow).join('') : `<div class="empty"><span class="em">🍃</span>暂无待办，轻松一点。</div>`;
    html += `<div class="quick-add"><input id="qa-todo" placeholder="添加一个普通任务…">
      <button class="btn soft sm" data-act="add-task" data-type="todo">添加</button></div></div>`;

    // ↗ 需要继续推进（未完成旧事项；默认折叠，点标题展开）—— 独立模块
    if (pending.length) {
      const open = App.folds['pending'];
      html += `<div class="card"><h3 class="fold-h" data-act="toggle-fold" data-id="pending">
        <span class="fold-ic">${open ? '▾' : '▸'}</span>↗ 需要继续推进
        <span class="tag">${pending.length} 项来自之前的日子${open ? '' : ' · 点此展开'}</span></h3>`;
      if (open) {
        html += pending.map((t) => {
          const acts = `<button class="mini green" data-act="cont-task" data-id="${t.id}">继续今天</button>
            <button class="mini" data-act="defer-task" data-id="${t.id}">延期</button>
            <button class="mini ghost" data-act="cancel-task" data-id="${t.id}">取消</button>`;
          return taskRow(t, acts);
        }).join('');
      } else {
        html += `<div class="tiny muted" style="margin-top:-4px">这些是之前没做完的事，不急，有空再处理。展开后可「继续今天 / 延期 / 取消」。</div>`;
      }
      html += `</div>`;
    }

    // ⚡ 临时记录（点击打开大编辑器）—— 独立模块
    html += `<div class="card"><h3>⚡ 临时记录 <span class="tag">点击打开大编辑器</span></h3>`;
    html += temp.length ? temp.map(taskRow).join('') : `<div class="empty"><span class="em">💭</span>突然的想法、老板安排、客户回复，都能随手记这里。</div>`;
    html += `<div style="margin-top:8px"><button class="btn soft sm" data-act="home-add-temp-modal">＋ 写一下临时记录</button></div></div>`;

    $('#view').innerHTML = html;
    bindQuickAdd();
  }

  function greet() {
    const h = new Date().getHours();
    if (h < 6) return '夜深了，jinn';
    if (h < 11) return '早上好，jinn';
    if (h < 14) return '中午好，jinn';
    if (h < 18) return '下午好，jinn';
    return '晚上好，jinn';
  }

  function taskRow(t, extra) {
    const chk = t.cat === 'grow' || t.cat === 'content' ? 'green' : '';
    const cat = t.cat ? `<span class="chip ${catClass(t.cat)}">${catName(t.cat)}</span>` : '';
    const typ = t.type === 'core' ? '<span class="chip">核心</span>' : t.type === 'temp' ? '<span class="chip">临时</span>' : '';
    const acts = (extra || '') +
      `<button class="mini ghost" data-act="edit-task" data-id="${t.id}">编辑</button>
       <button class="mini ghost" data-act="del-task" data-id="${t.id}">删除</button>`;
    return `<div class="task-row">
      <div class="check ${chk} ${t.done ? 'done' : ''}" data-act="toggle-task" data-id="${t.id}">${t.done ? '✓' : ''}</div>
      <div class="task-main">
        <div class="task-title ${t.done ? 'done' : ''}">${esc(t.title)}</div>
        <div class="task-meta">${cat}${typ}${t.date && t.date !== today() ? '<span class="chip">原 ' + t.date + '</span>' : ''}</div>
      </div>
      <div class="row-actions">${acts}</div>
    </div>`;
  }


  function bindQuickAdd() {
    [['qa-core', 'core'], ['qa-todo', 'todo']].forEach(([id, type]) => {
      const el = $('#' + id); if (!el) return;
      const add = () => { const v = el.value.trim(); if (!v) return; addTask(type, v); el.value = ''; };
      el.onkeydown = (e) => { if (e.key === 'Enter') add(); };
    });
  }
  function addTask(type, title, date, cat) {
    const s = App.state;
    if (!title) return;
    const d = date || today();
    if (type === 'core' && s.tasks.filter((t) => t.type === 'core' && t.date === d && !t.done && !t.canceled).length >= 3) {
      toast('核心推进最多 3 项，先完成或调整已有的 🌟'); return;
    }
    s.tasks.push({ id: uid(), type, title, cat: cat || '', date: d, done: false, canceled: false, order: Date.now() });
    save(); render();
  }

  /* ============================================================
   *  渲染：首页（个人工作驾驶舱）——轮次 M
   *  数据安全：全部读现有数据，不新建第二套库、不写示例、不迁移字段。
   *  - 快速添加任务 / 临时记录 → 复用 s.tasks（type=addTask 现有逻辑）
   *  - 今日状态 → 读 english/health/income 本月打卡天数（distinct day）
   *  - 拍摄计划 → 读 content.status==='待制作'
   *  - 重要日期 → 读 s.dates（ensure 仅补空数组）
   *  - 成长痕迹 → 读 tasks.filter(done)
   *  - 金句 → 内置池中英文池，按日切换，不写 state、不调第三方 API
   * ============================================================ */
  // 中国法定节假日 + 传统节日（2026–2030 内置表；代码常量，不写入用户 state，不可被用户修改）
  // 春节/元宵/端午/中秋/重阳为农历，按标准农历日历推算；2030 之后年份本表不覆盖（可后续续表）。
  const CN_HOLIDAYS = [
    { title: '元旦', date: '2026-01-01', kind: 'statutory' },
    { title: '春节', date: '2026-02-17', kind: 'statutory' },
    { title: '元宵', date: '2026-03-03', kind: 'tradition' },
    { title: '除夕', date: '2026-02-16', kind: 'tradition' },
    { title: '清明', date: '2026-04-05', kind: 'statutory' },
    { title: '劳动节', date: '2026-05-01', kind: 'statutory' },
    { title: '端午', date: '2026-06-19', kind: 'statutory' },
    { title: '中秋', date: '2026-09-25', kind: 'statutory' },
    { title: '国庆', date: '2026-10-01', kind: 'statutory' },
    { title: '重阳', date: '2026-10-19', kind: 'tradition' },
    { title: '元旦', date: '2027-01-01', kind: 'statutory' },
    { title: '春节', date: '2027-02-06', kind: 'statutory' },
    { title: '元宵', date: '2027-02-20', kind: 'tradition' },
    { title: '除夕', date: '2027-02-05', kind: 'tradition' },
    { title: '清明', date: '2027-04-05', kind: 'statutory' },
    { title: '劳动节', date: '2027-05-01', kind: 'statutory' },
    { title: '端午', date: '2027-06-09', kind: 'statutory' },
    { title: '中秋', date: '2027-09-15', kind: 'statutory' },
    { title: '国庆', date: '2027-10-01', kind: 'statutory' },
    { title: '重阳', date: '2027-10-09', kind: 'tradition' },
    { title: '元旦', date: '2028-01-01', kind: 'statutory' },
    { title: '春节', date: '2028-01-27', kind: 'statutory' },
    { title: '元宵', date: '2028-02-10', kind: 'tradition' },
    { title: '除夕', date: '2028-01-26', kind: 'tradition' },
    { title: '清明', date: '2028-04-04', kind: 'statutory' },
    { title: '劳动节', date: '2028-05-01', kind: 'statutory' },
    { title: '端午', date: '2028-05-28', kind: 'statutory' },
    { title: '中秋', date: '2028-09-03', kind: 'statutory' },
    { title: '国庆', date: '2028-10-01', kind: 'statutory' },
    { title: '重阳', date: '2028-09-27', kind: 'tradition' },
    { title: '元旦', date: '2029-01-01', kind: 'statutory' },
    { title: '春节', date: '2029-02-13', kind: 'statutory' },
    { title: '元宵', date: '2029-02-27', kind: 'tradition' },
    { title: '除夕', date: '2029-02-12', kind: 'tradition' },
    { title: '清明', date: '2029-04-04', kind: 'statutory' },
    { title: '劳动节', date: '2029-05-01', kind: 'statutory' },
    { title: '端午', date: '2029-06-15', kind: 'statutory' },
    { title: '中秋', date: '2029-09-21', kind: 'statutory' },
    { title: '国庆', date: '2029-10-01', kind: 'statutory' },
    { title: '重阳', date: '2029-10-16', kind: 'tradition' },
    { title: '元旦', date: '2030-01-01', kind: 'statutory' },
    { title: '春节', date: '2030-02-03', kind: 'statutory' },
    { title: '元宵', date: '2030-02-17', kind: 'tradition' },
    { title: '除夕', date: '2030-02-02', kind: 'tradition' },
    { title: '清明', date: '2030-04-05', kind: 'statutory' },
    { title: '劳动节', date: '2030-05-01', kind: 'statutory' },
    { title: '端午', date: '2030-06-04', kind: 'statutory' },
    { title: '中秋', date: '2030-09-11', kind: 'statutory' },
    { title: '国庆', date: '2030-10-01', kind: 'statutory' },
    { title: '重阳', date: '2030-10-05', kind: 'tradition' },
  ];

  function renderHome() {
    const s = App.state;
    const td = today();

    // —— 今日任务概览（首屏信息密度）——
    // 待办口径（用户指定）：今日未完成的「正式任务」= core + todo，不含 temp 临时记录
    const todayTasks = s.tasks.filter((t) => !t.canceled && t.date === td);
    const todayDone = todayTasks.filter((t) => t.done).length;
    const todayTodo = todayTasks.filter((t) => !t.done && (t.type === 'core' || t.type === 'todo')).length;

    // —— 本月财富打卡天数（真实收入记录，不参与习惯打卡）——
    const incDays = new Set(s.income.filter((i) => (i.date || '').slice(0, 7) === td.slice(0, 7)).map((i) => i.date));

    // —— 拍摄计划：内容宇宙 status=待制作 ——
    const shoot = s.content.filter((c) => c.status === '待制作');

    // —— 下一个重要日子：系统节假日(未来) + 用户自定义(未来)，取最近一个 ——
    const holNext = CN_HOLIDAYS.filter((h) => h.date >= td).map((h) => ({ title: h.title, date: h.date }));
    const cusNext = (s.dates || []).filter((d) => d.date >= td).map((d) => ({ title: d.title, date: d.date }));
    const allNext = holNext.concat(cusNext).sort((a, b) => a.date.localeCompare(b.date));
    const nx = allNext[0] || null;
    const days = nx ? Math.round((new Date(nx.date).getTime() - new Date(td).getTime()) / 86400000) : 0;

    // 今日金句（中英文，按日确定切换）
    const q = homeQuote();

    // 今日份进步：配置驱动的习惯打卡
    const habits = (s.habits || []).filter((h) => h.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
    const doneHabits = habits.filter((h) => isHabitDoneToday(h)).length;

    let html = '';

    // —— 重要日期紧凑 chip（顶部右侧；点击打开详情）——
    const dateChip = nx
      ? `<button class="hh-date-chip" data-act="home-date-manage" title="${esc(nx.title)} · 还有 ${days} 天">
           <span class="hdc-ico">📅</span><span class="hdc-k">${esc(nx.title)}</span>
           <span class="hdc-d">${nx.date.slice(5).replace('-', '/')}${nx.date === td ? ' · 今天' : ' · ' + days + '天'}</span>
         </button>`
      : `<button class="hh-date-chip muted" data-act="home-date-manage" title="添加一个重要日期">
           <span class="hdc-ico">📅</span><span class="hdc-k">无重要日期</span>
           <span class="hdc-d">＋ 添加</span>
         </button>`;

    // —— 顶部区域：hero（问候 + 金句 + 今日概览 + 重要日期 chip）——
    html += `<div class="home-hero">
      <div class="hh-top">
        <div class="hh-greet">${greet()}<span class="hh-date">${td}</span></div>
        ${dateChip}
      </div>
      <div class="hh-quote">
        <span class="hh-qmark">“</span>
        <div class="hh-qt">${esc(q.zh)}</div>
        <div class="hh-qe">${esc(q.en)}</div>
      </div>
      <div class="hh-stats">
        <div class="hh-pill clickable" data-act="home-jump" data-kind="todo"><span class="n">${todayTodo}</span><span class="l">待办 · 点看</span></div>
        <div class="hh-pill ${todayDone ? 'clickable' : ''}" ${todayDone ? 'data-act="home-jump" data-kind="done"' : ''}><span class="n">${todayDone}</span><span class="l">已完成 · 点看</span></div>
        <div class="hh-pill clickable" data-act="home-jump" data-kind="check"><span class="n">${doneHabits}/${habits.length || 0}</span><span class="l">打卡 · 点看</span></div>
      </div>
      <button class="mini ghost hh-qbtn" data-act="home-quote">换一句 ✦</button>
    </div>`;

    // —— 快速添加任务 ——
    html += `<div class="card hmod hmod-add">
      <div class="hmod-head"><span class="hmod-ic">📝</span><h3>快速添加任务</h3><span class="hbadge">写任务名 + 选区域</span></div>
      <div class="home-add">
        <input id="home-task-title" placeholder="今天要做的任务…">
        <div class="home-add-acts">
          <select id="home-task-cat" aria-label="区域">
            ${TASK_CATS.map((o) => `<option value="${o.v}">${o.t}</option>`).join('')}
          </select>
          <button class="btn sm" data-act="home-add-task">＋ 添加</button>
          <button class="btn ghost sm" data-act="home-clear-task">清空</button>
        </div>
      </div>
      <div class="hadd-hint">回车也能保存 · 自动进入「今日待办」</div>
    </div>`;

    // —— 临时记录：便签样式 ——
    html += `<div class="card hmod hmod-temp">
      <div class="hmod-head"><span class="hmod-ic">📌</span><h3>临时记录</h3><span class="hbadge">便签 · 点一下写</span></div>
      <div class="home-temp-trigger" data-act="home-add-temp-modal"><span class="ht-pin">📌</span><span class="ht-line">记下现在想到的事情……</span></div>
      <div class="tiny muted">点上方区域打开大面积编辑器，取消不保存</div>
    </div>`;

    // —— 今日份进步：打卡感卡片 ——
    const habitBoxes = habits.map((h) => {
      const done = isHabitDoneToday(h);
      const md = habitMonthDays(h);
      return `<div class="home-check ${done ? 'on' : ''}" data-act="home-toggle-checkin" data-id="${h.id}">
        <span class="box">${done ? '✓' : ''}</span>
        <span class="ic">${esc(h.icon || '🌱')}</span>
        <span class="lab">${esc(h.name)}</span>
        <span class="md">本月 ${md} 天</span>
        ${done ? '<button class="mini ghost" data-act="home-edit-note" data-id="' + h.id + '" style="margin-left:auto">＋ 备注</button>' : ''}
      </div>`;
    }).join('') || '<div class="muted tiny">还没有习惯，点右下角「管理」添加。</div>';
    html += `<div class="card hmod hmod-prog">
      <div class="hmod-head"><span class="hmod-ic">🌟</span><h3>今日份进步</h3><span class="hbadge">打卡 ${doneHabits}/${habits.length || 0}</span><button class="hbtn" data-act="home-habit-manage">⚙ 管理</button></div>
      <div class="home-checks">${habitBoxes}</div>
      <div class="home-income">💰 财富 · 本月 ${incDays.size} 天（真实收入记录，不参与打卡）</div>
    </div>`;

    // —— 拍摄计划（折叠式；纯展示，不动 content 数据）——
    if (shoot.length) {
      const open = App.folds['shoot'];
      html += `<div class="card hmod hmod-shoot">
        <div class="hmod-head fold-h" data-act="toggle-fold" data-id="shoot">
          <span class="hmod-ic">🎬</span><h3>拍摄计划</h3>
          <span class="fold-ic">${open ? '▾' : '▸'}</span><span class="hbadge">待制作 ${shoot.length}</span>
        </div>`;
      if (open) {
        html += `<div class="home-list">` + shoot.map((c) => {
          const se = seriesOf(c);
          return `<div class="home-li" data-act="nav" data-id="content"><span class="home-li-t">${esc(c.title || '(未命名选题)')}</span>${renderSeriesTag(se)}</div>`;
        }).join('') + `</div>`;
      } else {
        html += `<div class="tiny muted" style="margin-top:2px">点上方标题展开全部 ${shoot.length} 条待制作选题。</div>`;
      }
      html += `</div>`;
    }

    // —— 最近成长痕迹（折叠式；同源 tasks；展开显示全部，不做 6 条上限）——
    const traceAll = s.tasks.filter((t) => t.done && !t.canceled)
      .sort((a, b) => String(b.doneAt || b.date || '').localeCompare(String(a.doneAt || a.date || '')));
    const tracePreview = traceAll.slice(0, 6); // 仅折叠态摘要用；展开渲染全部 traceAll
    const traceOpen = App.folds['trace'];
    html += `<div class="card hmod hmod-trace">
      <div class="hmod-head fold-h" data-act="toggle-fold" data-id="trace">
        <span class="hmod-ic">📚</span><h3>最近成长痕迹</h3>
        <span class="fold-ic">${traceOpen ? '▾' : '▸'}</span><span class="hbadge">${traceAll.length} 条</span>
      </div>`;
    // 「看全部」常驻：折叠态也可点；点击展开成长痕迹并进入成长地图（显示全部真实完成任务）
    html += `<div style="margin:8px 0 2px"><button class="btn soft sm" data-act="trace-see-all">看全部 →</button></div>`;
    if (traceOpen) {
      if (traceAll.length) {
        html += `<div class="home-list">` + traceAll.map((t) =>
          `<div class="home-li" data-act="nav" data-id="growth"><span class="home-li-t">${esc(t.title)}</span>${t.cat ? `<span class="chip ${catClass(t.cat)}">${catName(t.cat)}</span>` : ''}</div>`
        ).join('') + `</div>`;
      } else {
        html += `<div class="empty"><span class="em">📚</span>还没有完成的记录。</div>`;
      }
    } else if (tracePreview.length) {
      html += `<div class="tiny muted" style="margin-top:2px">最新：${esc(tracePreview[0].title)}　·　点标题展开全部 ${traceAll.length} 条</div>`;
    }
    html += `</div>`;

    $('#view').innerHTML = html;
    setPage('首页');
    bindHomeQuickAdd();
  }

  function bindHomeQuickAdd() {
    const t = $('#home-task-title');
    if (t) t.onkeydown = (e) => { if (e.key === 'Enter') homeAddTask(); };
  }
  function homeAddTask() {
    const inp = $('#home-task-title'); const sel = $('#home-task-cat');
    const v = inp ? inp.value.trim() : '';
    const cat = sel ? sel.value : '';
    // 正式任务类：统一走 editTask 表单（类型 + 分类 + 日期），单一来源 TASK_TYPES/TASK_CATS
    editTask(null, { type: 'todo', cat, title: v, date: today() });
    if (inp) inp.value = '';
    if (sel) sel.value = 'edu';
  }
  // 临时记录：点击进入大面积备忘录编辑（复用 tasks type='temp'，不建第二套）
  function homeAddTempModal() {
    openForm('临时记录', [{ key: 'text', label: '', type: 'textarea', cls: 'temp-area', placeholder: '临时事项 / 灵感 / 想法…', value: '' }], null, (fd) => {
      const v = (fd.text || '').trim(); if (!v) { toast('没有内容，未保存'); return; }
      addTask('temp', v); toast('已记到临时记录 💭');
    });
  }
  // 今日份进步：配置驱动的习惯打卡（兼容层）。
  // 不写死英语/健康：通过 s.habits 配置驱动；kind=english/health 复用原 english/health 数组（仅新增 checkin 标记，旧记录零迁移）；
  // kind=custom 用新数组 s.habitLogs。删除习惯只删配置，历史数据完全保留。
  function habitSource(habit) {
    if (!habit) return null;
    if (habit.kind === 'english') return App.state.english;
    if (habit.kind === 'health') return App.state.health;
    if (habit.kind === 'custom') return App.state.habitLogs;
    return null;
  }
  function isHabitDoneToday(habit) {
    if (!habit) return false;
    const td = today();
    if (habit.kind === 'english' || habit.kind === 'health') {
      const arr = habitSource(habit);
      return Array.isArray(arr) && arr.some((r) => r.date === td && r.checkin === true);
    }
    if (habit.kind === 'custom') {
      return App.state.habitLogs.some((r) => r.habitId === habit.id && r.date === td);
    }
    return false;
  }
  function habitMonthDays(habit) {
    if (!habit) return 0;
    const month = today().slice(0, 7);
    if (habit.kind === 'english' || habit.kind === 'health') {
      const arr = habitSource(habit) || [];
      return new Set(arr.filter((r) => r.date && r.date.slice(0, 7) === month && r.checkin === true).map((r) => r.date)).size;
    }
    if (habit.kind === 'custom') {
      return new Set(App.state.habitLogs.filter((r) => r.habitId === habit.id && r.date && r.date.slice(0, 7) === month).map((r) => r.date)).size;
    }
    return 0;
  }
  // 切换打卡：已完成→轻量确认后取消（仅删今日 checkin 标记）；未完成→新增今日标记。历史数据零影响。
  function toggleHabit(habitId) {
    const s = App.state;
    const habit = s.habits.find((h) => h.id === habitId);
    if (!habit) return;
    const td = today();
    if (isHabitDoneToday(habit)) {
      if (habit.kind === 'english' || habit.kind === 'health') {
        const arr = habitSource(habit);
        for (let i = arr.length - 1; i >= 0; i--) {
          if (arr[i].date === td && arr[i].checkin === true) arr.splice(i, 1);
        }
      } else if (habit.kind === 'custom') {
        s.habitLogs = s.habitLogs.filter((r) => !(r.habitId === habit.id && r.date === td));
      }
      save(); render(); toast('已取消今日打卡');
    } else {
      if (habit.kind === 'english') {
        s.english.push({ id: uid(), type: '今日打卡', minutes: 0, date: td, note: '', checkin: true });
      } else if (habit.kind === 'health') {
        s.health.push({ id: uid(), sleep: '', exercise: '', state: '好', date: td, note: '', checkin: true });
      } else if (habit.kind === 'custom') {
        s.habitLogs.push({ id: uid(), habitId: habit.id, date: td, note: '', createdAt: td });
      }
      save(); render(); toast('今日「' + habit.name + '」已打卡 ✓');
    }
  }
  // 添加备注（可选）：只更新今天的打卡记录
  function editHabitNote(habitId) {
    const s = App.state;
    const habit = s.habits.find((h) => h.id === habitId);
    if (!habit) return;
    const td = today();
    let rec = null;
    if (habit.kind === 'english') rec = s.english.find((r) => r.date === td && r.checkin === true);
    else if (habit.kind === 'health') rec = s.health.find((r) => r.date === td && r.checkin === true);
    else if (habit.kind === 'custom') rec = s.habitLogs.find((r) => r.habitId === habit.id && r.date === td);
    if (!rec) { toast('今天还没打卡，先点方框 ✓'); return; }
    const fields = habit.kind === 'english'
      ? [{ key: 'minutes', label: '学习时长（分钟，可选）', value: rec.minutes || '' }, { key: 'note', label: '备注（可选）', type: 'textarea', value: rec.note || '' }]
      : [{ key: 'note', label: '备注（可选）', type: 'textarea', value: rec.note || '' }];
    openForm('添加备注 · ' + habit.name, fields, null, (fd) => {
      if (habit.kind === 'english') rec.minutes = Number(fd.minutes) || 0;
      rec.note = fd.note || '';
      save(); render(); toast('已保存备注 🌿');
    });
  }
  // 习惯管理：新增 / 编辑 / 删除（删除仅删配置，历史数据完全保留）
  function homeHabitManage() {
    const s = App.state;
    if (!Array.isArray(s.habits)) s.habits = [];
    const rows = s.habits.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((h) => {
      const off = h.active === false ? ' · 已停用' : '';
      const kindLabel = h.kind === 'english' ? '英语历史' : h.kind === 'health' ? '健康历史' : '自定义';
      return `<div class="hm-row">
        <span class="hm-ic">${esc(h.icon || '🌱')}</span>
        <span class="hm-n">${esc(h.name)}${off}</span>
        <span class="hm-k">${kindLabel}</span>
        <button class="mini" data-act="home-habit-edit" data-id="${h.id}">编辑</button>
        <button class="mini ghost" data-act="home-habit-delete" data-id="${h.id}">删除</button>
      </div>`;
    }).join('') || '<div class="muted tiny">还没有习惯。</div>';
    showModal(`<h3>⚙️ 习惯管理</h3>
      <div class="hm-tip">系统已内置「英语」「健康」并关联原有打卡数据。删除习惯 <b>仅删除配置，历史打卡完全保留</b>。</div>
      <div class="hm-list">${rows}</div>
      <div style="margin-top:10px"><button class="btn sm" data-act="home-habit-add">＋ 新增习惯</button></div>
      <div class="modal-actions"><button class="btn ghost" data-act="close-modal">关闭</button></div>`);
  }
  function homeHabitAdd() {
    openForm('新增习惯', [
      { key: 'name', label: '习惯名称', value: '' },
      { key: 'icon', label: '图标（emoji，可选）', value: '🌱' },
      { key: 'kind', label: '类型', type: 'select', options: [
        { v: 'custom', t: '自定义（新打卡记录）' },
        { v: 'english', t: '关联英语历史（保留原有英语打卡）' },
        { v: 'health', t: '关联健康历史（保留原有健康打卡）' },
      ], value: 'custom' },
    ], null, (fd) => {
      const name = (fd.name || '').trim(); if (!name) { toast('请填写名称'); return; }
      App.state.habits.push({ id: uid(), name, icon: ((fd.icon || '🌱').trim() || '🌱'), kind: fd.kind || 'custom', active: true, order: (App.state.habits.length + 1), createdAt: today() });
      save(); render(); homeHabitManage(); toast('已添加习惯 🌱');
    });
  }
  function homeHabitEdit(habitId) {
    const h = App.state.habits.find((x) => x.id === habitId); if (!h) return;
    openForm('编辑习惯', [
      { key: 'name', label: '名称', value: h.name || '' },
      { key: 'icon', label: '图标', value: h.icon || '🌱' },
      { key: 'kind', label: '类型', type: 'select', options: [
        { v: 'custom', t: '自定义' }, { v: 'english', t: '关联英语历史' }, { v: 'health', t: '关联健康历史' },
      ], value: h.kind || 'custom' },
      { key: 'active', label: '是否显示在首页', type: 'select', options: [{ v: 'true', t: '显示' }, { v: 'false', t: '停用' }], value: h.active === false ? 'false' : 'true' },
    ], null, (fd) => {
      h.name = (fd.name || '').trim() || h.name;
      h.icon = ((fd.icon || '').trim()) || h.icon;
      h.kind = fd.kind || h.kind;
      h.active = fd.active !== 'false';
      save(); render(); homeHabitManage(); toast('已保存');
    });
  }
  function homeHabitDelete(habitId) {
    const h = App.state.habits.find((x) => x.id === habitId); if (!h) return;
    if (!window.confirm('确定删除习惯「' + h.name + '」？\n\n历史打卡数据完全保留，不受影响。')) return;
    App.state.habits = App.state.habits.filter((x) => x.id !== habitId);
    save(); render(); homeHabitManage(); toast('已删除习惯（历史保留）');
  }
  // 重要日期管理：系统节假日只读内置，用户自定义存 s.dates（可增删，不碰系统数据）
  function homeDateManage() {
    const s = App.state; if (!Array.isArray(s.dates)) s.dates = [];
    const list = s.dates.slice().sort((a, b) => a.date.localeCompare(b.date)).map((d) =>
      `<div class="home-dm-row"><span class="hm-t">${esc(d.title)} · ${esc(d.date)}</span><button class="mini ghost" data-act="home-del-date" data-id="${d.id}">删除</button></div>`
    ).join('') || '<div class="muted tiny">还没有自定义重要日期，点下面添加。</div>';
    showModal(`<h3>📅 重要日期管理</h3>
      <div class="home-dm-tip">系统节假日（元旦/春节/清明/劳动/端午/中秋/国庆等）已内置自动显示，不可修改。</div>
      <div class="home-dm-list">${list}</div>
      <div class="home-dm-add">
        <input id="dm-title" placeholder="标题，如 生日 / 签证截止">
        <input id="dm-date" type="date">
        <button class="btn sm" data-act="home-dm-add">添加</button>
      </div>
      <div class="modal-actions"><button class="btn ghost" data-act="close-modal">关闭</button></div>`);
  }

  // 今日金句：内置中英文池，按日确定性切换（day hash），不写 state、不调第三方 API。
  // 「换一句」只在本次会话内叠加偏移（App.homeQuoteShift），不持久化。
  const HOME_QUOTES = [
    { zh: '种一棵树最好的时间是十年前，其次是现在。', en: 'The best time to plant a tree was ten years ago. The second best time is now.' },
    { zh: '慢慢来，比较快。', en: 'Slow is smooth, and smooth is fast.' },
    { zh: '你只管努力，剩下的交给时间。', en: 'Just keep going, and let time take care of the rest.' },
    { zh: '今天的努力，是幸运的伏笔。', en: "Today's effort is the foreshadowing of tomorrow's luck." },
    { zh: '与其担心未来，不如现在好好努力。', en: 'Instead of worrying about the future, work hard right now.' },
    { zh: '把平凡的事做好，就是不平凡。', en: 'Doing ordinary things well is what makes them extraordinary.' },
    { zh: '你不必很厉害才能开始，但你必须开始才能很厉害。', en: "You don't have to be great to start, but you have to start to be great." },
    { zh: '生活明朗，万物可爱。', en: 'Life is bright, and everything in it is lovely.' },
    { zh: '所有伟大，都源于一个勇敢的开始。', en: 'All greatness begins with one brave first step.' },
    { zh: '心之所向，素履以往。', en: 'Go wherever your heart leads, even in the simplest shoes.' },
    { zh: '日拱一卒，功不唐捐。', en: 'A pawn a day — no effort is ever wasted. (胡适)' },
    { zh: '成长，就是把哭声调成静音的过程。', en: 'Growing up is turning the volume of your tears all the way down.' },
    { zh: '领先的唯一秘诀，就是开始行动。', en: 'The secret of getting ahead is simply getting started.' },
    { zh: '只要不停下，走得慢也没关系。', en: 'It does not matter how slowly you go, as long as you do not stop.' },
    { zh: '小小的进步，也是进步。', en: 'Small progress is still progress.' },
    { zh: '大胆梦想，从小处着手，立刻行动。', en: 'Dream big, start small, act now.' },
    { zh: '你永远不会太老，无法再定一个新目标。', en: 'You are never too old to set another goal.' },
    { zh: '做得好，胜过说得好。', en: 'Well done is better than well said.' },
    { zh: '先做最难的事。', en: 'Do the hard things first.' },
    { zh: '坚持，是把普通变成卓越的力量。', en: 'Consistency is what transforms average into excellence.' },
    { zh: '七次跌倒，八次站起。', en: 'Fall seven times, stand up eight.' },
    { zh: '行动，是成功最根本的钥匙。', en: 'Action is the foundational key to all success.' },
    { zh: '继续走，你需要的一切都会到来。', en: 'Keep going. Everything you need will come to you.' },
    { zh: '今天，就是开始的好日子。', en: 'Today is a perfect day to begin.' },
  ];
  function homeQuote() {
    const key = today();
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    const shift = App.homeQuoteShift || 0;
    return HOME_QUOTES[(h + shift) % HOME_QUOTES.length];
  }

  /* ============================================================
   *  月历
   * ============================================================ */
  let calMonth = new Date().getMonth(), calYear = new Date().getFullYear();
  function renderMonth() {
    const s = App.state;
    const first = new Date(calYear, calMonth, 1);
    const startDow = first.getDay();
    const days = new Date(calYear, calMonth + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startDow; i++) cells.push('');
    for (let d = 1; d <= days; d++) cells.push(ymd(new Date(calYear, calMonth, d)));

    const taskByDate = {};
    s.tasks.filter((t) => !t.canceled).forEach((t) => {
      const key = t.done ? (t.doneAt || t.date) : t.date;
      (taskByDate[key] = taskByDate[key] || []).push(t);
    });

    // 月度概览（实时从同一 tasks 计算，无第二套数据）
    const ym = calYear + '-' + String(calMonth + 1).padStart(2, '0');
    const inMonth = (t) => { const k = t.done ? (t.doneAt || t.date) : t.date; return k && k.slice(0, 7) === ym; };
    const monthTasks = s.tasks.filter((t) => !t.canceled && inMonth(t));
    const mDone = monthTasks.filter((t) => t.done).length;
    const mTodo = monthTasks.length - mDone;
    const mRate = monthTasks.length ? Math.round((mDone / monthTasks.length) * 100) : 0;

    // 节假日 / 纪念日（仅作轻量角标，不堆内容，避免拥挤）
    const holSet = {};
    CN_HOLIDAYS.forEach((h) => { if (h.date.slice(0, 7) === ym) holSet[h.date] = { t: h.title, k: h.kind }; });
    (s.dates || []).forEach((d) => { if (d.date && d.date.slice(0, 7) === ym) holSet[d.date] = { t: d.title, k: 'user' }; });

    const dow = ['日', '一', '二', '三', '四', '五', '六'];
    let html = `<div class="card month-ov">
      <div class="mon-ov-head"><span class="mon-ov-title">📅 ${calYear} 年 ${calMonth + 1} 月 · 月度成长</span></div>
      <div class="mon-ov-grid">
        <div class="mov"><span class="mn">${monthTasks.length}</span><span class="ml">总任务</span></div>
        <div class="mov done ${mDone ? 'clickable' : ''}" ${mDone ? 'data-act="month-filter" data-kind="done"' : ''}><span class="mn">${mDone}</span><span class="ml">已完成 · 点看</span></div>
        <div class="mov todo ${mTodo ? 'clickable' : ''}" ${mTodo ? 'data-act="month-filter" data-kind="todo"' : ''}><span class="mn">${mTodo}</span><span class="ml">待完成 · 点看</span></div>
        <div class="mov rate"><span class="mn">${mRate}%</span><span class="ml">完成率</span></div>
      </div>
      <div class="cal-head" style="margin-top:12px">
        <button class="btn ghost sm" data-act="cal-prev">‹</button>
        <div class="mon">${calYear} 年 ${calMonth + 1} 月</div>
        <button class="btn ghost sm" data-act="cal-next">›</button>
      </div>
    </div>`;

    // 月度成长：已完成 / 待完成 点击展开真实过滤列表（完全同源 tasks，不复制）
    if (App.monthFilter) {
      const mlist = monthTasks.filter((t) => App.monthFilter === 'done' ? t.done : !t.done);
      const mlbl = App.monthFilter === 'done' ? '本月已完成' : '本月待完成';
      html += `<div class="card"><h3>📋 ${mlbl} <span class="tag">${mlist.length} 项 · 真实任务</span></h3>`;
      html += mlist.length ? mlist.map(taskRow).join('') : `<div class="empty"><span class="em">🌼</span>这一项暂时还是空的。</div>`;
      html += `<div style="margin-top:8px"><button class="btn ghost sm" data-act="month-filter" data-kind="${App.monthFilter}">收起 ↑</button></div></div>`;
    }

    html += `<div class="card"><div class="cal-grid">${dow.map((x) => `<div class="cal-dow">${x}</div>`).join('')}`;
    cells.forEach((c) => {
      if (!c) { html += `<div></div>`; return; }
      const list = taskByDate[c] || [];
      const done = list.filter((t) => t.done).length;
      const todo = list.length - done;
      const isTd = c === today();
      const hol = holSet[c];
      const extra = hol ? `<span class="cal-hol ${hol.k === 'user' ? 'user' : ''}" title="${esc(hol.t)}">${hol.k === 'user' ? '★' : '休'}</span>` : '';
      const pills = list.slice(0, 3).map((t) => `<span class="pill ${t.done ? 'ok' : ''}">${esc(t.title.slice(0, 6))}</span>`).join('');
      const more = list.length > 3 ? `<span class="cal-more">+${list.length - 3}项</span>` : '';
      html += `<div class="cal-cell ${isTd ? 'today' : ''}" data-act="cal-day" data-id="${c}">
        <div class="d">${+c.slice(8)}${extra}</div>
        <div class="cal-counts">
          ${done ? `<span class="dot green" title="已完成 ${done}">🟢${done}</span>` : ''}
          ${todo ? `<span class="dot red" title="待完成 ${todo}">🔴${todo}</span>` : ''}
          ${more}
        </div>
        <div class="cal-pills">${pills}</div>
      </div>`;
    });
    html += `</div></div>`;

    // 选中日期详情
    if (App.selDay) {
      const list = (taskByDate[App.selDay] || []);
      html += `<div class="card"><h3>📅 ${App.selDay} <span class="tag">当天记录</span></h3>`;
      html += `<div class="quick-add"><input id="qa-cal" placeholder="给这一天加个任务…">
        <button class="btn sm" data-act="add-cal-task">添加</button></div>`;
      html += list.length ? list.map((t) => taskRow(t)).join('') : `<div class="empty"><span class="em">🌼</span>这一天还没有记录，在上面加一条吧。</div>`;
      html += `</div>`;
    }
    $('#view').innerHTML = html;
    setPage('月度成长');
  }

  /* ============================================================
   *  成长地图
   * ============================================================ */
  /* ============================================================
   *  成长地图 V2 —— 真实记录 → 聚合 → AI 整理 → 你确认（AI 不创造）
   * ============================================================ */
  // A 顶部轻量概览：一句话动态总结，全部来自真实记录
  function buildGrowthOverview() {
    const s = App.state;
    const done = s.tasks.filter((t) => t.done && !t.canceled).length;
    const pub = s.content.filter((c) => c.status === '已发布').length;
    const rev = s.reviews.length;
    const dec = s.decisions.length;
    const yrs = s.growth.filter((g) => g.type === 'year').length;
    const parts = [];
    if (done) parts.push(done + ' 条已完成记录');
    if (pub) parts.push(pub + ' 个选题已发布');
    if (rev) parts.push(rev + ' 次复盘');
    if (dec) parts.push(dec + ' 个决策');
    if (yrs) parts.push(yrs + ' 个年度方向');
    if (!parts.length) return '最近暂无足够记录形成成长判断，先去「每日进步」记一条完成的小事 🌱';
    return '基于你的真实记录：已有 ' + parts.join('、') + '。成长是积累出来的，不是想出来的。';
  }

  // B 能力资产：只从真实记录归纳候选，每条带证据链；状态由你确认
  function discoverAssets() {
    const s = App.state;
    const cands = [];
    const pub = s.content.filter((c) => c.status === '已发布');
    if (pub.length) cands.push({ key: 'content-pub', name: '内容持续产出（已发布 ' + pub.length + ' 条）',
      evidence: pub.slice(0, 3).map((c) => ({ mod: 'content', id: c.id, label: c.title })) });
    const enMin = s.english.reduce((a, e) => a + (Number(e.minutes) || 0), 0);
    if (enMin >= 60) cands.push({ key: 'english', name: '英语持续输入（累计 ' + num(enMin / 60, 1) + ' 小时）',
      evidence: s.english.slice(0, 3).map((e) => ({ mod: 'home', id: '', label: e.date + ' · ' + e.minutes + ' 分钟' })) });
    if (s.customers.length) cands.push({ key: 'edu-crm', name: '教育咨询获客（' + s.customers.length + ' 位客户）',
      evidence: s.customers.slice(0, 3).map((c) => ({ mod: 'crm', id: c.id, label: c.nickname || '客户' })) });
    const catCnt = {};
    s.tasks.forEach((t) => { if (t.cat) catCnt[t.cat] = (catCnt[t.cat] || 0) + 1; });
    const top = Object.keys(catCnt).sort((a, b) => catCnt[b] - catCnt[a])[0];
    if (top && catCnt[top] >= 5) cands.push({ key: 'cat-' + top, name: '高频处理「' + catName(top) + '」类事务（' + catCnt[top] + ' 次）',
      evidence: s.tasks.filter((t) => t.cat === top).slice(0, 3).map((t) => ({ mod: 'today', id: t.id, label: t.title })) });
    const decDone = s.decisions.filter((d) => d.result);
    if (decDone.length) cands.push({ key: 'decision', name: '能落地决策并复盘（' + decDone.length + ' 个决策有结果）',
      evidence: decDone.slice(0, 3).map((d) => ({ mod: 'rd', id: d.id, label: d.question })) });
    return cands;
  }

  // AI 成长复盘：4 个问题，全部基于真实数据，每条带查看依据
  function buildAiReview() {
    const s = App.state;
    const done = s.tasks.filter((t) => t.done && !t.canceled);
    const pub = s.content.filter((c) => c.status === '已发布');
    const dec = s.decisions;
    const q = [];
    q.push({ t: '最近在坚持做哪些事？',
      a: done.length ? ('已完成 ' + done.length + ' 条记录，说明你在持续行动。') : '暂无明显持续记录，可以从每天完成 1 件小事开始。',
      ev: done.slice(0, 3).map((t) => ({ mod: 'today', id: t.id, label: t.title })) });
    q.push({ t: '哪些事有了进展？',
      a: pub.length ? ('已有 ' + pub.length + ' 个选题发布，内容方向在跑通。') : (s.growth.some((g) => (g.progress || 0) > 0) ? '年度方向里有进度在推进。' : '暂时看不出明显进展，建议给一个方向设小目标。'),
      ev: pub.length ? pub.slice(0, 3).map((c) => ({ mod: 'content', id: c.id, label: c.title })) : [] });
    q.push({ t: '我做过哪些重要决定？',
      a: dec.length ? ('记录了 ' + dec.length + ' 个决策，愿意为选择负责。') : '还没有记录决策，重要决定写下来能避免反复纠结。',
      ev: dec.slice(0, 3).map((d) => ({ mod: 'rd', id: d.id, label: d.question })) });
    q.push({ t: '下一步可以加强什么？',
      a: '基于现有记录，先把「坚持的事」做得更稳，再补「还没开始」的部分。不假装知道答案，你来定。',
      ev: [] });
    return q;
  }

  // 证据链：可点击跳到原始记录
  function evLinks(ev) {
    if (!ev || !ev.length) return '<span class="tiny muted">暂无具体记录可查</span>';
    return ev.map((e) => `<button class="mini ghost ev-link" data-act="ev-link" data-mod="${esc(e.mod)}" data-evid="${esc(e.id || '')}">查看依据：${esc(e.label || '记录')}</button>`).join(' ');
  }

  function renderGrowth() {
    const s = App.state;
    const bar = (p) => `<div class="bar"><span style="width:${Math.max(0, Math.min(100, p || 0))}%"></span></div>`;
    let html = `<div class="card"><h3>🗺️ 成长地图 <span class="tag">真实记录，AI 只整理</span></h3>
      <div class="tiny muted" style="margin-bottom:8px">${esc(buildGrowthOverview())}</div></div>`;

    // —— B 能力资产 ——
    const cands = discoverAssets();
    const storedMap = {};
    s.growth.filter((g) => g.type === 'asset').forEach((g) => { storedMap[g.key] = g; });
    let assetHtml = `<div class="card"><h3>🧠 能力资产 <span class="tag">AI 发现 · 你来确认</span></h3>
      <div class="tiny muted" style="margin-bottom:8px">只从你真实记录里归纳，每条都能点开看依据。不确定的不写进资产。</div>`;
    const rows = cands.map((c) => ({ c, g: storedMap[c.key] })).concat(
      s.growth.filter((g) => g.type === 'asset' && !cands.find((c) => c.key === g.key))
        .map((g) => ({ c: { key: g.key, name: g.title, evidence: g.evidence || [] }, g }))
    );
    if (!rows.length) {
      assetHtml += `<div class="empty"><span class="em">🧠</span>记录不足，暂不形成能力资产。先多记一些真实完成的事。</div></div>`;
    } else {
      rows.forEach(({ c, g }) => {
        const st = g ? g.status : 'found';
        const badge = st === 'confirmed' ? '<span class="badge s2">已确认</span>' : st === 'invalid' ? '<span class="badge s0">暂不成立</span>' : '<span class="badge s3">AI 发现 · 待确认</span>';
        assetHtml += `<div class="asset-item"><div class="li-top"><div class="li-title">${esc(c.name)}</div>${badge}</div>
          <div class="ev-row">${evLinks(c.evidence)}</div>
          <div class="row-actions" style="margin-top:6px">`;
        if (st === 'found') {
          assetHtml += `<button class="mini green" data-act="confirm-asset" data-key="${esc(c.key)}" data-name="${esc(c.name)}">确认记入能力</button>
            <button class="mini ghost" data-act="invalid-asset" data-key="${esc(c.key)}" data-name="${esc(c.name)}">暂不成立</button>`;
        } else if (st === 'confirmed') {
          assetHtml += `<button class="mini ghost" data-act="del-asset" data-id="${g.id}">移除</button>`;
        } else {
          assetHtml += `<button class="mini ghost" data-act="del-asset" data-id="${g.id}">重新评估</button>`;
        }
        assetHtml += `</div></div>`;
      });
      assetHtml += `</div>`;
    }
    html += assetHtml;

    // —— C 项目 / 商业履历：仅真实记录 ——
    const ecom = s.ecommerce || [];
    const decs = s.decisions;
    const pub = s.content.filter((c) => c.status === '已发布');
    let projHtml = `<div class="card"><h3>🏆 项目 / 商业履历 <span class="tag">仅真实记录</span></h3>`;
    if (!ecom.length && !decs.length && !pub.length) {
      projHtml += `<div class="empty"><span class="em">🏆</span>暂无记录。做过的事、做出的决定，记下来就是履历。</div></div>`;
    } else {
      if (ecom.length) {
        projHtml += `<div class="li-sub" style="margin:6px 0 2px">🛒 电商实践（${ecom.length}）</div>`;
        ecom.slice(0, 6).forEach((e) => { projHtml += `<div class="list-item"><div class="li-top"><div class="li-title">${esc(e.title)}</div><span class="badge">${esc(e.category || '其他')}</span></div><div class="row-actions" style="margin-top:4px"><button class="mini ghost ev-link" data-act="ev-link" data-mod="ecom" data-evid="${esc(e.id)}">查看依据</button></div></div>`; });
      }
      if (decs.length) {
        projHtml += `<div class="li-sub" style="margin:8px 0 2px">🧭 关键决策（${decs.length}）</div>`;
        decs.slice(0, 6).forEach((d) => { projHtml += `<div class="list-item"><div class="li-top"><div class="li-title">${esc(d.question)}</div></div><div class="li-sub">${d.decision ? '决定：' + esc(d.decision) : '（未填决定）'}</div><div class="row-actions" style="margin-top:4px"><button class="mini ghost ev-link" data-act="ev-link" data-mod="rd" data-evid="${esc(d.id)}">查看依据</button></div></div>`; });
      }
      if (pub.length) {
        projHtml += `<div class="li-sub" style="margin:8px 0 2px">🎬 内容作品（${pub.length}）</div>`;
        pub.slice(0, 6).forEach((c) => { projHtml += `<div class="list-item"><div class="li-top"><div class="li-title">${esc(c.title)}</div></div><div class="row-actions" style="margin-top:4px"><button class="mini ghost ev-link" data-act="ev-link" data-mod="content" data-evid="${esc(c.id)}">查看依据</button></div></div>`; });
      }
      projHtml += `</div>`;
    }
    html += projHtml;

    // —— D 我的成长路径：年度 → 月度 → 行动 + 我的方法 ——
    const years = s.growth.filter((g) => g.type === 'year');
    let pathHtml = `<div class="card"><h3>🧭 我的成长路径 <span class="tag">方向 → 目标 → 行动</span></h3>
      <button class="btn sm" data-act="add-growth" data-type="year">+ 添加年度方向</button></div>`;
    if (!years.length) pathHtml += `<div class="empty"><span class="em">🌱</span>先写下今年的方向吧，比如「建立稳定教育获客体系」。</div>`;
    years.forEach((y) => {
      const months = s.growth.filter((g) => g.type === 'month' && g.parent === y.id);
      let block = `<div class="card"><div style="display:flex;align-items:center;gap:10px">
        <b style="flex:1;font-size:16px">${esc(y.title)}</b>
        <span class="pct">${y.progress || 0}%</span></div>${bar(y.progress)}
        <div style="margin:10px 0"><button class="mini" data-act="add-growth" data-type="month" data-parent="${y.id}">+ 月度目标</button>
        <button class="mini ghost" data-act="edit-growth" data-id="${y.id}">编辑</button>
        <button class="mini ghost" data-act="del-growth" data-id="${y.id}">删除</button></div>`;
      if (!months.length) block += `<div class="tiny muted">还没有月度目标。</div>`;
      months.forEach((m) => {
        const acts = s.growth.filter((g) => g.type === 'action' && g.parent === m.id);
        block += `<div style="margin:10px 0 4px;padding-left:8px;border-left:3px solid var(--gold)">
          <div style="display:flex;align-items:center;gap:8px"><b style="flex:1">${esc(m.title)}</b><span class="pct">${m.progress || 0}%</span></div>
          ${bar(m.progress)}
          <div style="margin:6px 0"><button class="mini" data-act="add-growth" data-type="action" data-parent="${m.id}">+ 行动</button>
          <button class="mini ghost" data-act="edit-growth" data-id="${m.id}">编辑</button></div>`;
        acts.forEach((a) => {
          block += `<div style="display:flex;align-items:center;gap:8px;padding:5px 6px;background:var(--bg);border-radius:10px;margin-bottom:5px">
            <span style="flex:1">${esc(a.title)}</span>
            <span class="pct" style="width:46px">${a.progress || 0}%</span>
            <button class="mini ghost" data-act="edit-growth" data-id="${a.id}">改</button></div>`;
        });
        block += `</div>`;
      });
      block += `</div>`;
      pathHtml += block;
    });
    const methods = s.growth.filter((g) => g.type === 'method');
    let methodHtml = `<div class="card"><h3>🔧 我的方法 <span class="tag">模仿 → 拆解 → 实践 → 验证</span></h3>
      <div class="tiny muted" style="margin-bottom:6px">只记你真正在用的办法，别列「想学」的。</div>
      <button class="btn sm" data-act="add-method">+ 添加方法</button></div>`;
    if (!methods.length) methodHtml += `<div class="empty"><span class="em">🔧</span>还没有记录方法。一个被你反复验证有效的动作，就是方法。</div>`;
    methods.forEach((mth) => {
      const st = mth.status || 'explore';
      const stText = st === 'formed' ? '已形成' : st === 'verify' ? '验证中' : '探索中';
      const stCls = st === 'formed' ? 's2' : st === 'verify' ? 's3' : 's0';
      methodHtml += `<div class="method-item"><div class="li-top"><div class="li-title">${esc(mth.title)}</div><span class="badge ${stCls}">${stText}</span></div>
        ${mth.note ? `<div class="li-sub">${esc(mth.note)}</div>` : ''}
        <div class="row-actions" style="margin-top:6px">
          <button class="mini ghost" data-act="edit-method" data-id="${mth.id}">编辑</button>
          <button class="mini ghost" data-act="del-growth" data-id="${mth.id}">删除</button></div></div>`;
    });
    html += pathHtml + methodHtml;

    // —— AI 成长复盘（轻量入口）——
    const aiOpen = App.folds['aireview'];
    html += `<div class="card"><div style="display:flex;align-items:center;gap:10px">
      <h3 style="flex:1;margin:0">🪞 AI 成长复盘</h3>
      <button class="btn soft sm" data-act="toggle-fold" data-id="aireview">${aiOpen ? '收起' : '点击分析'}</button></div>`;
    if (aiOpen) {
      html += buildAiReview().map((x) => `<div class="ai-review"><div class="ar-q">${esc(x.t)}</div><div class="ar-a">${esc(x.a)}</div><div class="ev-row">${evLinks(x.ev)}</div></div>`).join('');
    }
    html += `</div>`;

    // —— E 成长痕迹：与首页同源（数据源 / 折叠 / 数量 / 看全部 完全一致）——
    const traceAll = s.tasks.filter((t) => t.done && !t.canceled)
      .sort((a, b) => String(b.doneAt || b.date || '').localeCompare(String(a.doneAt || a.date || '')));
    const tracePreview = traceAll.slice(0, 6);
    const traceOpen = App.folds['trace'];
    html += `<div class="card"><h3 class="fold-h" data-act="toggle-fold" data-id="trace">
      <span class="fold-ic">${traceOpen ? '▾' : '▸'}</span>📚 最近成长痕迹
      <span class="tag">${traceAll.length} 条</span></h3>`;
    html += `<div style="margin:8px 0 2px"><button class="btn soft sm" data-act="trace-see-all">看全部 →</button></div>`;
    if (traceOpen) {
      if (traceAll.length) {
        html += `<div class="home-list">` + traceAll.map((t) =>
          `<div class="home-li" data-act="nav" data-id="growth"><span class="home-li-t">${esc(t.title)}</span>${t.cat ? `<span class="chip ${catClass(t.cat)}">${catName(t.cat)}</span>` : ''}</div>`
        ).join('') + `</div>`;
      } else {
        html += `<div class="empty"><span class="em">📚</span>还没有完成的记录。</div>`;
      }
    } else if (tracePreview.length) {
      html += `<div class="tiny muted" style="margin-top:2px">最新：${esc(tracePreview[0].title)}　·　点标题展开全部 ${traceAll.length} 条</div>`;
    }
    html += `</div>`;

    // —— 复盘与决策（轻量重定位入口，原「个人成长」合并于此）——
    html += `<div class="card rd-entry"><h3>🪞 复盘与决策</h3>
      <div class="tiny muted" style="margin-bottom:8px">「个人成长」入口已合并到这里：复盘与决策都在。</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn sm" data-act="open-rd" data-view="review">🪞 成长复盘（${s.reviews.length}）</button>
        <button class="btn sm" data-act="open-rd" data-view="decision">🧭 决策库（${s.decisions.length}）</button>
        <button class="btn soft sm" data-act="add-review" data-type="day">+ 写今日复盘</button>
        <button class="btn soft sm" data-act="add-decision">+ 记录决策</button>
      </div></div>`;

    $('#view').innerHTML = html;
    setPage('成长地图');
  }

  // 复盘与决策独立屏幕（不在导航栏，从成长地图进入）
  function renderRD() {
    const s = App.state;
    const tabs = `<div class="tabs">
      <button class="tab ${App.rdView !== 'decision' ? 'active' : ''}" data-act="rd-tab" data-id="review">🪞 复盘</button>
      <button class="tab ${App.rdView === 'decision' ? 'active' : ''}" data-act="rd-tab" data-id="decision">🧭 决策</button>
      <button class="tab" data-act="nav" data-id="growth">← 返回成长地图</button>
    </div>`;
    const inner = App.rdView === 'decision' ? renderSelfDecision() : renderSelfReview();
    $('#view').innerHTML = tabs + inner;
    setPage('复盘与决策');
  }

  function editMethod(id) {
    const m = id ? find(App.state.growth, id) : { type: 'method', status: 'explore' };
    openForm(id ? '编辑方法' : '添加方法', [
      { key: 'title', label: '方法名称（你真正在用的）', value: m.title, type: 'textarea' },
      { key: 'status', label: '状态', type: 'select', options: [{ v: 'explore', t: '探索中' }, { v: 'verify', t: '验证中' }, { v: 'formed', t: '已形成' }], value: m.status || 'explore' },
      { key: 'note', label: '怎么用 / 步骤（模仿 → 拆解 → 实践 → 验证）', value: m.note, type: 'textarea' },
    ], null, (fd) => {
      if (id) Object.assign(m, fd); else App.state.growth.push(Object.assign({ id: uid(), type: 'method' }, fd));
      save(); renderGrowth();
    });
  }

  /* ============================================================
   *  灵感站
   * ============================================================ */
  function renderInspiration() {
    const s = App.state;
    let html = `<div class="card"><h3>💡 灵感站 <span class="tag">一句话，AI 帮你分类</span></h3>
      <div class="quick-add"><input id="qa-insp" placeholder="此刻冒出的想法 / 问题 / 一句话…">
      <button class="btn sm" data-act="add-insp">记录</button></div>
      <div class="tiny muted" style="margin-top:8px">AI 会先给建议分类（本地启发式），确认后进入对应模块沉淀为资产。</div></div>`;
    const list = s.inspirations.slice().reverse();
    if (!list.length) html += `<div class="empty"><span class="em">✨</span>灵感稍纵即逝，随时记下来。</div>`;
    list.forEach((it) => {
      const sug = it.suggestedCategory || classifyInspiration(it.text);
      const status = it.confirmed ? `<span class="badge s2">已入库 · ${esc(it.targetModule || '')}</span>` : `<span class="badge warn">待确认</span>`;
      html += `<div class="list-item"><div class="li-top">
        <div class="li-title">${esc(it.text)}</div>${status}</div>
        <div class="li-sub">AI 建议分类：<span class="chip ${catClass(sug)}">${catName(sug)}</span>
        ${it.confirmed ? '' : `<button class="mini" data-act="confirm-insp" data-id="${it.id}" style="margin-left:8px">确认并入模块</button>`}
        <button class="mini ghost" data-act="del-insp" data-id="${it.id}">删除</button></div></div>`;
    });
    $('#view').innerHTML = html;
    const el = $('#qa-insp'); if (el) el.onkeydown = (e) => { if (e.key === 'Enter') { const v = el.value.trim(); if (v) { addInsp(v); el.value = ''; } } };
    setPage('灵感站');
  }
  function addInsp(text) {
    App.state.inspirations.push({ id: uid(), text, suggestedCategory: classifyInspiration(text), confirmed: false, createdAt: today() });
    save(); renderInspiration();
  }
  function confirmInsp(id) {
    const it = App.state.inspirations.find((x) => x.id === id); if (!it) return;
    const c = it.suggestedCategory || classifyInspiration(it.text);
    const r = ROUTE[c] || ROUTE.content;
    const made = r.make(it.text);
    let target = '';
    if (r.mod === 'content') { made.status = made.status || '灵感'; made.createdAt = today(); App.state.content.push(Object.assign({ id: uid() }, made)); target = '内容宇宙'; }
    else if (r.mod === 'tasks') { App.state.tasks.push(Object.assign({ id: uid(), title: made.title, type: made.type || 'todo', cat: made.cat || '', date: today(), done: false, canceled: false }, {})); target = '今日待办'; }
    else if (r.mod === 'ecommerce') { made.date = today(); App.state.ecommerce.push(Object.assign({ id: uid() }, made)); target = '电商实验室'; }
    else if (r.mod === 'decisions') { made.date = today(); App.state.decisions.push(Object.assign({ id: uid() }, made)); target = '决策库'; }
    it.confirmed = true; it.targetModule = target;
    save(); renderInspiration(); toast('已归入「' + target + '」🌱');
  }

  /* ============================================================
   *  婧婧内容宇宙
   * ============================================================ */
  const COLS = [
    { id: 'thailand', name: '婧婧带你看泰国' },
    { id: 'campus', name: '婧婧带你看校园' },
    { id: 'listens', name: '婧婧听你说' },
  ];
  // 系列名 → 栏目 id（AI 推荐方向后自动归入对应栏目）
  const SERIES_COL = { '婧婧听你说': 'listens', '婧婧带你看泰国': 'thailand', '婧婧带你看校园': 'campus' };
  // 反查：旧数据 col(id) → 系列中文名（兼容无 series 字段的旧记录，不丢数据）
  const COL_TO_SERIES = { listens: '婧婧听你说', thailand: '婧婧带你看泰国', campus: '婧婧带你看校园' };
  // 三个固定系列的视觉识别（名称 + 图标 + 颜色），全内容宇宙所有出现位置统一使用
  const SERIES_META = {
    '婧婧听你说':   { id: 'listens', icon: '💬', color: '#7A5C92', bg: '#F3ECF7' },
    '婧婧带你看泰国': { id: 'thailand', icon: '🌴', color: '#C77B3E', bg: '#FDEFE0' },
    '婧婧带你看校园': { id: 'campus', icon: '🎓', color: '#3E7CA0', bg: '#E8F0F6' },
  };
  function seriesId(name) { return (SERIES_META[name] || {}).id || SERIES_COL[name] || 'thailand'; }
  function seriesOf(x) { return (x && x.series) || (x && COL_TO_SERIES[x.col]) || '婧婧带你看泰国'; }
  function seriesIcon(name) { return (SERIES_META[name] || {}).icon || '🎬'; }
  function seriesColor(name) { return (SERIES_META[name] || {}).color || '#9DB8C9'; }
  function seriesBg(name) { return (SERIES_META[name] || {}).bg || '#eef2f5'; }
  function renderSeriesTag(name) {
    const m = SERIES_META[name] || {};
    return `<span class="series-tag" style="color:${m.color || '#9DB8C9'};background:${m.bg || '#eef2f5'}">${m.icon || '🎬'} ${esc(name)}</span>`;
  }
  const CSTATUS = ['灵感', '待制作', '拍摄中', '剪辑中', '已发布', '复盘'];
  let contentCol = 'thailand';
  let contentView = 'col'; // 'col' 选题栏目 / 'hot' 热点雷达 / 'insp' 灵感库
  let inspKind = 'link'; // 灵感库子视图：'link' 链接 / 'note' 随手记录
  function renderContent() {
    const s = App.state;
    const colTabs = COLS.map((c) => `<button class="tab ${contentView === 'col' && c.id === contentCol ? 'active' : ''}" data-act="filter-content" data-id="${c.id}">${c.name}</button>`).join('');
    const topTabs = `<button class="tab ${contentView === 'col' ? 'active' : ''}" data-act="content-tab" data-id="col">🎬 选题</button>
      <button class="tab ${contentView === 'hot' ? 'active' : ''}" data-act="content-tab" data-id="hot">📡 热点雷达</button>
      <button class="tab ${contentView === 'insp' ? 'active' : ''}" data-act="content-tab" data-id="insp">💡 灵感库</button>`;

    const tag = contentView === 'hot' ? '热点雷达' : contentView === 'insp' ? '灵感库' : COLS.find((c) => c.id === contentCol).name;
    let html = `<div class="card"><h3>🎬 婧婧内容宇宙 <span class="tag">${tag}</span></h3>
      <div class="tabs">${topTabs}</div>`;

    if (contentView === 'col') {
      html += `<div class="tabs">${colTabs}</div>
      <button class="btn sm green" data-act="add-content">+ 新建选题</button></div>`;
    } else if (contentView === 'hot') {
      const todayCount = s.hotspots.filter((h) => h.date === today()).length;
      html += `<div class="tiny muted" style="margin-bottom:8px">今日已更新 <b>${todayCount}</b> 条热点　·　点「刷新热点」不会重复生成（已自动按话题去重）。</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn sm green" data-act="gen-hot">🔄 刷新热点</button>
        <button class="btn soft sm" data-act="add-hot">+ 收录热点</button>
      </div></div>`;
    } else {
      const sub = `<button class="tab ${inspKind === 'link' ? 'active' : ''}" data-act="insp-sub" data-id="link">🔗 链接</button>
        <button class="tab ${inspKind === 'note' ? 'active' : ''}" data-act="insp-sub" data-id="note">📝 随手记录</button>`;
      html += `<div class="tabs">${sub}</div>`;
      if (inspKind === 'link') {
        html += `<div class="quick-add"><input id="qa-link" placeholder="粘贴链接（小红书 / 抖音 / 视频号 / 文章…）">
          <input id="qa-link-title" placeholder="标题（可留空，自动取域名）" style="max-width:170px;flex:0 0 auto">
          <button class="btn sm green" data-act="add-insp-link">保存链接</button></div>
          <div class="tiny muted" style="margin-top:6px">粘贴后自动识别平台、尝试抓取标题 / 简介（平台限制可能失败，最少会保留链接）；点「编辑」可补充摘要 / 值得参考 / 如何迁移。</div></div>`;
      } else {
        html += `<div class="quick-add"><input id="qa-note" placeholder="此刻冒出的一个想法 / 一句话…">
          <button class="btn sm green" data-act="add-insp-note">记录</button></div>
          <div class="tiny muted" style="margin-top:6px">AI 会识别为灵感并给「内容方向框架」（不生成口播稿 / 标题库）。</div></div>`;
      }
    }
    html += `<div style="height:10px"></div>`;

    if (contentView === 'col') {
      let list = s.content.filter((x) => seriesId(seriesOf(x)) === contentCol && !x.kind);
      list = sortContent(list);
      if (!list.length) html += `<div class="empty"><span class="em">🎥</span>这个系列还没有选题，点上方「+ 新建选题」开始吧。</div>`;
      list.forEach((x) => { html += renderTopicItem(x); });
    } else if (contentView === 'hot') {
      const list = s.hotspots.slice().sort((a, b) => (a.rank != null ? a.rank : 99) - (b.rank != null ? b.rank : 99));
      // 今日更新序号：仅统计 date===今天 的热点，按排序给 1/2/3…（不累计历史）
      const todayList = list.filter((h) => h.date === today());
      const todayIdx = {}; todayList.forEach((h, i) => { todayIdx[h.id] = i + 1; });
      if (!list.length) html += `<div class="empty"><span class="em">📡</span>还没有热点。点「刷新热点」试试。</div>`;
      list.forEach((h) => { html += renderHotItem(h, todayIdx[h.id]); });
    }       else {
        const list = s.content.filter((x) => x.kind === inspKind).slice().reverse();
        if (!list.length) html += `<div class="empty"><span class="em">💡</span>${inspKind === 'link' ? '还没有保存的链接，粘贴一个试试。' : '还没有随手记录的灵感。'}</div>`;
        else if (inspKind === 'link') {
          // 「链接」卡片并排成网格（手机 2 列、桌面 3 列）；「随手记录」保持上下列表，不进网格
          html += `<div class="insp-cards">`;
          list.forEach((x) => { html += renderInspItem(x); });
          html += `</div>`;
        } else {
          list.forEach((x) => { html += renderInspItem(x); });
        }
      }
    $('#view').innerHTML = html;
    const ql = $('#qa-link'); if (ql) ql.onkeydown = (e) => { if (e.key === 'Enter') { const v = ql.value.trim(); if (v) { addInspLink(v, $('#qa-link-title') ? $('#qa-link-title').value.trim() : ''); ql.value = ''; const lt = $('#qa-link-title'); if (lt) lt.value = ''; } } };
    const qn = $('#qa-note'); if (qn) qn.onkeydown = (e) => { if (e.key === 'Enter') { const v = qn.value.trim(); if (v) { addInspNote(v); qn.value = ''; } } };
    setPage('婧婧内容宇宙');
  }
  // 选题列表：待制作等确定状态靠前，灵感排后
  function sortContent(list) {
    const rank = { '待制作': 0, '拍摄中': 1, '剪辑中': 2, '已发布': 3, '复盘': 4, '灵感': 5 };
    return list.slice().sort((a, b) => {
      const ra = rank[a.status] != null ? rank[a.status] : 5;
      const rb = rank[b.status] != null ? rank[b.status] : 5;
      if (ra !== rb) return ra - rb;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }
  function renderTopicItem(x) {
    const st = x.status || '灵感';
    const stCls = { '灵感': 's1', '待制作': 's1', '拍摄中': 's3', '剪辑中': 's3', '已发布': 's2', '复盘': 's4' }[st] || 's1';
    return `<div class="list-item"><div class="li-top">
      <div class="li-title">${esc(x.title)}</div><span class="badge ${stCls}">${st}</span></div>
      <div class="li-sub">${x.source ? '来源：' + esc(x.source) + '\n' : ''}${x.idea ? '想法：' + esc(x.idea) : ''}</div>
      <div style="margin-top:6px">${renderSeriesTag(seriesOf(x))}</div>
      ${x.direction ? renderDirection(x) : '<div class="tiny muted" style="margin-top:6px">还没有内容方向建议</div>'}
      <div class="row-actions" style="margin-top:8px">
        <button class="mini" data-act="edit-content" data-id="${x.id}">编辑</button>
        <button class="mini" data-act="gen-dir" data-id="${x.id}">${x.direction ? '重新生成方向' : '✨ 生成方向建议'}</button>
        <button class="mini ghost" data-act="del-content" data-id="${x.id}">删除</button></div></div>`;
  }
  function renderHotItem(h, todayNo) {
    const fitCls = h.fit === '适合' ? 's2' : h.fit === '可参考' ? 's1' : 's4';
    // 优先打开「具体原内容 URL」（contentUrl），没有才退回「热榜/搜索备用」（fallbackUrl）
    // 绝不用热榜链接伪装成原视频
    const contentUrl = h.contentUrl || (h.linkType === 'real' && h.link ? h.link : '');
    const fallbackUrl = h.fallbackUrl || (h.linkType !== 'real' && h.link ? h.link : '');
    let linkTypeBadge, linkHtml;
    if (contentUrl) {
      const isVideo = /(抖音|视频号|B站|YouTube|西瓜)/.test(h.source || '');
      const openLabel = h.linkType === 'weixin' ? '在微信打开 ↗' : (isVideo ? '查看原视频 ↗' : '查看原内容 ↗');
      linkTypeBadge = '<span class="badge s2">原内容链接</span>';
      linkHtml = `<a class="chip link" href="${esc(contentUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${openLabel}</a>`;
    } else if (h.linkType === 'weixin') {
      linkTypeBadge = '<span class="badge warn">视频号 · 仅微信打开</span>';
      linkHtml = fallbackUrl
        ? `<a class="chip link" href="${esc(fallbackUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">在微信打开 ↗</a>`
        : '<span class="tiny muted">视频号具体视频只能在微信内打开（粘贴该视频「分享链接」即可直达）。</span>';
    } else if (fallbackUrl) {
      // 自动种子只能拿到「话题 / 榜单搜索页」，如实标注，不伪装成原视频
      linkTypeBadge = '<span class="badge warn">榜单 / 搜索参考</span>';
      linkHtml = `<a class="chip link" href="${esc(fallbackUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">查看相关热榜 / 搜索 ↗</a>`;
    } else {
      linkTypeBadge = '<span class="badge warn">暂无具体链接</span>';
      linkHtml = '<span class="tiny muted">自动热点暂无具体视频链接；点「编辑热点」粘贴真实分享链接即可直达原内容。</span>';
    }
    const a = h.analysis || {};
    const open = App.folds['hotanal-' + h.id] ? 'open' : '';
    const teaser = a.whyHot || h.why || '点开看如何结合';
    const analysisFold = (a.whyHot || a.discussion || a.angle)
      ? `<div class="fold ${open}">
          <div class="fold-head" data-act="fold" data-target="hotanal-${h.id}"><span class="arrow">▸</span><span class="fold-t">如何结合分析：${esc(teaser)}</span></div>
          <div class="fold-body">${renderHotAnalysis(a)}</div>
        </div>`
      : (h.combine ? `<div class="li-sub"><b>如何结合：</b>${esc(h.combine)}</div>` : '');
    // 今日更新序号：todayNo 为数字（1/2/3…），不含 #；非今日则显示「历史热点」
    const todayTag = todayNo != null ? ('今日第 ' + todayNo + ' 条') : '历史热点';
    return `<div class="list-item hot"><div class="li-top">
      <span class="rank">${h.rank != null ? h.rank : '—'}</span>
      <div class="li-title">${esc(h.topic)}</div>${h.collected ? '<span class="badge s2">已收录</span>' : ''}</div>
      <div class="li-sub">
        <b>排序：</b>${h.rank != null ? h.rank : '—'}　<b>今日序号：</b>${todayTag}<br>
        <b>平台：</b>${esc(h.source || '—')}　<b>热度：</b>${esc(h.heat || '—')}　<b>适合：</b><span class="badge ${fitCls}">${esc(h.fit || '—')}</span><br>
        <b>适合系列：</b>${renderSeriesTag(seriesOf(h))}<br>
        <b>链接类型：</b>${linkTypeBadge}　<b>具体内容链接：</b>${linkHtml}
      </div>
      ${analysisFold}
      <div class="row-actions" style="margin-top:8px">
        ${h.collected ? '' : `<button class="mini green" data-act="collect-hot" data-id="${h.id}">收录为选题</button>`}
        <button class="mini ghost" data-act="del-hot" data-id="${h.id}">删除</button></div></div>`;
  }
  // 热点「如何结合」10 点分析（纯本地启发式，不生成完整口播稿）
  function renderHotAnalysis(a) {
    if (!a || !a.whyHot) return '';
    const row = (label, val) => val ? `<div class="ha-row"><b>${label}：</b>${esc(val)}</div>` : '';
    return `<div class="ha-box">
      ${row('1. 热点为什么火', a.whyHot)}
      ${row('2. 大家主要在讨论什么', a.discussion)}
      ${row('3. 可以借什么情绪', a.emotion)}
      ${row('4. 和你的连接点', a.connection)}
      ${row('5. 切入角度', a.angle)}
      ${row('6. 推荐视频类型', a.videoType)}
      ${row('7. 推荐系列', a.series)}
      ${row('8. 开头（前 3 秒）', a.opening)}
      ${row('9. 中间（讲什么）', a.middle)}
      ${row('10. 落点（结尾）', a.ending)}
      ${row('可借鉴的爆款形式', a.viralRef)}
    </div>`;
  }
  // 灵感链接占位封面：按平台 + 标题生成「有区分度」的视觉封面（拿不到真实封面时的兜底，避免所有链接长得一样）
  function hashStr(s) {
    let h = 0; s = (s || '').toString();
    for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
    return Math.abs(h);
  }
  const PLAT_ICON = { '小红书': '📕', '抖音': '🎵', '微博': '💬', '知乎': '📘', 'B站': '📺', '百度': '🔍', '今日头条': '📰', '视频号': '🟢', '微信公众号': '💚', 'YouTube': '▶️' };
  function inspCoverFallback(pname, title) {
    const base = platformColorOf(pname) || '#9DB8C9';
    const hue = hashStr(pname + '|' + (title || '')) % 360;
    const grad = 'linear-gradient(135deg,' + base + ' 0%,hsl(' + hue + ',52%,40%) 100%)';
    return { grad: grad, icon: PLAT_ICON[pname] || '🔗', pname: pname };
  }
  // 重新尝试抓取真实封面：仅补充 image 字段，绝不删除/重建原记录；平台 CORS 限制时会失败并保留占位封面
  function refetchCover(id) {
    const x = find(App.state.content, id); if (!x || x.kind !== 'link') return;
    if (!x.link) { toast('这条链接没有 URL，无法刷新'); return; }
    toast('正在尝试重新获取封面…');
    tryFetchMeta(x.link).then((meta) => {
      const it = find(App.state.content, id); if (!it) return;
      if (meta.image) { it.image = meta.image; save(); renderContent(); toast('封面已更新 ✅'); }
      else { toast('未能获取到真实封面（平台 CORS 限制），已保留区分度占位封面'); }
    }).catch(() => { toast('获取失败（平台 CORS 限制），已保留区分度占位封面'); });
  }
  function renderInspItem(x) {
    if (x.kind === 'link') {
      let host = '';
      try { host = x.link ? new URL(x.link).hostname : ''; } catch (e) { host = ''; }
      const pname = detectPlatform(host);
      const pcolor = platformColorOf(pname);
      // 竖排卡片：封面在上、信息在下（外层 .insp-cards 负责「并排成网格」，不是单卡内部左右）
      const fb = inspCoverFallback(pname, x.title);
      const cover = x.image
        ? `<a class="insp-cover" href="${esc(x.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="background-image:url('${esc(x.image)}')"></a>`
        : `<a class="insp-cover insp-cover--fb" href="${esc(x.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="background:${fb.grad}"><span class="fb-ico">${fb.icon}</span><span class="fb-plat">${esc(fb.pname)}</span></a>`;
      const linkHtml = x.link ? `<a class="chip link insp-open" href="${esc(x.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">打开链接 ↗</a>` : '';
      const shortSum = (x.summary || '').slice(0, 64);
      const aiDir = x.direction ? renderDirection(x) : '';
      const detailOpen = App.folds['inspd-' + x.id] ? '' : 'display:none';
      const detail = `<div class="li-sub insp-detail" id="insp-${x.id}" style="${detailOpen}">
        ${x.fetching ? '<span class="tiny muted">正在识别平台 / 尝试抓取标题与简介…</span>\n' : ''}
        ${x.summary ? '<b>摘要：</b>' + esc(x.summary) + '\n' : ''}
        ${x.refWhy ? '<b>值得参考：</b>' + esc(x.refWhy) + '\n' : ''}
        ${x.howMigrate ? '<b>如何迁移：</b>' + esc(x.howMigrate) : ''}
        ${!x.summary && !x.refWhy && !x.howMigrate && !x.fetching ? '<span class="tiny muted">暂未获取到正文，点「打开链接」查看。</span>' : ''}
        ${aiDir}</div>`;
      const detailBtn = App.folds['inspd-' + x.id] ? '收起细节' : '展开细节';
      return `<div class="list-item insp-card">
        ${cover}
        <div class="insp-body">
          <div class="li-title">${esc(x.title)}</div>
          <div class="insp-plat">${esc(pname)}　${linkHtml}</div>
          ${shortSum ? `<div class="insp-sum">${esc(shortSum)}${x.summary && x.summary.length > 64 ? '…' : ''}</div>` : ''}
          <div class="insp-tags">${renderSeriesTag(seriesOf(x))}</div>
          <div class="insp-acts">
            <button class="mini ghost" data-act="toggle-insp-detail" data-id="${x.id}">${detailBtn}</button>
            <button class="mini ghost" data-act="refetch-cover" data-id="${x.id}">刷新封面</button>
            <button class="mini" data-act="promote-insp" data-id="${x.id}">收录</button>
            <button class="mini" data-act="edit-content" data-id="${x.id}">编辑</button>
            <button class="mini ghost" data-act="del-content" data-id="${x.id}">删除</button>
          </div>
        </div>
        ${detail}</div>`;
    }
    return `<div class="list-item"><div class="li-top">
      <div class="li-title">${esc(x.title)}</div><span class="badge s1">灵感</span></div>
      <div style="margin-top:6px">${renderSeriesTag(seriesOf(x))}</div>
      ${x.direction ? renderDirection(x) : ''}
      <div class="row-actions" style="margin-top:8px">
        <button class="mini" data-act="promote-insp" data-id="${x.id}">收录为选题</button>
        <button class="mini" data-act="edit-content" data-id="${x.id}">编辑</button>
        <button class="mini" data-act="gen-dir" data-id="${x.id}">重新生成方向</button>
        <button class="mini ghost" data-act="del-content" data-id="${x.id}">删除</button></div></div>`;
  }
  // 编辑内容：极简 —— 只留 标题 / 适合系列 / 状态 / 链接（链接类额外 摘要/值得参考/如何迁移）。
  // 不再有「栏目 / 内容方向 / 想法 / 脚本 / 发布时间 / 数据复盘」等字段；AI 生成方向是系统结果，不在这里维护。
  function contentFields(it) {
    const fields = [
      { key: 'title', label: '标题', value: it.title, placeholder: '选题标题' },
      { key: 'series', label: '适合系列', type: 'series', value: it.series || '婧婧带你看泰国', hint: '固定三系列，不新增。' },
      { key: 'status', label: '状态', type: 'select', options: CSTATUS.map((c) => ({ v: c, t: c })), value: it.status || '灵感' },
    ];
    if (it.kind === 'link') {
      fields.push(
        { key: 'link', label: '链接', value: it.link, placeholder: 'https://…' },
        { key: 'summary', label: '摘要', type: 'textarea', value: it.summary, placeholder: '这条链接里值得记的要点' },
        { key: 'refWhy', label: '值得参考', type: 'textarea', value: it.refWhy, placeholder: '为什么值得你参考' },
        { key: 'howMigrate', label: '如何迁移', type: 'textarea', value: it.howMigrate, placeholder: '可以怎么变成你的内容' }
      );
    }
    return fields;
  }

  /* ============================================================
   *  热点雷达（已并入内容宇宙顶部 tab，下方函数仍保留供 case 调用）
   * ============================================================ */
  // ---- 链接构造 / 平台识别 / 元数据抓取 / 平台配色 ----
  // 纯前端无后端、且种子是「话题级」而非「具体视频」：
  //   - 能构造的最具体链接 = 各平台的话题/搜索结果页（仍标 linkType:'search'，并明确标注「平台搜索/榜单链接」）
  //   - 真正「原内容链接」只能来自你自己粘贴的具体分享链接（存为 linkType:'real'，直接打开）
  //   - 视频号无公开网页可直达具体视频（仅微信内 sph 分享链接），故不生成假链接，标 linkType:'weixin' 并提示
  function buildLinkUrl(platform, keyword) {
    const kw = encodeURIComponent((keyword || '').trim());
    const map = {
      '小红书':   'https://www.xiaohongshu.com/search_result?keyword=' + kw + '&source=web_explore_feed',
      '抖音':     'https://www.douyin.com/search/' + kw + '/',
      '微博':     'https://s.weibo.com/weibo?q=%23' + kw + '%23', // 微博超级话题页（真实内容聚合，比普通搜索更聚焦）
      '知乎':     'https://www.zhihu.com/search?type=content&q=' + kw,
      '百度':     'https://www.baidu.com/s?wd=' + kw,
      '今日头条': 'https://so.toutiao.com/search?keyword=' + kw + '&pd=information',
      'B站':      'https://search.bilibili.com/all?keyword=' + kw,
      '视频号':   '', // 视频号无公开网页可直达具体视频，交由 renderHotItem 提示「在微信内打开」
      '新闻':     'https://www.baidu.com/s?wd=' + kw,
      '热梗':     'https://s.weibo.com/weibo?q=%23' + kw + '%23',
      '爆款形式': 'https://www.douyin.com/search/' + kw + '/',
      '可借鉴拍摄方式': 'https://www.douyin.com/search/' + kw + '/',
      '可迁移表达方式': 'https://www.xiaohongshu.com/search_result?keyword=' + kw + '&source=web_explore_feed',
    };
    return map[platform] || ('https://www.baidu.com/s?wd=' + kw);
  }
  function detectPlatform(host) {
    const h = (host || '').toLowerCase();
    if (!h) return '网页';
    if (h.includes('xiaohongshu.com') || h.includes('xhslink.com')) return '小红书';
    if (h.includes('douyin.com')) return '抖音';
    if (h.includes('channels.weixin') || h.includes('video.weixin')) return '视频号';
    if (h.includes('weibo.com') || h.includes('weibo.cn')) return '微博';
    if (h.includes('toutiao.com')) return '今日头条';
    if (h.includes('zhihu.com')) return '知乎';
    if (h.includes('bilibili.com')) return 'B站';
    if (h.includes('baidu.com')) return '百度';
    if (h.includes('mp.weixin.qq.com')) return '微信公众号';
    if (h.includes('youtube.com') || h.includes('youtu.be')) return 'YouTube';
    return h.replace(/^www\./, '');
  }
  function platformColorOf(name) {
    const map = {
      '小红书': '#FF2442',
      '抖音': '#161823',
      '微博': '#E6162D',
      '知乎': '#0084FF',
      'B站': '#FB7299',
      '百度': '#2932E1',
      '今日头条': '#F85959',
      '视频号': '#07C160',
      '微信公众号': '#07C160',
      'YouTube': '#FF0000'
    };
    return map[name] || '#9DB8C9';
  }
  // 异步抓取原页面 og:title / og:description / og:image / <title> / meta description
  // 纯前端无后端：小红书/抖音/视频号等多数平台会因 CORS 失败 → 静默返回空，不影响主流程
  async function tryFetchMeta(url) {
    if (!url || !/^https?:\/\//i.test(url)) return { title: '', description: '', image: '' };
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const resp = await fetch(url, { method: 'GET', mode: 'cors', signal: ctrl.signal, headers: { 'Accept': 'text/html,*/*' } });
      clearTimeout(timer);
      if (!resp.ok) return { title: '', description: '', image: '' };
      const html = await resp.text();
      const ogT = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
      const ogD = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
      const ogI = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
      const md  = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
      const tt  = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      return {
        title: (ogT && ogT[1]) || (tt && tt[1].trim()) || '',
        description: (ogD && ogD[1]) || (md && md[1]) || '',
        image: (ogI && ogI[1]) || ''
      };
    } catch (e) { return { title: '', description: '', image: '' }; }
  }
  // 热点本地启发式分析（10 点；纯本地，无联网数据源）
  function buildHotAnalysis(seed, dir) {
    const platform = seed.source || '通用';
    const topic = seed.topic || '';
    const colName = ((COLS.find((c) => c.id === (seed.col || 'thailand'))) || {}).name || '婧婧带你看泰国';
    const isVlog = /(vlog|生活|拍摄|沉浸|日常)/.test(topic);
    const isInfo = /(攻略|避坑|测评|对比|签证|物价|清单|干货|规划|就业|变现)/.test(topic);
    const isStory = /(故事|经历|感受|真实|选择|采访|学姐|创业)/.test(topic);
    const viralRef = isVlog
      ? '常见形式：第一视角沉浸拍摄，3 秒内出现生活化场景；中段踩点切换；结尾留一句开放问题引导评论'
      : isInfo
      ? '常见形式：封面大字标题 + 分点列出真实数据/经验；中段给具体场景；结尾给可执行建议'
      : isStory
      ? '常见形式：开头抛具体场景或抉择，中段讲真实经历 + 转折，结尾给共鸣'
      : '常见形式：前 3 秒给一个反常识判断或具体场景，中段讲清楚为什么，结尾给一个可执行建议';
    return {
      whyHot: seed.why || '近期热度上升',
      discussion: '大家主要在讨论：' + (seed.discussion || '相关话题的关注度、对比、避坑与真实体验'),
      emotion: seed.emotion || '好奇 / 焦虑 / 实用收藏',
      connection: '和你「' + colName + '」的连接点：' + (seed.connection || '从真实亲历或观察切入，把热点话题转成可拍的角度'),
      angle: seed.angle || ('从「' + topic + '」切入，避免讲大道理，先给一个具体场景或问题'),
      videoType: seed.videoType || (isVlog ? 'vlog / 第一视角' : isInfo ? '信息密度型 / 测评干货' : isStory ? '口播 / 故事讲述' : '混合形式'),
      series: colName,
      opening: dir && dir.hook ? dir.hook : '前 3 秒直接抛一个具体场景或问题',
      middle: dir && dir.about ? dir.about : '讲 2–3 个具体要点，用真实细节支撑',
      ending: dir && dir.extend ? dir.extend : '收尾给一个行动建议或共鸣点',
      viralRef: viralRef
    };
  }
  // 脚本只给框架：开头 / 中间点 / 落点（不生成完整口播稿）
  function genScript(title, d) {
    return '【开头】' + (d.hook || '用一个具体场景或问题开场，3 秒内抓住注意力。') + '\n'
      + '【中间点】' + (d.about || '讲 2–3 个具体要点，用真实细节支撑。') + '\n'
      + '【落点】' + (d.extend || '收尾给一个行动建议或共鸣点，引导点赞收藏。');
  }
  // ⚠️ 数据安全：绝对不删除任何已有热点。仅在「同 topic+source 不存在」时 APPEND。
  function genHot() {
    const s = App.state;
    const batch = 'h' + Date.now().toString(36);
    const seeds = [
      { topic: '泰国免签政策再调整', source: '新闻', heat: '高', why: '直接影响赴泰人群，搜索量大', col: 'thailand', fit: '适合',
        discussion: '要不要现在办签证、落地要不要补材料、对学生党有什么影响',
        emotion: '实用 / 怕错过',
        connection: '你人在泰国，第一视角讲「最新政策 + 实际操作」',
        angle: '不念政策原文，直接说「我刚去办 / 身边朋友刚经历」',
        videoType: '信息密度型 + 第一视角实拍' },
      { topic: '一个人去泰国生活 vlog 爆火', source: '抖音', heat: '高', why: '沉浸式内容涨粉快', col: 'thailand', fit: '适合',
        discussion: '孤独感、自由感、租房吃饭日常开销',
        emotion: '向往 / 治愈',
        connection: '你本身就是「一个人去泰国生活」的主角',
        angle: '一周真实生活 vlog，账单 + 路线 + 吃饭',
        videoType: 'vlog / 第一视角沉浸' },
      { topic: '女性轻创业话题升温', source: '视频号', heat: '中', why: '女性成长受众精准', col: 'listens', fit: '适合',
        discussion: '要不要辞职创业、起步资金多少、女性做内容是不是更好',
        emotion: '共鸣 / 焦虑',
        connection: '你正在做的事就是女性轻创业 + 内容',
        angle: '聊你最真实的一次选择和当时的理由',
        videoType: '口播 / 故事讲述' },
      { topic: '留学生回国就业现状', source: '小红书', heat: '高', why: '家长/学生焦虑高、互动强', col: 'listens', fit: '适合',
        discussion: '留学到底值不值、回国找工作卡哪里、HR 看什么',
        emotion: '焦虑 / 纠结',
        connection: '你的留学生身份 + 求职或观察',
        angle: '听你说：采访一个留学回国的真实案例',
        videoType: '采访 / 对谈' },
      { topic: '校园食堂暗访系列走红', source: '抖音', heat: '中', why: '学生党共鸣强', col: 'campus', fit: '可参考',
        discussion: '食堂到底干不干净、一顿多少钱、有没有真正好吃的',
        emotion: '好奇 / 共鸣',
        connection: '你在校园 / 留学场景里直接实拍',
        angle: '暗访一餐，看厨房 / 价格 / 真实体验',
        videoType: 'vlog / 实拍' },
      { topic: '泰国物价真实测评', source: '小红书', heat: '高', why: '实用信息收藏率高', col: 'thailand', fit: '适合',
        discussion: '泰国到底便宜吗、一顿饭多少钱、房租多少',
        emotion: '实用 / 收藏',
        connection: '你在泰国，亲历账单最有说服力',
        angle: '一周真实账单拆解：吃饭 / 交通 / 房租 / 日常',
        videoType: '信息密度型 + 实拍' },
      { topic: '高考后留学规划热', source: '知乎', heat: '中', why: '节点性强、搜索精准', col: 'campus', fit: '适合',
        discussion: '什么时候准备、要不要找中介、家庭预算怎么算',
        emotion: '焦虑 / 期待',
        connection: '你的留学经验是最真实的样本',
        angle: '「如果重新来一次我怎么做」清单',
        videoType: '口播 / 清单型' },
      { topic: '反焦虑治愈系口播形式', source: '热梗', heat: '高', why: '形式可迁移到任意系列', col: 'listens', fit: '可参考',
        discussion: '大家都累了，不想再被贩卖焦虑',
        emotion: '治愈 / 平静',
        connection: '你的真实故事本身就是反焦虑素材',
        angle: '用你经历的一件具体的小事，讲「我曾经也这样，后来…」',
        videoType: '口播 / 治愈系' },
      { topic: '中英夹杂表达在短视频走红', source: '可迁移表达方式', heat: '中', why: '人设自然、易模仿', col: 'thailand', fit: '可参考',
        discussion: '双语背景的人怎么表达更自然',
        emotion: '新鲜 / 亲切',
        connection: '你的双语背景是天然资源',
        angle: '在日常场景自然夹杂，记录一段真实对话',
        videoType: 'vlog / 第一视角' },
      { topic: '泰国旅游避坑合集', source: '抖音', heat: '高', why: '刚需、收藏高', col: 'thailand', fit: '适合',
        discussion: '第一次去泰国最怕被坑什么',
        emotion: '焦虑 / 实用',
        connection: '你亲历踩坑最可信',
        angle: '列出 5 个你真实踩过的坑，每个讲一个具体场景',
        videoType: '信息密度型 + 实拍' },
      { topic: '大学宿舍改造爆款', source: '小红书', heat: '中', why: '视觉化、易拍', col: 'campus', fit: '可参考',
        discussion: '宿舍到底能不能住得舒服、改造花多少钱',
        emotion: '向往 / 实用',
        connection: '你可以拍「留学宿舍真实样子」',
        angle: '实拍你现在的宿舍/房间，不刻意改造',
        videoType: 'vlog / 第一视角' },
      { topic: '学姐说人设受捧', source: '爆款形式', heat: '中', why: '贴合你的人设', col: 'listens', fit: '适合',
        discussion: '过来人讲真话比教程更打动人',
        emotion: '信任 / 共鸣',
        connection: '你天然就是「学姐说」',
        angle: '讲一个具体学弟学妹的提问 + 你的真实建议',
        videoType: '口播 / 学姐视角' },
      { topic: '海外生活文化差异梗', source: '热梗', heat: '中', why: '易传播', col: 'thailand', fit: '可参考',
        discussion: '出国后才发现的「原来如此」',
        emotion: '好奇 / 笑点',
        connection: '你每天都在经历',
        angle: '「我以为 / 结果」反差对比，3 个具体例子',
        videoType: '口播 / 梗型' },
      { topic: '副业变现经验贴', source: '小红书', heat: '高', why: '搜索量大', col: 'listens', fit: '可参考',
        discussion: '普通人能不能靠副业赚到第一桶金',
        emotion: '期待 / 焦虑',
        connection: '你正在做内容副业',
        angle: '「我做副业第一年真实收入」账单展示',
        videoType: '信息密度型 / 个人故事' },
      { topic: '泰国签证攻略长文收藏高', source: '知乎', heat: '中', why: '实用、长尾流量', col: 'thailand', fit: '适合',
        discussion: '留学签 / 落地签 / 养老签怎么选',
        emotion: '实用 / 焦虑',
        connection: '你的真实操作经验',
        angle: '「我办 XX 签证的真实流程 + 时间 + 钱」',
        videoType: '信息密度型 / 攻略' },
      { topic: '真实记录不加滤镜拍摄方式', source: '可借鉴拍摄方式', heat: '中', why: '真实感涨粉', col: 'campus', fit: '适合',
        discussion: '真实感 > 精包装，观众更信任',
        emotion: '信任 / 舒服',
        connection: '少包装多真实刚好适合你的内容',
        angle: '拍你今天的一段真实日常，不加字幕不加滤镜',
        videoType: 'vlog / 真实记录' },
    ];
    let added = 0, skipped = 0;
    seeds.forEach((sd, i) => {
      // 去重：同 topic + source 已存在则跳过（永不删除现有数据）；匹配到的标记为「今日已刷新」
      const dup = s.hotspots.find((h) => h.topic === sd.topic && h.source === sd.source);
      if (dup) { dup.date = today(); skipped++; return; }
      const sg = suggestHot(sd.topic);
      const dir = suggestDirection(sd.topic, sd.why);
      const analysis = buildHotAnalysis(sd, dir);
      const isWeixin = sd.source === '视频号';
      const url = isWeixin ? '' : buildLinkUrl(sd.source, sd.topic);
      s.hotspots.push(Object.assign(
        { id: uid(), date: today(), collected: false, auto: true, batch: batch,
          rank: i + 1,
          suggestedTopic: sd.topic,
          series: dir.series,
          linkType: isWeixin ? 'weixin' : 'search',
          contentUrl: '',                 // 具体视频/新闻 URL：自动种子无，仅手动粘贴真实链接才有
          fallbackUrl: url,               // 热榜/搜索备用链接（自动种子仅有这一级）
          link: url },                    // 兼容旧字段 = fallbackUrl
        sd, { col: sd.col || sg.col, analysis: analysis, combine: sd.angle || (dir && dir.extend) || '可结合你的系列切入' }
      ));
      added++;
    });
    save(); renderContent();
    const todayCount = s.hotspots.filter((h) => h.date === today()).length;
    toast('今日已更新 ' + todayCount + ' 条热点' + (added ? '（新增 ' + added + '）' : ' 🌿'));
  }
  function collectHot(id) {
    const h = App.state.hotspots.find((x) => x.id === id); if (!h) return;
    // 把热点自带的「为什么适合你 / 切入角度 / 推荐视频类型」一起喂给方向生成，避免泛话
    const ctx = (h.why || '') + ' ' + ((h.analysis && h.analysis.angle) || '') + ' ' + ((h.analysis && h.analysis.videoType) || '');
    const d = suggestDirection(h.topic, ctx);
    App.state.content.push({
      id: uid(), col: h.col || 'thailand', title: h.topic, status: '灵感',
      source: h.source, link: h.link || '', summary: h.why || '',
      series: d.series, direction: d, idea: d.hook, script: genScript(h.topic, d),
      createdAt: today()
    });
    h.collected = true; save(); renderContent(); toast('已收录为选题 🎬');
  }
  // ---- 灵感库：链接 / 随手记录（统一进入选题管理体系 s.content）----
  // 灵感库链接：先保存（绝不因抓取失败而丢链接），后异步尝试抓标题/简介/平台/方向
  // 纯前端无后端：多数平台会因 CORS 失败 → 静默降级，最少保留链接 + 提示
  function addInspLink(url, title) {
    url = (url || '').trim(); if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    let host = url;
    try { host = new URL(url).hostname; } catch (e) { /* 保留原串 */ }
    const id = uid();
    App.state.content.push({ id: id, kind: 'link', link: url, title: title || host, summary: '', refWhy: '', howMigrate: '', image: '', status: '灵感', createdAt: today(), fetching: true });
    save(); renderContent(); toast('已保存链接 🔗（正在识别平台 / 抓标题）');
    tryFetchMeta(url).then((meta) => {
      const it = find(App.state.content, id); if (!it) return; // 已被删则不回填，避免脏写
      const t = (meta.title || '').replace(/\s+/g, ' ').trim();
      const d = (meta.description || '').replace(/\s+/g, ' ').trim();
      if (!title && t) it.title = t.slice(0, 120);
      if (d) it.summary = d.slice(0, 300);
      if (meta.image) it.image = meta.image;
      const dir = suggestDirection(it.title, '');
      it.direction = dir; it.series = dir.series;
      // 基于真实抓取到的标题/简介，给出「值得参考 / 如何迁移」具体分析（不泛谈）
      const pname = detectPlatform(host);
      const ia = buildInspAnalysis(it.title, it.summary, pname, dir.series);
      it.refWhy = ia.why; it.howMigrate = ia.how;
      it.fetching = false;
      save(); renderContent();
    }).catch(() => {
      const it = find(App.state.content, id); if (it) { it.fetching = false; save(); renderContent(); }
    });
  }
  function addInspNote(text) {
    text = (text || '').trim(); if (!text) return;
    const d = suggestDirection(text, '');
    App.state.content.push({ id: uid(), kind: 'note', title: text, status: '灵感', series: d.series, direction: d, idea: d.hook, script: genScript(text, d), createdAt: today() });
    save(); renderContent(); toast('已记录灵感，AI 给了方向框架 💡');
  }
  function promoteInsp(id) {
    const x = find(App.state.content, id); if (!x) return;
    const d = x.direction || suggestDirection(x.title, x.idea);
    const col = SERIES_COL[d.series] || 'thailand';
    x.kind = undefined; x.col = col; x.series = d.series; x.direction = d; x.status = x.status || '灵感';
    save(); renderContent(); toast('已收录为选题，进入「' + ((COLS.find((c) => c.id === col) || {}).name || col) + '」🎬');
  }

  /* ============================================================
   *  教育 CRM
   * ============================================================ */
  const STAGES = ['流量触达', '私信咨询', '已获取联系方式', '微信已添加', '微信未回复', '已沟通', '需求确认', '方案发送', '等待决定', '成交', '长期培育'];
  function renderCRM() {
    const s = App.state;
    const td = today();
    const due = s.customers.filter((c) => c.followUpTime && c.followUpTime <= td && c.stage !== '成交' && c.stage !== '长期培育').length;
    let html = `<div class="card"><h3>🌿 教育 CRM <span class="tag">${due ? '有 ' + due + ' 位待跟进' : '跟进顺畅'}</span></h3>
      <div class="tiny muted" style="margin-bottom:8px">按成交流程记录：${STAGES.join(' → ')}</div>
      <button class="btn sm" data-act="add-customer">+ 新增客户</button></div>`;
    const list = s.customers.slice().reverse();
    if (!list.length) html += `<div class="empty"><span class="em">🌿</span>还没有客户记录。每来一个咨询，随手建一条。</div>`;
    list.forEach((c) => {
      const si = STAGES.indexOf(c.stage);
      const dueNow = c.followUpTime && c.followUpTime <= td && c.stage !== '成交' && c.stage !== '长期培育';
      html += `<div class="list-item"><div class="li-top">
        <div class="li-title">${esc(c.nickname || '未命名')}</div>
        <span class="badge ${dueNow ? 'warn' : 's1'}">${esc(c.stage || '流量触达')}</span></div>
        <div class="li-sub">${c.sourcePlatform ? '来源：' + esc(c.sourcePlatform) + '　' : ''}${c.sourceVideo ? '视频：' + esc(c.sourceVideo) + '\n' : ''}
        ${c.childAge ? '孩子年龄：' + esc(c.childAge) + '　' : ''}${c.need ? '需求：' + esc(c.need) + '\n' : ''}
        ${c.budget ? '预算：' + esc(c.budget) + '　' : ''}${c.nextAction ? '下一步：' + esc(c.nextAction) + '\n' : ''}
        ${c.followUpTime ? '跟进时间：' + esc(c.followUpTime) + (dueNow ? ' ⏰待跟进' : '') : ''}</div>
        <div style="margin-top:6px">${STAGES.slice(0, si + 1).map((st) => `<span class="chip" style="font-size:10px;padding:1px 6px">${st}</span>`).join(' ')}</div>
        <div class="row-actions" style="margin-top:8px">
          <button class="mini" data-act="edit-customer" data-id="${c.id}">编辑</button>
          <button class="mini ghost" data-act="del-customer" data-id="${c.id}">删除</button></div></div>`;
    });
    $('#view').innerHTML = html;
    setPage('教育 CRM');
  }
  function customerFields(c) {
    return [
      { key: 'nickname', label: '昵称', value: c.nickname },
      { key: 'sourcePlatform', label: '来源平台', value: c.sourcePlatform, placeholder: '抖音/小红书/视频号…' },
      { key: 'sourceVideo', label: '来源视频', value: c.sourceVideo },
      { key: 'consultTime', label: '咨询时间', value: c.consultTime, placeholder: '2026-08-07' },
      { key: 'childAge', label: '孩子年龄', value: c.childAge },
      { key: 'need', label: '需求', type: 'textarea', value: c.need },
      { key: 'budget', label: '预算', value: c.budget },
      { key: 'stage', label: '当前阶段', type: 'select', options: STAGES.map((x) => ({ v: x, t: x })), value: c.stage || '流量触达' },
      { key: 'nextAction', label: '下一步动作', value: c.nextAction },
      { key: 'followUpTime', label: '跟进时间', value: c.followUpTime, placeholder: '2026-08-09' },
    ];
  }

  /* ============================================================
   *  电商实验室
   * ============================================================ */
  const ECOM = [
    { id: 'account', name: '账号现状' }, { id: 'product', name: '产品分析' },
    { id: 'competitor', name: '竞品分析' }, { id: 'test', name: '测试记录' },
    { id: 'data', name: '数据记录' }, { id: 'review', name: '问题复盘' },
  ];
  let ecomCat = 'account';
  function renderEcom() {
    const s = App.state;
    const tabs = ECOM.map((c) => `<button class="tab ${c.id === ecomCat ? 'active' : ''}" data-act="filter-ecom" data-id="${c.id}">${c.name}</button>`).join('');
    let html = `<div class="card"><h3>🛒 电商实验室 <span class="tag">探索阶段 · 轻量梳理</span></h3>
      <div class="tabs">${tabs}</div><button class="btn sm" data-act="add-ecom">+ 添加记录</button></div>`;
    const list = s.ecommerce.filter((x) => x.category === ecomCat).slice().reverse();
    if (!list.length) html += `<div class="empty"><span class="em">🧪</span>这个分类还没有记录，从第一条开始梳理。</div>`;
    list.forEach((x) => {
      const isTest = x.category === 'test';
      html += `<div class="list-item"><div class="li-top"><div class="li-title">${esc(x.title)}</div></div>
        <div class="li-sub">${x.content ? esc(x.content) + '\n' : ''}
        ${isTest ? `${x.testWhat ? '测试什么：' + esc(x.testWhat) + '\n' : ''}${x.why ? '为什么：' + esc(x.why) + '\n' : ''}${x.result ? '结果：' + esc(x.result) + '\n' : ''}${x.nextOpt ? '下一步优化：' + esc(x.nextOpt) : ''}` : ''}</div>
        <div class="row-actions" style="margin-top:8px">
          <button class="mini" data-act="edit-ecom" data-id="${x.id}">编辑</button>
          <button class="mini ghost" data-act="del-ecom" data-id="${x.id}">删除</button></div></div>`;
    });
    $('#view').innerHTML = html;
    setPage('电商实验室');
  }
  function ecomFields(x) {
    const base = [
      { key: 'title', label: '标题', value: x.title },
      { key: 'content', label: '内容', type: 'textarea', value: x.content },
    ];
    if (x.category === 'test') base.push(
      { key: 'testWhat', label: '测试什么', type: 'textarea', value: x.testWhat },
      { key: 'why', label: '为什么测试', type: 'textarea', value: x.why },
      { key: 'result', label: '结果', type: 'textarea', value: x.result },
      { key: 'nextOpt', label: '下一步优化', type: 'textarea', value: x.nextOpt });
    return base;
  }

  /* ============================================================
   *  个人成长（含英语/健康/财富/复盘/决策 四个子页）
   * ============================================================ */
  let selfView = 'grow'; // grow | wealth | review | decision
  function renderSelf() {
    const tabs = `<div class="tabs">
      <button class="tab ${selfView==='grow'?'active':''}" data-act="self-tab" data-id="grow">🌟 打卡</button>
      <button class="tab ${selfView==='wealth'?'active':''}" data-act="self-tab" data-id="wealth">💰 财富</button>
      <button class="tab ${selfView==='review'?'active':''}" data-act="self-tab" data-id="review">🪞 复盘</button>
      <button class="tab ${selfView==='decision'?'active':''}" data-act="self-tab" data-id="decision">🧭 决策</button>
    </div>`;
    const inner = ({
      grow: renderSelfGrow,
      wealth: renderSelfWealth,
      review: renderSelfReview,
      decision: renderSelfDecision,
    }[selfView] || renderSelfGrow)();
    $('#view').innerHTML = tabs + inner;
    setPage('个人成长');
    if (selfView === 'grow') {
      const en = $('#qa-en'); if (en) en.onkeydown = (e) => { if (e.key === 'Enter') addEnglish(); };
    }
  }

  function renderSelfGrow() {
    const s = App.state;
    const enTotal = s.english.reduce((a, e) => a + (Number(e.minutes) || 0), 0);
    const enList = s.english.slice().reverse().slice(0, 8);
    const heList = s.health.slice().reverse().slice(0, 8);
    let html = `<div class="card"><h3>🌟 英语学习 <span class="tag">累计 ${num(enTotal / 60, 1)} 小时</span></h3>
      <div class="grid2">
        <div class="stat"><div class="n">${num(enTotal / 60, 1)}</div><div class="l">累计学习（小时）</div></div>
        <div class="stat"><div class="n">${s.english.length}</div><div class="l">累计打卡次数</div></div>
      </div>
      <div class="quick-add" style="margin-top:10px"><input id="qa-en" placeholder="今天学了什么？如 Duolingo 20分钟">
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn sm" data-act="add-english">+ 记录学习</button></div></div>`;
    enList.forEach((e) => {
      html += `<div class="list-item"><div class="li-top"><div class="li-title">${esc(e.type || '学习')} · ${e.minutes} 分钟</div>
        <span class="badge">${esc(e.date)}</span></div>${e.note ? `<div class="li-sub">${esc(e.note)}</div>` : ''}
        <div class="row-actions" style="margin-top:6px"><button class="mini ghost" data-act="del-english" data-id="${e.id}">删除</button></div></div>`;
    });
    html += `<div class="card"><h3>💪 健康管理 <span class="tag">睡眠 · 运动 · 状态</span></h3>
      <button class="btn sm" data-act="add-health">+ 记录今天</button></div>`;
    heList.forEach((h) => {
      html += `<div class="list-item"><div class="li-top"><div class="li-title">${h.state || '状态'} · 睡眠 ${h.sleep || '-'}h</div>
        <span class="badge">${esc(h.date)}</span></div>
        <div class="li-sub">${h.exercise ? '运动：' + esc(h.exercise) + '\n' : ''}${h.note ? esc(h.note) : ''}</div>
        <div class="row-actions" style="margin-top:6px"><button class="mini ghost" data-act="del-health" data-id="${h.id}">删除</button></div></div>`;
    });
    return html;
  }
  function addEnglish() {
    const el = $('#qa-en'); const v = el ? el.value.trim() : '';
    openForm('记录英语学习', [
      { key: 'type', label: '类型', type: 'select', options: [{ v: 'Duolingo', t: 'Duolingo 打卡' }, { v: '听力输入', t: '听力输入' }, { v: '美剧学习', t: '美剧学习' }, { v: '其他', t: '其他' }], value: 'Duolingo' },
      { key: 'minutes', label: '时长（分钟）', value: v.match(/\d+/) ? v.match(/\d+/)[0] : '20' },
      { key: 'date', label: '日期', value: today() },
      { key: 'note', label: '备注', value: v, type: 'textarea' },
    ], null, (fd) => { App.state.english.push(Object.assign({ id: uid() }, fd)); save(); renderSelf(); toast('已记录 🌟'); });
  }
  function addHealth() {
    openForm('记录健康', [
      { key: 'sleep', label: '睡眠（小时）', value: '7' },
      { key: 'exercise', label: '运动', placeholder: '跑步/瑜伽/无' },
      { key: 'state', label: '身体状态', type: 'select', options: [{ v: '好', t: '好' }, { v: '一般', t: '一般' }, { v: '累', t: '累' }], value: '好' },
      { key: 'date', label: '日期', value: today() },
      { key: 'note', label: '备注', type: 'textarea' },
    ], null, (fd) => { App.state.health.push(Object.assign({ id: uid() }, fd)); save(); renderSelf(); toast('已记录 💪'); });
  }

  function renderSelfWealth() {
    const s = App.state;
    const total = s.income.reduce((a, i) => a + (Number(i.amount) || 0), 0);
    const byMonth = {};
    s.income.forEach((i) => { const m = (i.date || today()).slice(0, 7); byMonth[m] = (byMonth[m] || 0) + (Number(i.amount) || 0); });
    const months = Object.keys(byMonth).sort().slice(-8);
    const max = Math.max(1, ...months.map((m) => byMonth[m]));
    let html = `<div class="card"><h3>💰 财富中心 <span class="tag">累计 ${num(total)} 元</span></h3>
      <div class="grid2"><div class="stat"><div class="n">${num(total)}</div><div class="l">累计收入（元）</div></div>
      <div class="stat"><div class="n">${s.income.length}</div><div class="l">记录笔数</div></div></div>
      <div class="trend">${months.map((m) => `<div class="col"><div class="v">${num(byMonth[m])}</div>
        <div class="bar2" style="height:${Math.round(byMonth[m] / max * 90)}px"></div><div class="m">${m.slice(5)}月</div></div>`).join('') || '<div class="muted tiny">还没有收入记录。</div>'}</div>
      <button class="btn sm" data-act="add-income" style="margin-top:6px">+ 记录收入</button></div>`;
    s.income.slice().reverse().slice(0, 12).forEach((i) => {
      html += `<div class="list-item"><div class="li-top"><div class="li-title">${num(i.amount)} 元</div>
        <span class="badge">${esc(i.source || '其他')}</span><span class="badge">${esc(i.date)}</span></div>
        <div class="row-actions" style="margin-top:6px"><button class="mini ghost" data-act="del-income" data-id="${i.id}">删除</button></div></div>`;
    });
    return html;
  }
  function addIncome() {
    openForm('记录收入', [
      { key: 'date', label: '日期', value: today() },
      { key: 'amount', label: '金额（元）', value: '' },
      { key: 'source', label: '来源', type: 'select', options: [{ v: '工资', t: '工资' }, { v: '咨询', t: '咨询' }, { v: '合作', t: '合作' }, { v: '其他', t: '其他' }], value: '咨询' },
    ], null, (fd) => { if (!fd.amount) return; App.state.income.push(Object.assign({ id: uid() }, fd)); save(); renderSelf(); toast('已记录 💰'); });
  }

  function renderSelfReview() {
    const s = App.state;
    let html = `<div class="card"><h3>🪞 成长复盘室 <span class="tag">用外部视角看自己</span></h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn sm" data-act="add-review" data-type="day">✍️ 写今日复盘</button>
        <button class="btn soft sm" data-act="add-review" data-type="week">写每周复盘</button>
        <button class="btn soft sm" data-act="add-review" data-type="month">写每月复盘</button>
      </div></div>`;
    const list = s.reviews.slice().reverse();
    if (!list.length) html += `<div class="empty"><span class="em">🪞</span>每天结束前花 3 分钟复盘，长期会看到自己的成长曲线。</div>`;
    list.forEach((r) => {
      html += `<div class="list-item"><div class="li-top"><div class="li-title">${r.type === 'day' ? '每日' : r.type === 'week' ? '每周' : '每月'}复盘</div>
        <span class="badge">${esc(r.date)}</span>${r.ai ? '<span class="badge s2">AI 已分析</span>' : ''}</div>
        <div class="li-sub">${r.done ? '完成：' + esc(r.done) + '\n' : ''}${r.ignored ? '忽略：' + esc(r.ignored) + '\n' : ''}
        ${r.good ? '做得好：' + esc(r.good) + '\n' : ''}${r.improve ? '可优化：' + esc(r.improve) + '\n' : ''}
        ${r.tomorrow ? '明天最重要：' + esc(r.tomorrow) + '\n' : ''}${r.ai ? 'AI 视角：' + esc(r.ai) : ''}</div>
        <div class="row-actions" style="margin-top:8px">
          ${r.ai ? '' : (r.type === 'day' ? `<button class="mini green" data-act="ai-review" data-id="${r.id}">AI 分析</button>` : '')}
          <button class="mini" data-act="edit-review" data-id="${r.id}">编辑</button>
          <button class="mini ghost" data-act="del-review" data-id="${r.id}">删除</button></div></div>`;
    });
    return html;
  }
  function reviewFields(r) {
    return [
      { key: 'date', label: '日期', value: r.date || today() },
      { key: 'done', label: '今天/本周/本月完成了什么？', type: 'textarea', value: r.done },
      { key: 'ignored', label: '忽略了什么？', type: 'textarea', value: r.ignored },
      { key: 'good', label: '做得好的地方？', type: 'textarea', value: r.good },
      { key: 'improve', label: '哪些可以优化？', type: 'textarea', value: r.improve },
      { key: 'tomorrow', label: '下一步最重要的事？', type: 'textarea', value: r.tomorrow },
    ];
  }

  function renderSelfDecision() {
    const s = App.state;
    let html = `<div class="card"><h3>🧭 决策库 <span class="tag">避免反复想同一件事</span></h3>
      <button class="btn sm" data-act="add-decision">+ 记录一个决策</button></div>`;
    const list = s.decisions.slice().reverse();
    if (!list.length) html += `<div class="empty"><span class="em">🧭</span>重要决定记下来，未来的你会感谢现在。</div>`;
    list.forEach((d) => {
      html += `<div class="list-item"><div class="li-top"><div class="li-title">${esc(d.question)}</div><span class="badge">${esc(d.date)}</span></div>
        <div class="li-sub">${d.factors ? '考虑因素：' + esc(d.factors) + '\n' : ''}${d.decision ? '决定：' + esc(d.decision) + '\n' : ''}
        ${d.result ? '结果：' + esc(d.result) + '\n' : ''}${d.lesson ? '经验：' + esc(d.lesson) : ''}</div>
        <div class="row-actions" style="margin-top:8px">
          <button class="mini" data-act="edit-decision" data-id="${d.id}">编辑</button>
          <button class="mini ghost" data-act="del-decision" data-id="${d.id}">删除</button></div></div>`;
    });
    return html;
  }
  function decisionFields(d) {
    return [
      { key: 'question', label: '问题', type: 'textarea', value: d.question },
      { key: 'factors', label: '考虑因素', type: 'textarea', value: d.factors },
      { key: 'decision', label: '最终决定', type: 'textarea', value: d.decision },
      { key: 'result', label: '结果', type: 'textarea', value: d.result },
      { key: 'lesson', label: '经验总结', type: 'textarea', value: d.lesson },
      { key: 'date', label: '日期', value: d.date || today() },
    ];
  }

  /* ============================================================
   *  AI 档案
   * ============================================================ */
  function computeObservations() {
    const s = App.state;
    const obs = [];
    const cnt = {};
    s.tasks.forEach((t) => { if (t.cat) cnt[t.cat] = (cnt[t.cat] || 0) + 1; });
    const topCat = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
    if (topCat) obs.push({ key: '高频业务', value: '你最常处理「' + catName(topCat) + '」类事务（' + cnt[topCat] + ' 次）' });
    if (s.customers.length) obs.push({ key: '教育客户', value: '已积累 ' + s.customers.length + ' 位教育咨询客户，CRM 是核心资产' });
    if (s.content.length) obs.push({ key: '内容偏好', value: '内容宇宙已有 ' + s.content.length + ' 个选题，持续在产出' });
    const en = s.english.reduce((a, e) => a + (Number(e.minutes) || 0), 0);
    if (en > 0) obs.push({ key: '学习节奏', value: '英语学习累计 ' + num(en / 60, 1) + ' 小时，保持输入' });
    return obs;
  }
  function renderAIProfile() {
    const s = App.state;
    const confirmed = s.aiProfile.confirmed || [];
    const auto = computeObservations().filter((o) => !confirmed.find((c) => c.key === o.key));
    let html = `<div class="card"><h3>🤖 我的 AI 档案 <span class="tag">长期记忆需你确认</span></h3>
      <div class="tiny muted" style="margin-bottom:10px">AI 会随着使用逐渐了解你的工作方式，但所有长期记忆都要经过你确认。AI 只帮忙整理与提醒，不替代你的判断。</div></div>`;
    if (auto.length) {
      html += `<div class="card"><h3>🔎 观察到的你</h3>`;
      auto.forEach((o) => {
        html += `<div class="list-item"><div class="li-sub"><b>${esc(o.key)}：</b>${esc(o.value)}</div>
          <div class="row-actions" style="margin-top:8px">
            <button class="mini green" data-act="confirm-obs" data-key="${esc(o.key)}" data-val="${esc(o.value)}">确认记入档案</button>
            <button class="mini ghost" data-act="ignore-obs" data-key="${esc(o.key)}">忽略</button></div></div>`;
      });
      html += `</div>`;
    }
    html += `<div class="card"><h3>📁 已确认的档案</h3>`;
    if (!confirmed.length) html += `<div class="empty"><span class="em">🤖</span>还没有确认的记忆。使用越久，这里越丰富。</div>`;
    confirmed.forEach((c) => { html += `<div class="list-item"><div class="li-sub"><b>${esc(c.key)}：</b>${esc(c.value)}</div></div>`; });
    html += `<button class="btn soft sm" data-act="add-obs" style="margin-top:6px">+ 手动添加一条</button></div>`;
    $('#view').innerHTML = html;
    setPage('AI 档案');
  }

  /* ============================================================
   *  设置 / 云端同步
   * ============================================================ */
  /* ---------------- 手动同步（导出 / 导入，不依赖任何网络） ---------------- */
  function exportData() {
    const data = JSON.stringify(App.state, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    a.href = url;
    a.download = `JINN GROW 备份_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('已导出备份文件 ✅ 去「文件」里找到它，发给自己（微信/邮件）就能换设备');
  }
  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let obj;
      try {
        const text = String(reader.result == null ? '' : reader.result).trim();
        if (!text) throw new Error('文件内容为空');
        obj = JSON.parse(text);   // 损坏 JSON 在此抛 SyntaxError
      } catch (e) {
        toast('导入失败：' + (e && e.message ? e.message : '文件格式不对') + '，当前数据未改动');
        return;                    // 不替换、不保存、不同步
      }
      // 结构校验：非 JINN GROW 结构 / 字段异常 / 条目缺 id → 拒绝
      const err = DB.validateState(obj);
      if (err) {
        toast('导入失败：' + err + '，当前数据未改动');
        return;                    // 不替换、不保存、不同步
      }
      // 危险：导入后为空，但本地原本有大量数据 → 拒绝覆盖（云端由 pushSafe 兜底拦截）
      const prevCount = liveCountOf(App.state);
      const newCount = liveCountOf(obj);
      if (prevCount >= 10 && newCount === 0) {
        toast('导入被拒绝：导入后数据为空，但本地原有 ' + prevCount + ' 条数据，云端数据已保留');
        return;
      }
      // 通过校验：先自动拍快照（导入前完整状态），再替换并保存
      DB.takeSnapshot();
      App.state = obj; ensure();
      save(); DB.saveAll(App.state); ensure(); updateStatus(); render();
      DB.clearSnapshot();
      toast('已导入，数据同步完成 ✅');
    };
    reader.readAsText(file);
  }

  function renderSettings() {
    const m = App.state.meta || {};
    openForm('⚙️ 设置 · 云端同步', [
      { key: 'syncUrl', label: '同步地址', value: m.syncUrl, placeholder: 'yc319977-maker/jinn-sync-data', hint: 'GitHub 私有仓库名，格式为 用户名/仓库名（不要加 https:// 前缀）' },
      { key: 'syncToken', label: '同步令牌（必需）', value: m.syncToken, placeholder: 'github_pat_ 开头的个人访问令牌', hint: 'GitHub 细粒度 PAT，仅授权那个私有仓库的 Contents 读写权限；只存本机，不会上传云端' },
      { key: 'aiKey', label: 'AI Key（可选）', value: m.aiKey, placeholder: '留空则用本地启发式 AI', hint: '兼容 OpenAI 的 Key，未来可升级云端 AI' },
      { key: 'aiBase', label: 'AI 接口地址（可选）', value: m.aiBase, placeholder: 'https://api.openai.com/v1' },
    ], null, (fd) => {
      App.state.meta = Object.assign(App.state.meta || {}, fd);
      save();
      if (fd.syncUrl) {
        DB.initSync(fd.syncUrl, fd.syncToken).then((res) => {
          if (res && res.ok) { DB.loadAll().then((st) => { App.state = st; ensure(); DB.saveAll(App.state); updateStatus(); render(); toast('已连接，开始自动同步 ☁️'); });
          } else toast('连接失败：' + (res && res.reason ? res.reason : '未知原因'));
        });
      } else { DB.useLocal(); updateStatus(); toast('已切换为本地保存'); }
    });
    // 手动同步区块（不依赖网络，必定可用）
    modalBox.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-top:16px">
        <h3>📦 换设备 / 手动同步（不依赖网络）</h3>
        <div class="hint" style="margin-bottom:10px">在你手机和电脑之间搬数据：先点「导出」生成一个备份文件，发给自己（微信文件传输助手 / 邮件），再在另一台设备点「导入」选这个文件即可。</div>
        <div class="modal-actions" style="justify-content:flex-start;gap:8px">
          <button class="btn soft" id="expBtn">⬇️ 导出数据</button>
          <button class="btn soft" id="impBtn">⬆️ 导入数据</button>
        </div>
        <input type="file" id="impFile" accept="application/json,.json" style="display:none">
      </div>`);
    modalBox.querySelector('#expBtn').onclick = exportData;
    modalBox.querySelector('#impBtn').onclick = () => modalBox.querySelector('#impFile').click();
    modalBox.querySelector('#impFile').onchange = (e) => { if (e.target.files && e.target.files[0]) importData(e.target.files[0]); };
  }
  function updateStatus() {
    const b = DB.getBackend(), on = DB.isConnected();
    const badge = $('#statusBadge'), txt = $('#statusText');
    if (b === 'sync' && on) { badge.classList.add('on'); txt.textContent = '已同步'; }
    else if (b === 'sync') { badge.classList.remove('on'); txt.textContent = '同步中…'; }
    else { badge.classList.remove('on'); txt.textContent = '本地保存中'; }
  }

  /* ============================================================
   *  中央事件处理
   * ============================================================ */
  function find(arr, id) { return arr.find((x) => x.id === id); }
  function remove(arr, id) { const i = arr.findIndex((x) => x.id === id); if (i >= 0) arr.splice(i, 1); }

  function onAct(act, id, type, el) {
    const s = App.state;
    switch (act) {
      case 'nav': navigate(id); break;
      case 'trace-see-all': { App.folds['trace'] = true; navigate('growth'); break; } // 看全部：展开成长痕迹并进入成长地图（显示全部真实完成任务）
      case 'open-sheet': openSheet('选择模块', MODULES.map((m) => ({ icon: m.icon, label: m.name, onClick: () => navigate(m.id) }))); break;
      case 'close-modal': closeModal(); break;
      case 'fold': { const t = el.dataset.target; App.folds[t] = !App.folds[t]; render(); break; }

      case 'add-task': { const inp = el.previousElementSibling; const v = inp.value.trim(); editTask(null, { type, title: v }); if (v) inp.value = ''; break; }
      case 'add-cal-task': { const inp = $('#qa-cal'); const v = inp ? inp.value.trim() : ''; editTask(null, { type: 'todo', date: App.selDay, title: v }); if (v) inp.value = ''; break; }

      /* ---- 首页（个人工作驾驶舱）---- */
      case 'home-add-task': homeAddTask(); break;
      case 'home-clear-task': { const inp = $('#home-task-title'); if (inp) inp.value = ''; const sel = $('#home-task-cat'); if (sel) sel.value = 'edu'; break; }
      case 'home-quote': App.homeQuoteShift = (App.homeQuoteShift || 0) + 1; render(); break;
      case 'home-toggle-checkin': toggleHabit(id); break;
      case 'home-edit-note': editHabitNote(id); break;
      case 'home-habit-manage': homeHabitManage(); break;
      case 'home-habit-add': homeHabitAdd(); break;
      case 'home-habit-edit': homeHabitEdit(id); break;
      case 'home-habit-delete': homeHabitDelete(id); break;
      case 'home-date-manage': homeDateManage(); break;
      case 'home-del-date': { remove(s.dates, id); save(); homeDateManage(); break; }
      case 'home-dm-add': {
        const ti = $('#dm-title'), di = $('#dm-date');
        const tv = ti ? ti.value.trim() : '', dv = di ? di.value : '';
        if (!tv || !dv) { toast('请填写标题和日期'); break; }
        if (!Array.isArray(s.dates)) s.dates = [];
        s.dates.push({ id: uid(), title: tv, date: dv, note: '' });
        save(); homeDateManage(); toast('已添加重要日期 📅');
        break;
      }
      case 'home-add-temp-modal': homeAddTempModal(); break;
      // 首页三数字点击跳转：待办/已完成→每日进度过滤视图；打卡→习惯视图（数字=跳转后数量）
      case 'home-jump': {
        const kind = el.dataset.kind;
        if (kind === 'todo') { App.todayFilter = 'todo'; navigate('today'); }
        else if (kind === 'done') { App.todayFilter = 'done'; navigate('today'); }
        else if (kind === 'check') { homeHabitManage(); }
        break;
      }
      case 'today-clear-filter': App.todayFilter = null; render(); break;
      // 月度成长：已完成/待完成 数字点击 → 展开/收起真实过滤列表
      case 'month-filter': {
        const kind = el.dataset.kind;
        App.monthFilter = (App.monthFilter === kind) ? null : kind;
        renderMonth();
        break;
      }
      case 'toggle-task': { const t = find(s.tasks, id); if (t) { t.done = !t.done; if (t.done) t.doneAt = today(); save(); render(); } break; }
      case 'edit-task': editTask(id); break;
      case 'toggle-fold': { App.folds[id] = !App.folds[id]; render(); break; }
      case 'home-expand-done': { App.folds['homeDone'] = !App.folds['homeDone']; render(); break; }
      case 'del-task': if (trashItem('tasks', id, 'task')) { save(); render(); toast('已移入回收站，可以随时恢复 🌿'); } break;
      case 'cont-task': { const t = find(s.tasks, id); if (t) { t.date = today(); save(); render(); toast('已移到今天 🌱'); } break; }
      case 'cancel-task': { const t = find(s.tasks, id); if (t) { t.canceled = true; save(); renderToday(); toast('已归档，不给自己压力'); } break; }
      case 'defer-task': {
        const t = find(s.tasks, id); if (!t) break;
        openForm('延期到哪天', [{ key: 'date', label: '新日期', type: 'date', value: addDays(1) }], null, (fd) => { t.date = fd.date; save(); renderToday(); toast('已顺延 🗓️'); });
        break;
      }

      case 'cal-prev': calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderMonth(); break;
      case 'cal-next': calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderMonth(); break;
      case 'cal-day': App.selDay = id; renderMonth(); break;

      case 'add-growth': editGrowth(null, type, el.dataset.parent); break;
      case 'edit-growth': editGrowth(id); break;
      case 'del-growth': if (trashItem('growth', id, 'other')) { save(); renderGrowth(); toast('已移入回收站，可以随时恢复 🌿'); } break;

      /* ---- 能力资产（AI 发现 · 你确认）---- */
      case 'confirm-asset': {
        const key = el.dataset.key, name = el.dataset.name;
        const ex = s.growth.find((g) => g.type === 'asset' && g.key === key);
        if (ex) ex.status = 'confirmed'; else s.growth.push({ id: uid(), type: 'asset', key, title: name, status: 'confirmed', evidence: [] });
        save(); renderGrowth(); toast('已记入能力资产 🧠'); break;
      }
      case 'invalid-asset': {
        const key = el.dataset.key, name = el.dataset.name;
        const ex = s.growth.find((g) => g.type === 'asset' && g.key === key);
        if (ex) ex.status = 'invalid'; else s.growth.push({ id: uid(), type: 'asset', key, title: name, status: 'invalid', evidence: [] });
        save(); renderGrowth(); toast('已标记为暂不成立'); break;
      }
      case 'del-asset': { remove(s.growth, id); save(); renderGrowth(); break; }
      /* ---- 我的方法 ---- */
      case 'add-method': editMethod(null); break;
      case 'edit-method': editMethod(id); break;
      /* ---- 复盘与决策（重定位入口）---- */
      case 'rd-tab': App.rdView = id; renderRD(); break;
      case 'open-rd': App.rdView = id; navigate('rd'); break;
      case 'ev-link': {
        const mod = el.dataset.mod;
        if (mod === 'rd') { App.rdView = 'decision'; navigate('rd'); }
        else navigate(mod);
        break;
      }

      case 'add-insp': { const inp = $('#qa-insp'); const v = inp.value.trim(); if (v) { addInsp(v); inp.value = ''; } break; }
      case 'confirm-insp': confirmInsp(id); break;
      case 'del-insp': if (trashItem('inspirations', id, 'inspiration')) { save(); renderInspiration(); toast('已移入回收站，可以随时恢复 🌿'); } break;

      case 'content-tab': contentView = id; if (id === 'hot') { App.state.hotspots.forEach((h) => { h.read = true; }); if (!App.state.hotspots.length) genHot(); } saveView(); renderContent(); break;
      case 'filter-content': contentCol = id; contentView = 'col'; saveView(); renderContent(); break;
      case 'insp-sub': inspKind = id; saveView(); renderContent(); break;
      case 'add-insp-link': { const u = $('#qa-link'), t = $('#qa-link-title'); addInspLink(u ? u.value : '', t ? t.value : ''); if (u) u.value = ''; if (t) t.value = ''; break; }
      case 'add-insp-note': { const n = $('#qa-note'); if (n) { addInspNote(n.value); n.value = ''; } break; }
      case 'toggle-insp-detail': { App.folds['inspd-' + id] = !App.folds['inspd-' + id]; render(); break; }
      case 'promote-insp': promoteInsp(id); break;
      case 'refetch-cover': refetchCover(id); break;
      case 'add-content': editContent(null); break;
      case 'edit-content': editContent(id); break;
      case 'del-content': if (trashItem('content', id, 'content')) { save(); renderContent(); toast('已移入回收站，可以随时恢复 🌿'); } break;

      case 'gen-hot': genHot(); break;
      case 'gen-dir': genDir(id); break;
      case 'add-hot': editHot(null); break;
      case 'collect-hot': collectHot(id); break;
      case 'del-hot': if (trashItem('hotspots', id, 'other')) { save(); renderContent(); toast('已移入回收站，可以随时恢复 🌿'); } break;

      case 'add-customer': editCustomer(null); break;
      case 'edit-customer': editCustomer(id); break;
      case 'del-customer': if (trashItem('customers', id, 'customer')) { save(); renderCRM(); toast('已移入回收站，可以随时恢复 🌿'); } break;

      case 'filter-ecom': ecomCat = id; renderEcom(); break;
      case 'add-ecom': editEcom(null); break;
      case 'edit-ecom': editEcom(id); break;
      case 'del-ecom': if (trashItem('ecommerce', id, 'other')) { save(); renderEcom(); toast('已移入回收站，可以随时恢复 🌿'); } break;

      case 'add-english': addEnglish(); break;
      case 'del-english': if (trashItem('english', id, 'other')) { save(); renderSelf(); toast('已移入回收站，可以随时恢复 🌿'); } break;
      case 'add-health': addHealth(); break;
      case 'del-health': if (trashItem('health', id, 'other')) { save(); renderSelf(); toast('已移入回收站，可以随时恢复 🌿'); } break;

      case 'add-income': addIncome(); break;
      case 'del-income': if (trashItem('income', id, 'income')) { save(); renderSelf(); toast('已移入回收站，可以随时恢复 🌿'); } break;

      case 'add-review': editReview(null, type); break;
      case 'edit-review': editReview(id); break;
      case 'ai-review': aiReview(id); break;
      case 'del-review': if (trashItem('reviews', id, 'other')) { save(); render(); toast('已移入回收站，可以随时恢复 🌿'); } break;

      case 'add-decision': editDecision(null); break;
      case 'edit-decision': editDecision(id); break;
      case 'del-decision': if (trashItem('decisions', id, 'other')) { save(); render(); toast('已移入回收站，可以随时恢复 🌿'); } break;

      /* ---- 回收站操作 ---- */
      case 'trash-filter': App.trashFilter = id; renderTrash(); break;
      case 'trash-toggle': { App.trashSel = App.trashSel || {}; App.trashSel[id] = el.checked; renderTrash(); break; }
      case 'trash-restore': restoreFromTrash(id); break;
      case 'trash-purge': purgeFromTrash(id); break;
      case 'trash-restore-sel': {
        const sel = App.trashSel || {}; const ids = Object.keys(sel).filter((k) => sel[k]);
        if (!ids.length) break;
        ids.forEach(doRestore); App.trashSel = {}; save(); renderTrash(); toast('已恢复 ' + ids.length + ' 项，回到了原来的位置 🌱'); break;
      }
      case 'trash-purge-sel': {
        const sel = App.trashSel || {}; const ids = Object.keys(sel).filter((k) => sel[k]);
        if (!ids.length) break;
        confirmModal('确定永久删除选中的 ' + ids.length + ' 条数据吗？永久删除后将无法恢复', () => {
          ids.forEach(doPurge); App.trashSel = {}; save(); renderTrash(); toast('已彻底移除 ' + ids.length + ' 项 🌿');
        });
        break;
      }

      case 'confirm-obs': {
        s.aiProfile.confirmed = s.aiProfile.confirmed || [];
        s.aiProfile.confirmed.push({ key: el.dataset.key, value: el.dataset.val });
        save(); renderAIProfile(); toast('已记入 AI 档案 🤖'); break;
      }
      case 'ignore-obs': save(); renderAIProfile(); break;
      case 'add-obs': openForm('添加一条档案', [{ key: 'key', label: '主题', placeholder: '如 工作习惯' }, { key: 'value', label: '内容', type: 'textarea' }], null, (fd) => {
        s.aiProfile.confirmed = s.aiProfile.confirmed || [];
        s.aiProfile.confirmed.push({ key: fd.key, value: fd.value }); save(); renderAIProfile(); toast('已添加 🤖');
      }); break;

      default: break;
    }
  }

  /* ---- 各实体的编辑表单 ---- */
  // 新建任务也走此表单：preset 可预填 {type, cat, date, title}（首页/每日/月历的正式添加统一入口）
  function editTask(id, preset) {
    const base = id ? find(App.state.tasks, id)
      : { type: (preset && preset.type) || 'todo', date: (preset && preset.date) || today(), cat: (preset && preset.cat) || '', title: (preset && preset.title) || '' };
    const t = base;
    openForm(id ? '编辑任务' : '新建任务', [
      { key: 'title', label: '内容', value: t.title, type: 'textarea' },
      { key: 'type', label: '类型', type: 'select', options: TASK_TYPES, value: t.type },
      // 分类下拉：编辑历史旧分类任务时，自动补一条旧值选项并选中，保存后原 cat 不变（绝不静默改成新类）
      { key: 'cat', label: '分类', type: 'select', options: (id && t.cat && !TASK_CATS.find((o) => o.v === t.cat)) ? TASK_CATS.concat([{ v: t.cat, t: catName(t.cat) || t.cat }]) : TASK_CATS, value: t.cat },
      { key: 'date', label: '日期', type: 'date', value: t.date || today() },
    ], null, (fd) => {
      if (id) Object.assign(t, fd); else App.state.tasks.push(Object.assign({ id: uid(), done: false, canceled: false, order: Date.now() }, fd));
      save(); render();
    });
  }
  function editGrowth(id, type, parent) {
    const g = id ? find(App.state.growth, id) : { type: type || 'year', parent: parent || null };
    const label = { year: '年度方向', month: '月度目标', action: '具体行动' }[g.type];
    openForm(id ? '编辑' + label : '添加' + label, [
      { key: 'title', label: label + '名称', value: g.title, type: 'textarea' },
      { key: 'progress', label: '完成度 (%)', value: g.progress || 0 },
    ], null, (fd) => {
      fd.progress = Math.max(0, Math.min(100, Number(fd.progress) || 0));
      if (id) Object.assign(g, fd); else App.state.growth.push(Object.assign({ id: uid(), type: g.type, parent: g.parent }, fd));
      save(); renderGrowth();
    });
  }
  function editContent(id) {
    const x = id ? find(App.state.content, id) : { col: contentCol, status: '灵感' };
    openForm(id ? '编辑选题' : '新建选题', contentFields(x), null, (fd) => {
      if (id) {
        Object.assign(x, fd);
        x.series = fd.series || x.series;
        x.col = SERIES_COL[x.series] || x.col; // 兼容旧字段，不影响显示
      } else {
        const d = suggestDirection(fd.title, '');
        d.series = fd.series || d.series;
        App.state.content.push(Object.assign({ id: uid(), createdAt: today(), col: SERIES_COL[d.series] || 'thailand' }, fd, { series: d.series, direction: d, idea: d.hook, script: genScript(fd.title, d) }));
      }
      save(); renderContent();
    });
  }
  function editHot(id) {
    const h = id ? find(App.state.hotspots, id) : { date: today() };
    openForm(id ? '编辑热点' : '收录热点', [
      { key: 'topic', label: '热点内容', value: h.topic, type: 'textarea' },
      { key: 'source', label: '来源', value: h.source, placeholder: '抖音/小红书/视频号/泰国/留学' },
      { key: 'heat', label: '热度', value: h.heat },
      { key: 'why', label: '为什么适合你', type: 'textarea', value: h.why },
      { key: 'series', label: '适合系列', type: 'series', value: h.series || '婧婧带你看泰国' },
      { key: 'link', label: '具体内容链接（可选）', value: h.link || '', placeholder: '粘贴该热点的具体视频/新闻链接；留空则用平台搜索页' },
      { key: 'suggestedTopic', label: '推荐选题方向', type: 'textarea', value: h.suggestedTopic },
    ], null, (fd) => {
      // 粘贴真实链接 → real；视频号链接（channels.weixin 等）→ weixin（仅微信内打开，诚实标注）；留空 → 沿用榜单/搜索
      const _host = (() => { try { return new URL(fd.link || '').hostname; } catch (e) { return ''; } })();
      const _isWx = /(weixin|channels)/.test(_host);
      const _linkType = fd.link ? (_isWx ? 'weixin' : 'real') : (h.linkType || 'search');
      // 粘贴的真实链接 = 具体原内容（contentUrl）；未粘贴则保留已有 fallbackUrl（热榜/搜索备用）
      const _contentUrl = fd.link ? fd.link : (h.contentUrl || '');
      const _fallbackUrl = fd.link ? '' : (h.fallbackUrl || h.link || '');
      if (id) { Object.assign(h, fd); h.series = fd.series || h.series; h.linkType = _linkType; h.contentUrl = _contentUrl; h.fallbackUrl = _fallbackUrl; }
      else { App.state.hotspots.push(Object.assign({ id: uid(), date: today(), collected: false, linkType: _linkType, contentUrl: _contentUrl, fallbackUrl: _fallbackUrl }, fd)); }
      save(); renderContent();
    });
  }
  function editCustomer(id) {
    const c = id ? find(App.state.customers, id) : { stage: '流量触达' };
    openForm(id ? '编辑客户' : '新增客户', customerFields(c), null, (fd) => {
      if (id) Object.assign(c, fd); else App.state.customers.push(Object.assign({ id: uid() }, fd));
      save(); renderCRM();
    });
  }
  function editEcom(id) {
    const x = id ? find(App.state.ecommerce, id) : { category: ecomCat };
    openForm(id ? '编辑记录' : '添加记录', ecomFields(x), null, (fd) => {
      if (id) Object.assign(x, fd); else App.state.ecommerce.push(Object.assign({ id: uid(), category: x.category, date: today() }, fd));
      save(); renderEcom();
    });
  }
  function editReview(id, type) {
    const r = id ? find(App.state.reviews, id) : { type: type || 'day', date: today() };
    openForm(id ? '编辑复盘' : (r.type === 'day' ? '今日复盘' : r.type === 'week' ? '每周复盘' : '每月复盘'), reviewFields(r), null, (fd) => {
      if (id) Object.assign(r, fd); else App.state.reviews.push(Object.assign({ id: uid(), type: r.type }, fd));
      save(); render();
    });
  }
  function aiReview(id) {
    const r = find(App.state.reviews, id); if (!r) return;
    r.ai = analyzeReview(r); save(); render(); toast('AI 已给出外部视角 🪞');
  }
  function editDecision(id) {
    const d = id ? find(App.state.decisions, id) : { date: today() };
    openForm(id ? '编辑决策' : '记录决策', decisionFields(d), null, (fd) => {
      if (id) Object.assign(d, fd); else App.state.decisions.push(Object.assign({ id: uid() }, fd));
      save(); render();
    });
  }

  /* ============================================================
   *  全局回收站（软删除集中地 · 随云端同步）
   * ============================================================ */
  // 实体 → 回收站分类（用于筛选）
  function catOf(entityKey) {
    return ({ tasks: 'task', content: 'content', customers: 'customer', inspirations: 'inspiration', income: 'income' })[entityKey] || 'other';
  }
  // 实体 → 原模块中文名
  function moduleNameOf(k) {
    return ({ tasks: '今日任务', growth: '成长地图', inspirations: '灵感站', content: '内容宇宙', hotspots: '热点雷达', customers: '教育 CRM', ecommerce: '电商实验室', english: '英语学习', health: '健康管理', income: '财富中心', reviews: '复盘室', decisions: '决策库', aiProfile: 'AI 档案' })[k] || k;
  }
  // 回收站条目的简短预览文字
  function trashPreview(t) {
    const d = t.data || {};
    if (t.origEntity === 'income') return (num(d.amount) || '0') + ' 元' + (d.source ? ' · ' + d.source : '');
    return d.title || d.topic || d.question || d.nickname || d.text || d.name || '一条记录';
  }
  // 软删除：把条目从原实体移到回收站（不直接物理删除）
  function trashItem(entityKey, id, cat) {
    const arr = App.state[entityKey];
    if (!Array.isArray(arr)) return false;
    const idx = arr.findIndex((x) => x.id === id);
    if (idx < 0) return false;
    const item = arr[idx];
    arr.splice(idx, 1);
    const now = today();
    if (!Array.isArray(App.state.trash)) App.state.trash = [];
    App.state.trash.unshift({
      id: uid(),
      origEntity: entityKey,
      origId: item.id,
      data: JSON.parse(JSON.stringify(item)),
      cat: cat || catOf(entityKey),
      deletedAt: now,
      createdAt: item.createdAt || item.date || now,
      updatedAt: item.updatedAt || now,
    });
    return true;
  }
  // 恢复单条（底层，不刷新界面）
  function doRestore(trashId) {
    const s = App.state;
    const idx = (s.trash || []).findIndex((t) => t.id === trashId);
    if (idx < 0) return false;
    const t = s.trash[idx];
    if (!Array.isArray(s[t.origEntity])) s[t.origEntity] = [];
    t.data.updatedAt = Date.now();   // 打恢复时间戳，让其他设备据此判断"恢复晚于删除"而显示它
    if (!s[t.origEntity].some((x) => x.id === t.origId)) s[t.origEntity].push(t.data);
    s.trash.splice(idx, 1);
    // 从已永久删除清单移除（避免日后再次软删除时又被 purge 压掉）
    if (Array.isArray(s.purged)) s.purged = s.purged.filter((id) => id !== trashId);
    // 清除该条目墓碑，避免恢复后又被云端墓碑过滤掉
    if (s.tombstones && s.tombstones[t.origEntity]) delete s.tombstones[t.origEntity][t.origId];
    return true;
  }
  // 永久删除单条（底层，不刷新界面）
  function doPurge(trashId) {
    const s = App.state;
    const idx = (s.trash || []).findIndex((t) => t.id === trashId);
    if (idx < 0) return false;
    if (!Array.isArray(s.purged)) s.purged = [];
    s.purged.push(trashId);   // 记入"已永久删除"，阻止云端残留副本在自动拉取时被重新并入回收站
    s.trash.splice(idx, 1);
    return true;
  }
  function restoreFromTrash(id) { if (doRestore(id)) { save(); renderTrash(); toast('已恢复，回到了原来的位置 🌱'); } }
  function purgeFromTrash(id) {
    confirmModal('确定永久删除这条数据吗？永久删除后将无法恢复', () => {
      if (doPurge(id)) { save(); renderTrash(); toast('已彻底移除，从回收站消失 🌿'); }
    });
  }
  // 二次确认弹窗
  function confirmModal(msg, onYes) {
    showModal(`<h3>请确认</h3><p class="hint" style="margin:6px 0 16px;color:var(--ink);line-height:1.7">${esc(msg)}</p>
      <div class="modal-actions">
        <button class="btn ghost" data-act="close-modal">再想想</button>
        <button class="btn" id="cfmYes">确定</button>
      </div>`);
    modalBox.querySelector('#cfmYes').onclick = () => { closeModal(); onYes(); };
  }

  function renderTrash() {
    const s = App.state;
    const trash = (Array.isArray(s.trash) ? s.trash : []).slice();
    const td = today(), ys = addDays(-1);
    const FLT = [
      { id: 'all', name: '全部' }, { id: 'task', name: '任务' }, { id: 'content', name: '内容' },
      { id: 'customer', name: '客户' }, { id: 'inspiration', name: '灵感' },
      { id: 'income', name: '收入' }, { id: 'other', name: '其他' },
    ];
    const f = App.trashFilter || 'all';
    let filtered = f === 'all' ? trash : trash.filter((t) => t.cat === f);
    filtered.sort((a, b) => String(b.deletedAt || '').localeCompare(String(a.deletedAt || '')));
    const groupOf = (d) => d === td ? '今天' : d === ys ? '昨天' : '更早';
    const groups = {};
    filtered.forEach((t) => { const g = groupOf(t.deletedAt); (groups[g] = groups[g] || []).push(t); });
    const order = ['今天', '昨天', '更早'];
    const catName = { task: '任务', content: '内容', customer: '客户', inspiration: '灵感', income: '收入', other: '其他' };
    const sel = App.trashSel || (App.trashSel = {});
    const selIds = Object.keys(sel).filter((k) => sel[k]);
    const selCount = selIds.length;

    let html = `<div class="card"><h3>🗑️ 回收站 <span class="tag">软删除 · 随时可恢复</span></h3>
      <div class="tiny muted" style="margin-bottom:10px">这里收集了所有被你删除的内容。别担心误删——它们都还在，随时可以放回原来的地方。</div>
      <div class="tabs">${FLT.map((x) => `<button class="tab ${x.id === f ? 'active' : ''}" data-act="trash-filter" data-id="${x.id}">${x.name}</button>`).join('')}</div></div>`;

    if (!trash.length) {
      html += `<div class="empty"><span class="em">🌿</span>回收站是空的，很安心。以后删掉的东西都会先来这里，给你留一次反悔的机会。</div>`;
      $('#view').innerHTML = html; setPage('回收站'); return;
    }

    // 批量操作条
    html += `<div class="trash-bar">
      <label class="trash-selall"><input type="checkbox" id="trashAll" ${selCount === filtered.length && filtered.length ? 'checked' : ''}> 全选</label>
      <span class="muted tiny">已选 ${selCount} 项</span>
      <div class="spacer"></div>
      <button class="btn soft sm" data-act="trash-restore-sel" ${selCount ? '' : 'disabled'}>批量恢复</button>
      <button class="btn ghost sm" data-act="trash-purge-sel" ${selCount ? '' : 'disabled'}>批量彻底移除</button>
    </div>`;

    if (!filtered.length) html += `<div class="empty"><span class="em">🗂️</span>这个分类下还没有被删除的内容。</div>`;

    order.forEach((g) => {
      const items = groups[g]; if (!items || !items.length) return;
      html += `<div class="card"><h3>${g} <span class="tag">${items.length} 项</span></h3>`;
      items.forEach((t) => {
        const checked = sel[t.id] ? 'checked' : '';
        html += `<div class="list-item" style="display:flex;align-items:flex-start;gap:10px">
          <label class="trash-check"><input type="checkbox" data-act="trash-toggle" data-id="${t.id}" ${checked}></label>
          <div class="li-main" style="flex:1;min-width:0">
            <div class="li-top"><div class="li-title">${esc(trashPreview(t))}</div><span class="badge">${catName[t.cat] || '其他'}</span></div>
            <div class="li-sub">原模块：${esc(moduleNameOf(t.origEntity))}　·　删除于 ${esc(t.deletedAt || '')}</div>
          </div>
          <div class="row-actions" style="flex-direction:column;gap:6px;flex-shrink:0">
            <button class="mini green" data-act="trash-restore" data-id="${t.id}">恢复</button>
            <button class="mini ghost" data-act="trash-purge" data-id="${t.id}">彻底移除</button>
          </div>
        </div>`;
      });
      html += `</div>`;
    });
    $('#view').innerHTML = html; setPage('回收站');
    const all = $('#trashAll');
    if (all) all.onchange = () => { filtered.forEach((t) => { sel[t.id] = all.checked; }); App.trashSel = sel; renderTrash(); };
  }

  /* ---------------- 渲染分发 ---------------- */
  function render() {
    const map = {
      today: renderToday, month: renderMonth, growth: renderGrowth,
      content: renderContent, crm: renderCRM, ecom: renderEcom,
      aiprofile: renderAIProfile, trash: renderTrash, home: renderHome, rd: renderRD,
    };
    (map[App.current] || renderToday)();
    renderNav(); // 顶部数字气泡刷新
  }

  /* ---------------- 云端拉取后自动刷新界面 ---------------- */
  /* db.js 在「云端有更新」时会调用 window.__onSyncPull__(最新数据)；
     这里接住它：直接把最新数据写进内存并刷新当前视图，做到无感同步。
     - 启动阶段（booted=false）由 boot() 统一渲染，这里只存数据不重绘，避免闪烁。
     - 用户正在弹窗填表 / 正在输入框打字时，跳过本次重绘（数据已落本地，关弹窗或失焦后自然显示）。 */
  let booted = false;
  window.__onSyncPull__ = function (data) {
    if (!data) return;
    if (saveTimer) return;                      // 有未保存的本地修改：拒绝云端覆盖，避免把刚删/刚改的覆盖回去（修复复活 bug）
    App.state = data;
    ensure();
    if (!booted) return;
    const ae = document.activeElement;
    const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
    if (modalHost.classList.contains('show') || typing) return;
    render();
    toast('已同步最新内容 ☁️');
  };

  /* 数据安全：db.js 检测到"危险覆盖"时回调 —— 暂停上传、保留云端、尽量自动恢复到导入前快照 */
  window.__onSyncDanger__ = function (msg) {
    const snap = DB.getSnapshot ? DB.getSnapshot() : null;
    if (snap && liveCountOf(snap) > liveCountOf(App.state || {})) {
      App.state = snap; ensure(); save(); render();
      toast('⚠️ 检测到异常同步，已自动拦截并恢复到导入前状态 🛡️');
    } else {
      toast('⚠️ 同步异常已拦截：' + (msg || '数据保护') + '（云端数据已保留）');
    }
    updateStatus();
  };

  /* ---------------- 事件绑定 ---------------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    onAct(el.dataset.act, el.dataset.id, el.dataset.type, el);
  });
  $('#settingsBtn').onclick = renderSettings;
  $('#navToggle').onclick = () => document.body.classList.toggle('nav-open');
  $('#navMask').onclick = () => document.body.classList.remove('nav-open');
  // 移动端：从屏幕左边缘向右滑 → 打开左侧菜单；菜单打开时向左滑 → 关闭
  // 仅用窄触发区 + 横向判定，passive 不拦截滚动；独立 PWA 模式下无浏览器返回手势冲突
  (function () {
    let sx = 0, sy = 0, tracking = false, mode = 'open';
    const EDGE = 22, OPEN_DX = 14, CLOSE_DX = 40;
    document.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { tracking = false; return; }
      const t = e.touches[0]; sx = t.clientX; sy = t.clientY;
      if (document.body.classList.contains('nav-open')) { tracking = sx <= 90; mode = 'close'; }
      else { tracking = sx <= EDGE; mode = 'open'; }
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      const t = e.touches[0]; const dx = t.clientX - sx, dy = t.clientY - sy;
      if (mode === 'open') {
        if (dx > OPEN_DX && Math.abs(dx) > Math.abs(dy)) { document.body.classList.add('nav-open'); tracking = false; }
        else if (Math.abs(dy) > Math.abs(dx) + 10) tracking = false;
      } else {
        if (dx < -CLOSE_DX && Math.abs(dx) > Math.abs(dy)) { document.body.classList.remove('nav-open'); tracking = false; }
        else if (Math.abs(dy) > Math.abs(dx) + 10) tracking = false;
      }
    }, { passive: true });
  })();

  /* ---------------- 首次启动种子 ---------------- */
  function seed() {
    const s = App.state;
    s.growth.push({ id: uid(), type: 'year', parent: null, title: '建立稳定教育获客体系', progress: 20 });
    s.growth.push({ id: uid(), type: 'year', parent: null, title: '提升英语能力', progress: 35 });
    s.tasks.push({ id: uid(), type: 'core', title: '今天先想清楚一件最重要的事 🌱', cat: '', date: today(), done: false, canceled: false });
    s.content.push({ id: uid(), col: 'campus', title: '为什么越来越多家庭关注泰国教育？', status: '灵感', idea: '从真实咨询案例切入', createdAt: today() });
    s.meta.firstRun = true;
  }

  /* ---------------- 启动 ---------------- */
  async function boot() {
    const meta = JSON.parse(localStorage.getItem('sb_meta') || '{}');
    if (meta.syncUrl) {
      const r = await DB.initSync(meta.syncUrl, meta.syncToken);
      if (!r.ok) console.warn('[第二大脑] 启动时云端连接未成功：', r.reason);
    }
    App.state = await DB.loadAll();
    ensure();
    migrateHistoricalTasks();   // 一次性安全导入历史任务（幂等：重复运行不重复创建）
    // 恢复上次浏览位置（刷新不跳回首页）
    try {
      const v = JSON.parse(localStorage.getItem('sb_view') || '{}');
      if (v.current) App.current = v.current;
      if (v.contentView) contentView = v.contentView;
      if (v.contentCol) contentCol = v.contentCol;
      if (v.inspKind) inspKind = v.inspKind;
    } catch (e) { /* 忽略损坏的视图记录 */ }
    if (!App.state.meta || !App.state.meta.firstRun) seed();
    DB.onStatus(updateStatus);
    updateStatus();
    renderNav();
    render();
    const cm = MODULES.find((x) => x.id === App.current);
    setPage(cm ? cm.name : '每日进步');
    $('#pageDate').textContent = today() + ' · ' + ['日', '一', '二', '三', '四', '五', '六'][new Date().getDay()];
    booted = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
