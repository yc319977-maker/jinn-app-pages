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
  const catClass = (c) => ({ edu: 'edu', content: 'content', ecom: 'ecom', biz: 'biz', grow: 'grow' }[c] || '');
  const catName = (c) => ({ edu: '教育', content: '内容', ecom: '电商', biz: '商业', grow: '成长' }[c] || '');

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  /* ---------------- 状态 ---------------- */
  const App = window.App = { state: null, current: 'today', folds: {} };

  function ensure() {
    const s = App.state;
    ['tasks', 'growth', 'inspirations', 'content', 'hotspots', 'customers',
      'ecommerce', 'english', 'health', 'income', 'reviews', 'decisions'].forEach((k) => {
        if (!Array.isArray(s[k])) s[k] = [];
      });
    if (!s.aiProfile) s.aiProfile = {};
    if (!s.meta) s.meta = {};
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { DB.saveAll(App.state); }, 350);
  }
  function commit() { ensure(); save(); render(); }

  /* ---------------- 模块导航 ---------------- */
  const MODULES = [
    { id: 'today', name: '今日工作台', icon: '🌱', home: true },
    { id: 'month', name: '成长月历', icon: '📅' },
    { id: 'growth', name: '成长地图', icon: '🗺️' },
    { id: 'inspiration', name: '灵感站', icon: '💡' },
    { id: 'content', name: '婧婧内容宇宙', icon: '🎬' },
    { id: 'hot', name: '热点雷达', icon: '📡' },
    { id: 'crm', name: '教育 CRM', icon: '🌿' },
    { id: 'ecom', name: '电商实验室', icon: '🛒' },
    { id: 'self', name: '个人成长', icon: '🌟' },
    { id: 'wealth', name: '财富中心', icon: '💰' },
    { id: 'review', name: '复盘室', icon: '🪞' },
    { id: 'decision', name: '决策库', icon: '🧭' },
    { id: 'aiprofile', name: 'AI 档案', icon: '🤖' },
  ];
  const BOTTOM = ['today', 'month', 'content', 'crm', 'more'];

  function renderNav() {
    const sb = $('#sidebar');
    sb.innerHTML = `<div class="brand">
        <img src="icon.svg" alt=""><div><b>第二大脑</b><small>jinn 的成长工作台</small></div></div>` +
      MODULES.map((m) => `<button class="nav-item ${m.id === App.current ? 'active' : ''}" data-act="nav" data-id="${m.id}">
        <span class="ic">${m.icon}</span><span>${m.name}</span></button>`).join('');

    const bn = $('#bottomnav');
    bn.innerHTML = BOTTOM.map((id) => {
      if (id === 'more') return `<button data-act="open-sheet"><span class="ic">☰</span><span>更多</span></button>`;
      const m = MODULES.find((x) => x.id === id);
      return `<button class="${id === App.current ? 'active' : ''}" data-act="nav" data-id="${id}">
        <span class="ic">${m.icon}</span><span>${m.name.replace('工作台', '').replace('婧婧', '')}</span></button>`;
    }).join('');
  }

  function setPage(title) { $('#pageTitle').textContent = title; }
  function navigate(id) {
    App.current = id; renderNav(); render();
    const m = MODULES.find((x) => x.id === id);
    if (m) setPage(m.name);
    document.body.classList.remove('nav-open');
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
      if (f.type === 'textarea') ctrl = `<textarea name="${f.key}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
      else if (f.type === 'select') ctrl = `<select name="${f.key}">` + (f.options || []).map((o) =>
        `<option value="${esc(o.v)}" ${o.v === v ? 'selected' : ''}>${esc(o.t)}</option>`).join('') + `</select>`;
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
    else if (t.includes('商业') || t.includes('创业') || t.includes('机会')) { col = 'business'; dir = '拆解一个你观察到的商业现象，给出普通人能用的判断。'; }
    return { col, dir };
  }

  /* ============================================================
   *  渲染：今日工作台
   * ============================================================ */
  function renderToday() {
    const s = App.state, td = today();
    const tasks = s.tasks.filter((t) => !t.canceled);
    const core = tasks.filter((t) => t.type === 'core' && t.date === td && !t.done);
    const todo = tasks.filter((t) => t.type === 'todo' && t.date === td && !t.done);
    const temp = tasks.filter((t) => t.type === 'temp' && t.date === td && !t.done);
    const pending = tasks.filter((t) => t.date < td && !t.done); // 待处理
    const doneToday = tasks.filter((t) => t.done && (t.doneAt || t.date) === td);

    // 完成反馈
    const byCat = { edu: 0, content: 0, ecom: 0, biz: 0, grow: 0 };
    doneToday.forEach((t) => { if (t.cat && byCat[t.cat] != null) byCat[t.cat]++; });
    const fbCats = ['edu', 'content', 'ecom'].filter((c) => byCat[c] > 0)
      .map((c) => `<div class="fb-cat">${catName(c)}<b>${byCat[c]}</b></div>`).join('') || '<div class="muted tiny">今天还没完成事项，慢慢来 🌿</div>';

    let html = `
    <div class="hero">
      <div class="hi">${greet()}</div>
      <div class="big">今天，先推进最重要的事</div>
      <div class="sub">${td} · 你正在一点点积累，努力正在留下痕迹</div>
    </div>`;

    // 核心推进
    html += `<div class="card"><h3>🌟 今日核心推进 <span class="tag">最多 3 项 · 最影响长期</span></h3>`;
    html += core.map(taskRow).join('') || `<div class="empty"><span class="em">🎯</span>还没有设定核心推进。写下今天最关键的 1 件事。</div>`;
    html += `<div class="quick-add"><input id="qa-core" placeholder="今天最影响长期发展的一件事…">
      <button class="btn sm" data-act="add-task" data-type="core">添加</button></div></div>`;

    // 待办
    html += `<div class="card"><h3>📝 今日待办 <span class="tag">普通任务</span></h3>`;
    html += todo.map(taskRow).join('') || `<div class="empty"><span class="em">🍃</span>暂无待办，轻松一点。</div>`;
    html += `<div class="quick-add"><input id="qa-todo" placeholder="添加一个普通任务…">
      <button class="btn soft sm" data-act="add-task" data-type="todo">添加</button></div></div>`;

    // 临时记录
    html += `<div class="card"><h3>⚡ 临时记录 <span class="tag">随时记下冒出来的事</span></h3>`;
    html += temp.map(taskRow).join('') || `<div class="empty"><span class="em">💭</span>突然的想法、老板安排、客户回复，都能随手记这里。</div>`;
    html += `<div class="quick-add"><input id="qa-temp" placeholder="临时事项 / 灵感 / 想法…">
      <button class="btn ghost sm" data-act="add-task" data-type="temp">记一下</button></div></div>`;

    // 待处理（未完成）
    if (pending.length) {
      html += `<div class="card"><h3>🤝 待继续推进 <span class="tag">${pending.length} 项来自之前的日子</span></h3>`;
      html += pending.map((t) => {
        const acts = `<button class="mini green" data-act="cont-task" data-id="${t.id}">继续今天</button>
          <button class="mini" data-act="defer-task" data-id="${t.id}">延期</button>
          <button class="mini ghost" data-act="cancel-task" data-id="${t.id}">取消</button>`;
        return taskRow(t, acts);
      }).join('') + `</div>`;
    }

    // 完成反馈
    html += `<div class="feedback">
      <div class="tiny muted">今天完成</div>
      <div class="big-num">${doneToday.length} <span style="font-size:14px;color:var(--ink-soft)">件事</span></div>
      <div class="fb-cats">${fbCats}</div>
      <div class="affirm">🌱 今天你又积累了一步。距离目标，又近了一点。</div>
    </div>`;

    // 历史归档
    html += historyBlock();

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

  function historyBlock() {
    const s = App.state;
    const done = s.tasks.filter((t) => t.done && !t.canceled);
    const groups = {};
    done.forEach((t) => { const d = t.doneAt || t.date; (groups[d] = groups[d] || []).push(t); });
    const dates = Object.keys(groups).sort().reverse();
    if (!dates.length) return '';
    let html = `<div class="card"><h3>📚 成长痕迹 <span class="tag">已完成事项按日期归档</span></h3>`;
    dates.slice(0, 30).forEach((d) => {
      const open = App.folds['hist-' + d] ? 'open' : '';
      const items = groups[d].map((t) =>
        `<div class="task-row" style="opacity:.85">
          <div class="check ${t.cat === 'grow' || t.cat === 'content' ? 'green' : ''} done">✓</div>
          <div class="task-main"><div class="task-title done">${esc(t.title)}</div>
          <div class="task-meta">${t.cat ? '<span class="chip ' + catClass(t.cat) + '">' + catName(t.cat) + '</span>' : ''}</div></div>
        </div>`).join('');
      html += `<div class="fold ${open}">
        <div class="fold-head" data-act="fold" data-target="hist-${d}">
          <span class="arrow">▶</span>
          <b>${d}</b><span class="muted tiny">完成 ${groups[d].length} 项</span>
        </div><div class="fold-body">${items}</div></div>`;
    });
    html += `</div>`;
    return html;
  }

  function bindQuickAdd() {
    [['qa-core', 'core'], ['qa-todo', 'todo'], ['qa-temp', 'temp']].forEach(([id, type]) => {
      const el = $('#' + id); if (!el) return;
      const add = () => { const v = el.value.trim(); if (!v) return; addTask(type, v); el.value = ''; };
      el.onkeydown = (e) => { if (e.key === 'Enter') add(); };
    });
  }
  function addTask(type, title, date) {
    const s = App.state;
    if (!title) return;
    const d = date || today();
    if (type === 'core' && s.tasks.filter((t) => t.type === 'core' && t.date === d && !t.done && !t.canceled).length >= 3) {
      toast('核心推进最多 3 项，先完成或调整已有的 🌟'); return;
    }
    s.tasks.push({ id: uid(), type, title, cat: '', date: d, done: false, canceled: false, order: Date.now() });
    save(); render();
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

    const dow = ['日', '一', '二', '三', '四', '五', '六'];
    let html = `<div class="card"><div class="cal-head">
      <button class="btn ghost sm" data-act="cal-prev">‹</button>
      <div class="mon">${calYear} 年 ${calMonth + 1} 月</div>
      <button class="btn ghost sm" data-act="cal-next">›</button></div>
      <div class="cal-grid">${dow.map((x) => `<div class="cal-dow">${x}</div>`).join('')}`;
    cells.forEach((c) => {
      if (!c) { html += `<div></div>`; return; }
      const list = taskByDate[c] || [];
      const done = list.filter((t) => t.done).length;
      const todo = list.length - done;
      const isTd = c === today();
      const pills = list.slice(0, 3).map((t) => `<span class="pill ${t.done ? 'ok' : ''}">${esc(t.title.slice(0, 6))}</span>`).join('');
      html += `<div class="cal-cell ${isTd ? 'today' : ''}" data-act="cal-day" data-id="${c}">
        <div class="d">${+c.slice(8)}</div>
        <div class="dots">${done ? `<span class="pill ok">✓${done}</span>` : ''}${todo ? `<span class="pill">○${todo}</span>` : ''}</div>
        ${pills}
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
    setPage('成长月历');
  }

  /* ============================================================
   *  成长地图
   * ============================================================ */
  function renderGrowth() {
    const s = App.state;
    const years = s.growth.filter((g) => g.type === 'year');
    const bar = (p) => `<div class="bar"><span style="width:${Math.max(0, Math.min(100, p || 0))}%"></span></div>`;
    let html = `<div class="card"><h3>🗺️ 成长地图 <span class="tag">记录过程，不只看结果</span></h3>
      <div class="tiny muted" style="margin-bottom:10px">年度方向 → 月度目标 → 具体行动，每一步都有进度。</div>
      <button class="btn sm" data-act="add-growth" data-type="year">+ 添加年度方向</button></div>`;
    if (!years.length) html += `<div class="empty"><span class="em">🌱</span>先写下今年的方向吧，比如「建立稳定教育获客体系」。</div>`;
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
      html += block;
    });
    $('#view').innerHTML = html;
    setPage('成长地图');
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
    { id: 'business', name: '商业观察' },
    { id: 'inspoLib', name: '灵感库' },
  ];
  const CSTATUS = ['灵感', '待制作', '拍摄中', '剪辑中', '已发布', '复盘'];
  let contentCol = 'thailand';
  function renderContent() {
    const s = App.state;
    const tabs = COLS.map((c) => `<button class="tab ${c.id === contentCol ? 'active' : ''}" data-act="filter-content" data-id="${c.id}">${c.name}</button>`).join('');
    let html = `<div class="card"><h3>🎬 婧婧内容宇宙 <span class="tag">${COLS.find((c) => c.id === contentCol).name}</span></h3>
      <div class="tabs">${tabs}</div>
      <button class="btn sm" data-act="add-content">+ 新建选题</button></div>`;
    const list = s.content.filter((x) => x.col === contentCol).slice().reverse();
    if (!list.length) html += `<div class="empty"><span class="em">🎥</span>这个栏目还没有选题，记录第一个灵感吧。</div>`;
    list.forEach((x) => {
      const st = x.status || '灵感';
      const stCls = { '灵感': 's1', '待制作': 's1', '拍摄中': 's3', '剪辑中': 's3', '已发布': 's2', '复盘': 's4' }[st] || 's1';
      html += `<div class="list-item"><div class="li-top">
        <div class="li-title">${esc(x.title)}</div><span class="badge ${stCls}">${st}</span></div>
        <div class="li-sub">${x.source ? '来源：' + esc(x.source) + '\n' : ''}${x.idea ? '想法：' + esc(x.idea) + '\n' : ''}
        ${x.publishTime ? '发布：' + esc(x.publishTime) + '　' : ''}${x.dataReview ? '复盘：' + esc(x.dataReview) : ''}</div>
        <div class="row-actions" style="margin-top:8px">
          <button class="mini" data-act="edit-content" data-id="${x.id}">编辑</button>
          <button class="mini ghost" data-act="del-content" data-id="${x.id}">删除</button></div></div>`;
    });
    $('#view').innerHTML = html;
    setPage('婧婧内容宇宙');
  }
  function contentFields(it) {
    return [
      { key: 'title', label: '标题', value: it.title, placeholder: '选题标题' },
      { key: 'col', label: '栏目', type: 'select', options: COLS.map((c) => ({ v: c.id, t: c.name })), value: it.col },
      { key: 'status', label: '状态', type: 'select', options: CSTATUS.map((c) => ({ v: c, t: c })), value: it.status || '灵感' },
      { key: 'source', label: '来源', value: it.source, placeholder: '灵感来自哪里' },
      { key: 'idea', label: '想法', type: 'textarea', value: it.idea, placeholder: '这个选题想表达什么' },
      { key: 'script', label: '脚本', type: 'textarea', value: it.script, placeholder: '脚本要点' },
      { key: 'publishTime', label: '发布时间', value: it.publishTime, placeholder: '如 2026-08-10' },
      { key: 'dataReview', label: '数据复盘', type: 'textarea', value: it.dataReview, placeholder: '发布后的数据与感受' },
    ];
  }

  /* ============================================================
   *  热点雷达
   * ============================================================ */
  function renderHot() {
    const s = App.state;
    let html = `<div class="card"><h3>📡 热点雷达 <span class="tag">AI 整理 · 收藏入选题库</span></h3>
      <div class="tiny muted" style="margin-bottom:10px">提示：连接数据源后可每日自动整理。当前支持手动收录 + AI 方向建议（本地启发式）。</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn sm" data-act="gen-hot">✨ AI 给方向建议</button>
        <button class="btn soft sm" data-act="add-hot">+ 收录热点</button>
      </div></div>`;
    const list = s.hotspots.slice().reverse();
    if (!list.length) html += `<div class="empty"><span class="em">📡</span>还没有热点。点「AI 给方向建议」试试。</div>`;
    list.forEach((h) => {
      const colName = (COLS.find((c) => c.id === h.col) || {}).name || h.col;
      html += `<div class="list-item"><div class="li-top">
        <div class="li-title">${esc(h.topic)}</div>${h.collected ? '<span class="badge s2">已收藏</span>' : ''}</div>
        <div class="li-sub">${h.source ? '来源：' + esc(h.source) + '　' : ''}${h.heat ? '热度：' + esc(h.heat) + '\n' : ''}
        ${h.why ? '为什么适合你：' + esc(h.why) + '\n' : ''}<b>建议栏目：</b>${esc(colName)}　<b>推荐选题：</b>${esc(h.suggestedTopic || '')}</div>
        <div class="row-actions" style="margin-top:8px">
          ${h.collected ? '' : `<button class="mini green" data-act="collect-hot" data-id="${h.id}">收藏入选题库</button>`}
          <button class="mini ghost" data-act="del-hot" data-id="${h.id}">删除</button></div></div>`;
    });
    $('#view').innerHTML = html;
    setPage('热点雷达');
  }
  function genHot() {
    const s = App.state;
    const seeds = [
      { topic: '海外教育关注持续增加', source: '留学/教育', heat: '高', why: '你的泰国+教育内容天然契合', col: 'campus' },
      { topic: '泰国生活成本对比走红', source: '泰国', heat: '中', why: '真实体验类内容容易引发共鸣', col: 'thailand' },
      { topic: '普通人如何做副业/轻创业', source: '商业', heat: '高', why: '与你的创业记录强相关', col: 'business' },
      { topic: '学生/家长真实故事受欢迎', source: '人物', heat: '中', why: '「听你说」栏目素材', col: 'listens' },
    ];
    seeds.forEach((sd) => {
      const sg = suggestHot(sd.topic);
      s.hotspots.push(Object.assign({ id: uid(), date: today(), collected: false, suggestedTopic: sd.topic + '：' + sg.dir }, sd, { col: sd.col || sg.col }));
    });
    save(); renderHot(); toast('已生成今日热点建议 📡');
  }
  function collectHot(id) {
    const h = App.state.hotspots.find((x) => x.id === id); if (!h) return;
    App.state.content.push({ id: uid(), col: h.col, title: h.suggestedTopic || h.topic, status: '灵感', idea: h.why, source: h.source, createdAt: today() });
    h.collected = true; save(); renderHot(); toast('已收藏到内容宇宙 🎬');
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
   *  个人成长（英语 + 健康）
   * ============================================================ */
  function renderSelf() {
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
    $('#view').innerHTML = html;
    setPage('个人成长');
    const en = $('#qa-en'); if (en) en.onkeydown = (e) => { if (e.key === 'Enter') addEnglish(); };
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

  /* ============================================================
   *  财富中心
   * ============================================================ */
  function renderWealth() {
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
    $('#view').innerHTML = html;
    setPage('财富中心');
  }
  function addIncome() {
    openForm('记录收入', [
      { key: 'date', label: '日期', value: today() },
      { key: 'amount', label: '金额（元）', value: '' },
      { key: 'source', label: '来源', type: 'select', options: [{ v: '工资', t: '工资' }, { v: '咨询', t: '咨询' }, { v: '合作', t: '合作' }, { v: '其他', t: '其他' }], value: '咨询' },
    ], null, (fd) => { if (!fd.amount) return; App.state.income.push(Object.assign({ id: uid() }, fd)); save(); renderWealth(); toast('已记录 💰'); });
  }

  /* ============================================================
   *  复盘室
   * ============================================================ */
  function renderReview() {
    const s = App.state;
    const td = today();
    let html = `<div class="card"><h3>🪞 成长复盘室 <span class="tag">用外部视角看自己</span></h3>
      <div class="tabs">
        <button class="tab active">每日</button></div>
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
    $('#view').innerHTML = html;
    setPage('复盘室');
  }
  function reviewFields(r) {
    const base = [
      { key: 'date', label: '日期', value: r.date || today() },
      { key: 'done', label: '今天/本周/本月完成了什么？', type: 'textarea', value: r.done },
      { key: 'ignored', label: '忽略了什么？', type: 'textarea', value: r.ignored },
      { key: 'good', label: '做得好的地方？', type: 'textarea', value: r.good },
      { key: 'improve', label: '哪些可以优化？', type: 'textarea', value: r.improve },
      { key: 'tomorrow', label: '下一步最重要的事？', type: 'textarea', value: r.tomorrow },
    ];
    return base;
  }

  /* ============================================================
   *  决策库
   * ============================================================ */
  function renderDecision() {
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
    $('#view').innerHTML = html;
    setPage('决策库');
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
    a.download = `第二大脑备份_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('已导出备份文件 ✅ 去「文件」里找到它，发给自己（微信/邮件）就能换设备');
  }
  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        if (!obj || typeof obj !== 'object') throw new Error('不是有效的备份');
        App.state = obj; save(); DB.saveAll(App.state); ensure(); updateStatus(); render();
        toast('已导入，数据同步完成 ✅');
      } catch (e) { toast('导入失败：' + (e && e.message ? e.message : '文件格式不对')); }
    };
    reader.readAsText(file);
  }

  function renderSettings() {
    const m = App.state.meta || {};
    openForm('⚙️ 设置 · 云端同步', [
      { key: 'syncUrl', label: '同步地址', value: m.syncUrl, placeholder: 'https://你的中转地址.workers.dev', hint: '自动同步的服务器地址（按我给你的步骤创建 Cloudflare Worker 后填这里）' },
      { key: 'syncToken', label: '同步令牌（可选）', value: m.syncToken, placeholder: '自己设的一串字，如 jinn2026', hint: '防止别人看到你的数据，建议填一个只有你知道的口令' },
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
      case 'open-sheet': openSheet('选择模块', MODULES.map((m) => ({ icon: m.icon, label: m.name, onClick: () => navigate(m.id) }))); break;
      case 'close-modal': closeModal(); break;
      case 'fold': { const t = el.dataset.target; App.folds[t] = !App.folds[t]; render(); break; }

      case 'add-task': { const inp = el.previousElementSibling; const v = inp.value.trim(); if (v) { addTask(type, v); inp.value = ''; } break; }
      case 'add-cal-task': { const inp = $('#qa-cal'); const v = inp ? inp.value.trim() : ''; if (v) addTask('todo', v, App.selDay); break; }
      case 'toggle-task': { const t = find(s.tasks, id); if (t) { t.done = !t.done; if (t.done) t.doneAt = today(); save(); render(); } break; }
      case 'edit-task': editTask(id); break;
      case 'del-task': remove(s.tasks, id); save(); render(); break;
      case 'cont-task': { const t = find(s.tasks, id); if (t) { t.date = today(); save(); render(); toast('已移到今天 🌱'); } break; }
      case 'cancel-task': { const t = find(s.tasks, id); if (t) { t.canceled = true; save(); renderToday(); toast('已归档，不给自己压力'); } break; }
      case 'defer-task': {
        const t = find(s.tasks, id); if (!t) break;
        openForm('延期到哪天', [{ key: 'date', label: '新日期', value: addDays(1), type: 'text', hint: '格式 2026-08-09' }], null, (fd) => { t.date = fd.date; save(); renderToday(); toast('已顺延 🗓️'); });
        break;
      }

      case 'cal-prev': calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderMonth(); break;
      case 'cal-next': calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderMonth(); break;
      case 'cal-day': App.selDay = id; renderMonth(); break;

      case 'add-growth': editGrowth(null, type, el.dataset.parent); break;
      case 'edit-growth': editGrowth(id); break;
      case 'del-growth': remove(s.growth, id); save(); renderGrowth(); break;

      case 'add-insp': { const inp = $('#qa-insp'); const v = inp.value.trim(); if (v) { addInsp(v); inp.value = ''; } break; }
      case 'confirm-insp': confirmInsp(id); break;
      case 'del-insp': remove(s.inspirations, id); save(); renderInspiration(); break;

      case 'filter-content': contentCol = id; renderContent(); break;
      case 'add-content': editContent(null); break;
      case 'edit-content': editContent(id); break;
      case 'del-content': remove(s.content, id); save(); renderContent(); break;

      case 'gen-hot': genHot(); break;
      case 'add-hot': editHot(null); break;
      case 'collect-hot': collectHot(id); break;
      case 'del-hot': remove(s.hotspots, id); save(); renderHot(); break;

      case 'add-customer': editCustomer(null); break;
      case 'edit-customer': editCustomer(id); break;
      case 'del-customer': remove(s.customers, id); save(); renderCRM(); break;

      case 'filter-ecom': ecomCat = id; renderEcom(); break;
      case 'add-ecom': editEcom(null); break;
      case 'edit-ecom': editEcom(id); break;
      case 'del-ecom': remove(s.ecommerce, id); save(); renderEcom(); break;

      case 'add-english': addEnglish(); break;
      case 'del-english': remove(s.english, id); save(); renderSelf(); break;
      case 'add-health': addHealth(); break;
      case 'del-health': remove(s.health, id); save(); renderSelf(); break;

      case 'add-income': addIncome(); break;
      case 'del-income': remove(s.income, id); save(); renderWealth(); break;

      case 'add-review': editReview(null, type); break;
      case 'edit-review': editReview(id); break;
      case 'ai-review': aiReview(id); break;
      case 'del-review': remove(s.reviews, id); save(); renderReview(); break;

      case 'add-decision': editDecision(null); break;
      case 'edit-decision': editDecision(id); break;
      case 'del-decision': remove(s.decisions, id); save(); renderDecision(); break;

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
  function editTask(id) {
    const t = id ? find(App.state.tasks, id) : { type: 'todo', date: today() };
    openForm(id ? '编辑任务' : '新建任务', [
      { key: 'title', label: '内容', value: t.title, type: 'textarea' },
      { key: 'type', label: '类型', type: 'select', options: [{ v: 'core', t: '核心推进' }, { v: 'todo', t: '普通待办' }, { v: 'temp', t: '临时记录' }], value: t.type },
      { key: 'cat', label: '分类', type: 'select', options: [{ v: '', t: '无' }, { v: 'edu', t: '教育' }, { v: 'content', t: '内容' }, { v: 'ecom', t: '电商' }, { v: 'biz', t: '商业' }, { v: 'grow', t: '成长' }], value: t.cat },
      { key: 'date', label: '日期', value: t.date || today() },
    ], null, (fd) => {
      if (id) Object.assign(t, fd); else App.state.tasks.push(Object.assign({ id: uid(), done: false, canceled: false, order: Date.now() }, fd));
      save(); renderToday();
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
      if (id) Object.assign(x, fd); else App.state.content.push(Object.assign({ id: uid(), createdAt: today() }, fd));
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
      { key: 'col', label: '建议栏目', type: 'select', options: COLS.map((c) => ({ v: c.id, t: c.name })), value: h.col || 'campus' },
      { key: 'suggestedTopic', label: '推荐选题方向', type: 'textarea', value: h.suggestedTopic },
    ], null, (fd) => { if (id) Object.assign(h, fd); else App.state.hotspots.push(Object.assign({ id: uid(), date: today(), collected: false }, fd)); save(); renderHot(); });
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
      save(); renderReview();
    });
  }
  function aiReview(id) {
    const r = find(App.state.reviews, id); if (!r) return;
    r.ai = analyzeReview(r); save(); renderReview(); toast('AI 已给出外部视角 🪞');
  }
  function editDecision(id) {
    const d = id ? find(App.state.decisions, id) : { date: today() };
    openForm(id ? '编辑决策' : '记录决策', decisionFields(d), null, (fd) => {
      if (id) Object.assign(d, fd); else App.state.decisions.push(Object.assign({ id: uid() }, fd));
      save(); renderDecision();
    });
  }

  /* ---------------- 渲染分发 ---------------- */
  function render() {
    const map = {
      today: renderToday, month: renderMonth, growth: renderGrowth, inspiration: renderInspiration,
      content: renderContent, hot: renderHot, crm: renderCRM, ecom: renderEcom, self: renderSelf,
      wealth: renderWealth, review: renderReview, decision: renderDecision, aiprofile: renderAIProfile,
    };
    (map[App.current] || renderToday)();
  }

  /* ---------------- 事件绑定 ---------------- */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    onAct(el.dataset.act, el.dataset.id, el.dataset.type, el);
  });
  $('#settingsBtn').onclick = renderSettings;
  $('#navToggle').onclick = () => document.body.classList.toggle('nav-open');
  $('#navMask').onclick = () => document.body.classList.remove('nav-open');

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
    if (!App.state.meta || !App.state.meta.firstRun) seed();
    DB.onStatus(updateStatus);
    updateStatus();
    renderNav();
    render();
    setPage('今日工作台');
    $('#pageDate').textContent = today() + ' · ' + ['日', '一', '二', '三', '四', '五', '六'][new Date().getDay()];
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
