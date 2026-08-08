/* ============================================================
 * db.js — 数据层（GitHub API 同步版 · 数据安全护栏）
 * 双重存储：
 *   1) localStorage —— 永远可用，无需配置，关页面不丢数据
 *   2) GitHub 同步 —— 可选。设置里填「仓库名(owner/repo)」+「GitHub Token」后，手机/电脑自动同步同一份数据
 * 数据以整体 JSON 推送到 GitHub 私有仓库的 state.json。
 *
 * ⚠️ 数据安全最高原则（不可违反）：
 *   - GitHub 云端 state.json = 唯一真实数据源；本地只是缓存 + 离线副本。
 *   - 任何入口（新手机 / 清缓存 / PWA 独立分区 / 第一次打开）本地为空时，
 *     必须先读取云端，绝不允许把空/残缺本地数据 PUT 上云覆盖云端。
 *   - 上传前剥离保密字段（meta.syncToken 等），Token 只存本机，不进云端。
 *   - 从云端拉回本地时，保留本机已有的同步凭据（云端不含这些），避免配置丢失。
 *   - 拿不准谁更新时：宁可暂停同步，也绝不擅自删除/覆盖数据。
 * ============================================================ */
window.DB = (function () {
  const ENTITIES = [
    'tasks', 'growth', 'inspirations', 'content', 'hotspots',
    'customers', 'ecommerce', 'english', 'health', 'income',
    'reviews', 'decisions'
  ];
  const GH_API = 'https://api.github.com';

  let backend = 'local';
  let connected = false;
  let statusCb = null;
  let ghRepo = '';
  let ghToken = '';
  let ghSha = null;
  let cloudCache = null;   // 最近一次成功拉取的云端快照（用于上传时合并）
  let pollTimer = null;
  let pushing = false;

  function setStatus(c) {
    connected = !!c;
    if (statusCb) statusCb(connected ? 'connected' : 'disconnected', backend);
  }
  function onStatus(cb) { statusCb = cb; }

  /* ---------- localStorage ---------- */
  function loadLocal() {
    const out = {};
    ENTITIES.forEach((k) => {
      try { out[k] = JSON.parse(localStorage.getItem('sb_' + k) || '[]'); }
      catch (e) { out[k] = []; }
    });
    try { out.aiProfile = JSON.parse(localStorage.getItem('sb_aiProfile') || '{}'); }
    catch (e) { out.aiProfile = {}; }
    try { out.meta = JSON.parse(localStorage.getItem('sb_meta') || '{}'); }
    catch (e) { out.meta = {}; }
    try { out.tombstones = JSON.parse(localStorage.getItem('sb_tombstones') || '{}'); }
    catch (e) { out.tombstones = {}; }
    try { out.trash = JSON.parse(localStorage.getItem('sb_trash') || '[]'); }
    catch (e) { out.trash = []; }
    if (!Array.isArray(out.trash)) out.trash = [];
    try { out.purged = JSON.parse(localStorage.getItem('sb_purged') || '[]'); }
    catch (e) { out.purged = []; }
    if (!Array.isArray(out.purged)) out.purged = [];
    return out;
  }
  function saveLocal(state) {
    ENTITIES.forEach((k) => localStorage.setItem('sb_' + k, JSON.stringify(state[k] || [])));
    localStorage.setItem('sb_aiProfile', JSON.stringify(state.aiProfile || {}));
    localStorage.setItem('sb_meta', JSON.stringify(state.meta || {}));
    localStorage.setItem('sb_tombstones', JSON.stringify(state.tombstones || {}));
    localStorage.setItem('sb_trash', JSON.stringify(Array.isArray(state.trash) ? state.trash : []));
    localStorage.setItem('sb_purged', JSON.stringify(Array.isArray(state.purged) ? state.purged : []));
  }

  /* 判断一份 state 里是否真的有用户数据（用于识别「空入口」） */
  function localHasData(s) {
    if (!s || typeof s !== 'object') return false;
    for (const k of ENTITIES) { if (Array.isArray(s[k]) && s[k].length) return true; }
    if (s.aiProfile && typeof s.aiProfile === 'object' && Object.keys(s.aiProfile).length) return true;
    if (Array.isArray(s.trash) && s.trash.length) return true;   // 回收站里有内容，也算"有意义状态"，绝不空覆盖云端
    return false;
  }

  /* ---------- 墓碑（tombstones）：记录已删除条目，防止云端死灰复燃 ----------
   * 每次 save() 之前比对"上次保存的"和"这次要保存的"，找出被删掉的 id 记入墓碑；
   * 合并上传时剔除云端对应条目；合并下载时同理用墓碑过滤；
   * 剪枝：云端已不存在的墓碑自动清除，避免墓碑无限增长。 */
  function hasTombstones(s) {
    if (!s || !s.tombstones || typeof s.tombstones !== 'object') return false;
    for (const k of ENTITIES) {
      const t = s.tombstones[k];
      if (t && typeof t === 'object' && Object.keys(t).length) return true;
    }
    return false;
  }
  function hasMeaningfulState(s) {
    return localHasData(s) || hasTombstones(s);
  }
  function mergeTombstones(a, b) {
    const out = {};
    ENTITIES.forEach((k) => {
      const ma = (a && a[k] && typeof a[k] === 'object') ? a[k] : {};
      const mb = (b && b[k] && typeof b[k] === 'object') ? b[k] : {};
      const m = Object.assign({}, ma, mb);
      Object.keys(m).forEach((id) => {
        m[id] = Math.max(Number(ma[id]) || 0, Number(mb[id]) || 0) || Date.now();
      });
      if (Object.keys(m).length) out[k] = m;
    });
    return out;
  }
  function detectDeletions(prev, next) {
    const out = {};
    if (!prev || !next) return out;
    ENTITIES.forEach((k) => {
      const pa = Array.isArray(prev[k]) ? prev[k] : [];
      const na = Array.isArray(next[k]) ? next[k] : [];
      const nextIds = new Set(na.map((it) => it && it.id).filter(Boolean));
      const tomb = {};
      pa.forEach((it) => {
        if (it && it.id && !nextIds.has(it.id)) tomb[it.id] = Date.now();
      });
      if (Object.keys(tomb).length) out[k] = tomb;
    });
    return out;
  }
  function applyTombstoneFilter(state) {
    if (!state || !state.tombstones || typeof state.tombstones !== 'object') return;
    ENTITIES.forEach((k) => {
      const tomb = state.tombstones[k];
      if (!tomb || typeof tomb !== 'object' || !Object.keys(tomb).length) return;
      if (!Array.isArray(state[k])) return;
      state[k] = state[k].filter((it) => !(it && it.id && tomb[it.id]));
    });
  }
  function pruneTombstones(merged, cloud) {
    if (!merged || !merged.tombstones || typeof merged.tombstones !== 'object') return;
    ENTITIES.forEach((k) => {
      const t = merged.tombstones[k];
      if (!t || typeof t !== 'object') return;
      const cloudIds = new Set();
      if (cloud && Array.isArray(cloud[k])) {
        cloud[k].forEach((it) => { if (it && it.id) cloudIds.add(it.id); });
      }
      Object.keys(t).forEach((id) => { if (!cloudIds.has(id)) delete t[id]; });
      if (!Object.keys(t).length) delete merged.tombstones[k];
    });
    if (merged.tombstones && typeof merged.tombstones === 'object' && !Object.keys(merged.tombstones).length) {
      delete merged.tombstones;
    }
  }

  /* ---------- 回收站（trash）：软删除内容集中存放，随整体 state 一起同步 ----------
   * 每条 = { id, origEntity, origId, data, cat, deletedAt, createdAt, updatedAt }
   * - mergeTrash：按 id 去重取并集（手机/电脑各自删的都保留）
   * - pruneTrash：若某条目已被恢复（origId 又出现在原实体数组里），自动从回收站移出，避免"既在回收站又在原处" */
  function mergeTrash(a, b) {
    const map = new Map();
    const purged = new Set([...(Array.isArray(a.purged) ? a.purged : []), ...(Array.isArray(b.purged) ? b.purged : [])]);
    (Array.isArray(a.trash) ? a.trash : []).forEach((t) => { if (t && t.id && !purged.has(t.id)) map.set(t.id, t); });
    (Array.isArray(b.trash) ? b.trash : []).forEach((t) => { if (t && t.id && !purged.has(t.id)) map.set(t.id, t); });
    return Array.from(map.values());
  }
  function pruneTrash(state) {
    if (!state || !Array.isArray(state.trash)) return;
    state.trash = state.trash.filter((t) => {
      if (!t || !t.origEntity || !t.origId) return true;
      const arr = state[t.origEntity];
      if (Array.isArray(arr) && arr.some((x) => x && x.id === t.origId)) return false; // 已恢复回去，移出回收站
      return true;
    });
  }

  /* 把本机已有的同步凭据（云端不含）合并进云端数据，避免 pull 回来后丢失配置 */
  function withLocalAuth(cloud) {
    const out = JSON.parse(JSON.stringify(cloud || {}));
    try {
      const cur = JSON.parse(localStorage.getItem('sb_meta') || '{}');
      out.meta = out.meta || {};
      if (cur.syncUrl) out.meta.syncUrl = cur.syncUrl;
      if (cur.syncToken) out.meta.syncToken = cur.syncToken;
    } catch (_) {}
    return out;
  }

  /* ---------- GitHub 同步 ---------- */
  function friendlyErr(msg) {
    if (/Failed to fetch|NetworkError|Load failed|net::ERR_|timeout|超时/i.test(msg)) {
      return '网络连不上同步服务器。请确认网络通畅';
    }
    return msg;
  }
  function withTimeout(p, ms, label) {
    return Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error(label + '：' + (ms / 1000) + ' 秒内没收到回应')), ms))
    ]);
  }
  function b64e(s) { return btoa(unescape(encodeURIComponent(s))); }
  function b64d(s) { return decodeURIComponent(escape(atob(s))); }
  function ghHeaders(json) {
    const h = { Authorization: 'Bearer ' + ghToken, Accept: 'application/vnd.github+json' };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }
  function isValidRepo(s) { return /^[\w.-]+\/[\w.-]+$/.test((s || '').trim()); }
  function isValidToken(s) { return /^github_pat_/.test((s || '').trim()) || /^ghp_/.test((s || '').trim()); }

  /* 上传前剥离保密字段：Token 等只留本机，绝不写入云端 */
  function sanitize(state) {
    const s = JSON.parse(JSON.stringify(state || {}));
    if (s.meta) {
      delete s.meta.syncToken;
      delete s.meta.syncUrl;
    }
    return s;
  }

  async function initSync(repo, token) {
    if (!repo || !token) { backend = 'local'; setStatus(false); return { ok: false, reason: '同步地址或 Token 为空' }; }
    repo = repo.trim(); token = token.trim();
    if (!isValidRepo(repo)) { backend = 'local'; setStatus(false); return { ok: false, reason: '仓库名格式不对，应为 owner/repo（如 yc319977-maker/jinn-sync-data）' }; }
    if (!isValidToken(token)) { backend = 'local'; setStatus(false); return { ok: false, reason: 'Token 格式不对，应以 github_pat_ 或 ghp_ 开头' }; }
    ghRepo = repo; ghToken = token;
    try {
      const res = await withTimeout(
        fetch(`${GH_API}/repos/${ghRepo}/contents/state.json`, { headers: ghHeaders() }),
        15000, '连接测试超时'
      );
      if (res.status === 200) {
        const j = await res.json();
        ghSha = j.sha;
        cloudCache = JSON.parse(b64d(j.content));   // 连上即缓存一份云端快照
      } else if (res.status === 404) {
        ghSha = null; cloudCache = null;
      } else if (res.status === 401 || res.status === 403) {
        backend = 'local'; setStatus(false);
        return { ok: false, reason: 'Token 无效或权限不足（请确认 Token 有这个私有仓库的 Contents 读写权限，且未过期）' };
      } else {
        throw new Error('GitHub 返回 ' + res.status);
      }
      setStatus(true); backend = 'sync';
      startAutoPull();
      // 连上后立即拉一次云端并合并到本地，确保新入口第一时间拿到真实数据
      pullAndMerge().catch(() => {});
      return { ok: true };
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      console.error('[第二大脑] GitHub 同步初始化失败 repo=', ghRepo, 'err=', e);
      backend = 'local'; setStatus(false);
      return { ok: false, reason: '连接失败：' + friendlyErr(msg) };
    }
  }

  async function loadSync() {
    const res = await fetch(`${GH_API}/repos/${ghRepo}/contents/state.json`, { headers: ghHeaders() });
    if (res.status === 404) { cloudCache = null; return null; }
    if (!res.ok) throw new Error('GitHub 返回 ' + res.status);
    const j = await res.json();
    ghSha = j.sha;
    const data = JSON.parse(b64d(j.content));
    cloudCache = data;
    return data;
  }

  async function saveSync(state) {
    if (pushing) return;
    pushing = true;
    try {
      // 重新获取最新 sha（避免覆盖并发修改）
      let sha = ghSha;
      const head = await fetch(`${GH_API}/repos/${ghRepo}/contents/state.json`, { headers: ghHeaders() });
      if (head.status === 200) {
        const hj = await head.json();
        sha = hj.sha;
      } else if (head.status === 404) {
        sha = null;
      } else {
        throw new Error('获取文件状态失败 ' + head.status);
      }
      const body = {
        message: 'second-brain sync ' + new Date().toISOString(),
        // 上传前剥离保密字段（Token 不进云端）
        content: b64e(JSON.stringify(sanitize(state), null, 2))
      };
      if (sha) body.sha = sha;
      const put = await fetch(`${GH_API}/repos/${ghRepo}/contents/state.json`, {
        method: 'PUT',
        headers: ghHeaders(true),
        body: JSON.stringify(body)
      });
      if (!put.ok) {
        if (put.status === 409) throw new Error('冲突（云端被其他设备更新，稍后重试）');
        if (put.status === 401 || put.status === 403) throw new Error('Token 无效或权限不足');
        const t = await put.text();
        throw new Error('上传失败 ' + put.status + ' ' + t.slice(0, 100));
      }
      const pj = await put.json();
      ghSha = pj.content.sha;
      setStatus(true);
    } finally {
      pushing = false;
    }
  }

  /* 统一"以云端为准"的收尾：合入本机墓碑 + 按墓碑过滤 + 剪枝 + 合并回收站 + 清理已恢复的回收站条目。
     各拉取路径（pullAndMerge / startAutoPull / loadAll）共用，避免重复且保证行为一致。 */
  function applyCloud(cloud, local) {
    const c = withLocalAuth(cloud);
    c.tombstones = mergeTombstones((local && local.tombstones) || {}, cloud.tombstones || {});
    // 愈合：若云端实体数组里仍含某条目，且该云端条目比本地删除时间更新（如被恢复），
    // 则本地这条删除视为已失效，从墓碑移除 —— 这样"恢复"能够跨设备生效，不会被旧墓碑误伤。
    if (c.tombstones && cloud) {
      ENTITIES.forEach((k) => {
        const tomb = c.tombstones[k];
        const arr = Array.isArray(cloud[k]) ? cloud[k] : [];
        if (!tomb || typeof tomb !== 'object' || !arr.length) return;
        arr.forEach((it) => {
          if (it && it.id && tomb[it.id]) {
            const delT = Number(tomb[it.id]) || 0;
            const itemT = Number(it.updatedAt) || 0;
            if (itemT >= delT) delete tomb[it.id];   // 云端条目更新（含恢复）→ 显示该条目
          }
        });
        if (!Object.keys(tomb).length) delete c.tombstones[k];
      });
    }
    pruneTombstones(c, cloud);
    applyTombstoneFilter(c);
    c.trash = mergeTrash((local && local.trash) || [], cloud.trash || []);
    pruneTrash(c);
    return c;
  }

  /* ---------- 结构性合并（按 id 去重） ----------
   * 返回：以 local 为底 + 并入 cloud 独有条目；同 id 冲突时保留 local（用户刚编辑的优先）。
   * 用于「上传」：既应用本地改动，又绝不丢失云端已有的条目。
   * aiProfile / meta 由 cloud 优先（云端配置更权威）。
   */
  function structuralMerge(local, cloud) {
    const merged = JSON.parse(JSON.stringify(local));
    // 合并墓碑（去重 + 取较大时间戳），并用墓碑过滤云端条目（被删的绝不复活）
    merged.tombstones = mergeTombstones(local.tombstones || {}, cloud.tombstones || {});
    const tombstones = merged.tombstones || {};
    ENTITIES.forEach((k) => {
      if (!Array.isArray(local[k]) || !Array.isArray(cloud[k])) return;
      const map = new Map();
      const tomb = (tombstones[k] && typeof tombstones[k] === 'object') ? tombstones[k] : {};
      (local[k] || []).forEach((it) => { if (it && it.id) map.set(it.id, it); });
      (cloud[k] || []).forEach((it) => {
        if (!it || !it.id) return;
        if (tomb[it.id]) return;   // 已删除的：绝不复活
        if (!map.has(it.id)) map.set(it.id, it);
        // 同 id 冲突 → 保留 local（用户刚编辑的优先）
      });
      merged[k] = Array.from(map.values());
    });
    if (cloud.aiProfile && typeof cloud.aiProfile === 'object') merged.aiProfile = cloud.aiProfile;
    if (cloud.meta && typeof cloud.meta === 'object') merged.meta = Object.assign({}, merged.meta || {}, cloud.meta);
    pruneTombstones(merged, cloud);
    // 回收站：与云端取并集（两边各自删的都保留）
    merged.trash = mergeTrash(local.trash || [], cloud.trash || []);
    // 一致性约束：实体数组里已存在的条目（被恢复回去的）不应再被墓碑标记，也不应留在回收站
    ENTITIES.forEach((k) => {
      if (!merged.tombstones || !merged.tombstones[k] || !Array.isArray(merged[k])) return;
      const ids = new Set((merged[k] || []).map((it) => it && it.id).filter(Boolean));
      Object.keys(merged.tombstones[k]).forEach((id) => { if (ids.has(id)) delete merged.tombstones[k][id]; });
      if (!Object.keys(merged.tombstones[k]).length) delete merged.tombstones[k];
    });
    if (merged.tombstones && typeof merged.tombstones === 'object' && !Object.keys(merged.tombstones).length) delete merged.tombstones;
    pruneTrash(merged);
    return merged;
  }

  /* ---------- 安全上传：永远以云端为底合并，绝不拿空/残缺本地覆盖云端 ---------- */
  async function pushSafe(state) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let cloud = null;
      try { cloud = await loadSync(); } catch (_) { cloud = null; }
      // 本地既无数据也无墓碑（纯空入口）且云端有数据 → 不覆盖，直接把云端恢复到本地
      if (cloud && !hasMeaningfulState(state) && localHasData(cloud)) {
        saveLocal(withLocalAuth(cloud)); setStatus(true); return;
      }
      const merged = cloud ? structuralMerge(state, cloud) : state;
      merged.meta = merged.meta || {};
      merged.meta.lastModified = Math.max((cloud && cloud.meta && cloud.meta.lastModified) || 0, state.meta.lastModified || 0);
      saveLocal(merged);
      try {
        await saveSync(merged);
        cloudCache = merged; setStatus(true); return;
      } catch (e) {
        if (/冲突/.test(e.message) && attempt === 0) { continue; }
        throw e;
      }
    }
  }

  /* 拉取云端并合并回本地（云端为唯一真实数据源） */
  async function pullAndMerge() {
    const cloud = await loadSync();
    if (!cloud) return null;
    const local = loadLocal();
    // 本地为空（新入口/PWA 独立分区/清缓存）→ 一律用云端，不推送空数据
    if (!localHasData(local)) {
      const c = applyCloud(cloud, local);
      saveLocal(c);
      if (typeof window.__onSyncPull__ === 'function') { try { window.__onSyncPull__(c); } catch (_) {} }
      return c;
    }
    const localTime = (local.meta && local.meta.lastModified) || 0;
    const cloudTime = (cloud.meta && cloud.meta.lastModified) || 0;
    // 云端更新或相等 → 云端优先（真实数据源）
    if (cloudTime >= localTime) {
      const c = applyCloud(cloud, local);
      saveLocal(c);
      if (typeof window.__onSyncPull__ === 'function') { try { window.__onSyncPull__(c); } catch (_) {} }
      return c;
    }
    // 本地严格更新 → 合并（云端为底 + 本地改动）后写回
    const merged = structuralMerge(local, cloud);
    merged.meta = merged.meta || {};
    merged.meta.lastModified = Math.max(cloudTime, localTime);
    saveLocal(merged);
    return merged;
  }

  /* ---------- 自动拉取（云端优先） ---------- */
  function startAutoPull() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (backend !== 'sync' || !ghRepo || pushing) return;
      try {
        const cloud = await loadSync();
        if (!cloud) return;
        const local = loadLocal();
        const localTime = (local.meta && local.meta.lastModified) || 0;
        const cloudTime = (cloud.meta && cloud.meta.lastModified) || 0;
        // 云端更新 → 云端优先，替换本地并刷新界面
        if (cloudTime > localTime) {
          const c = applyCloud(cloud, local);
          saveLocal(c);
          if (typeof window.__onSyncPull__ === 'function') {
            try { window.__onSyncPull__(c); } catch (_) {}
          }
        }
      } catch (_) { /* 静默失败，下一轮再试 */ }
    }, 6000);
  }
  function stopAutoPull() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /* ---------- 对外 API ---------- */
  async function loadAll() {
    if (backend !== 'sync') return loadLocal();
    try {
      const local = loadLocal();
      const cloud = await loadSync();
      // 云端为空：若本地有有意义数据（items 或 tombstones）则用它初始化云端；否则原样返回本地
      if (!cloud) {
        if (hasMeaningfulState(local)) {
          local.meta = local.meta || {};
          local.meta.lastModified = local.meta.lastModified || Date.now();
          saveLocal(local);
          await saveSync(local);
        }
        return local;
      }
      // 本地无任何有意义数据 → 一律用云端（绝不把空数据推上去）
      if (!hasMeaningfulState(local)) {
        const c = applyCloud(cloud, local);
        saveLocal(c);
        return c;
      }
      const localTime = (local.meta && local.meta.lastModified) || 0;
      const cloudTime = (cloud.meta && cloud.meta.lastModified) || 0;
      // 云端更新或相等 → 云端为唯一真实数据源
      if (cloudTime >= localTime) {
        const c = applyCloud(cloud, local);
        saveLocal(c);
        return c;
      }
      // 本地严格更新 → 合并（云端为底 + 本地改动）后上传
      const merged = structuralMerge(local, cloud);
      merged.meta = merged.meta || {};
      merged.meta.lastModified = Math.max(cloudTime, localTime);
      saveLocal(merged);
      await saveSync(merged);
      return merged;
    } catch (e) {
      console.error('[第二大脑] loadSync 失败，使用本地：', e);
      setStatus(false);
      return loadLocal();
    }
  }
  async function saveAll(state) {
    state.meta = state.meta || {};
    state.meta.lastModified = Date.now();
    // 检查"用户刚才删除了哪些条目"，记入墓碑（防止云端死灰复燃）
    const prev = loadLocal();
    const dels = detectDeletions(prev, state);
    state.tombstones = mergeTombstones(prev.tombstones || {}, state.tombstones || {});
    ENTITIES.forEach((k) => {
      if (dels[k]) {
        state.tombstones[k] = Object.assign({}, state.tombstones[k] || {}, dels[k]);
      }
    });
    // 本地一致性：实体数组里已存在的条目（被恢复回去的）不应再被墓碑标记
    ENTITIES.forEach((k) => {
      if (!state.tombstones || !state.tombstones[k] || !Array.isArray(state[k])) return;
      const ids = new Set((state[k] || []).map((it) => it && it.id).filter(Boolean));
      Object.keys(state.tombstones[k]).forEach((id) => { if (ids.has(id)) delete state.tombstones[k][id]; });
      if (!Object.keys(state.tombstones[k]).length) delete state.tombstones[k];
    });
    if (state.tombstones && typeof state.tombstones === 'object' && !Object.keys(state.tombstones).length) delete state.tombstones;
    saveLocal(state);   // 先存本地（离线可用、立即刷新）
    if (backend !== 'sync') return;
    try {
      await pushSafe(state);   // 云端为底合并上传，绝不覆盖
    } catch (e) {
      console.error('[第二大脑] saveSync 失败（数据已存本地，稍后自动重试）：', e);
      setStatus(false);
    }
  }

  return {
    initSync, loadAll, saveAll, onStatus,
    getBackend: () => backend,
    isConnected: () => connected,
    useLocal: () => { backend = 'local'; setStatus(false); stopAutoPull(); }
  };
})();
