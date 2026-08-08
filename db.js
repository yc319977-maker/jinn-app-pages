/* ============================================================
 * db.js — 数据层（GitHub API 同步版）
 * 双重存储：
 *   1) localStorage —— 永远可用，无需配置，关页面不丢数据
 *   2) GitHub 同步 —— 可选。设置里填「仓库名(owner/repo)」+「GitHub Token」后，手机/电脑自动同步同一份数据
 * 数据以整体 JSON 推送到 GitHub 私有仓库的 state.json。
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
    return out;
  }
  function saveLocal(state) {
    ENTITIES.forEach((k) => localStorage.setItem('sb_' + k, JSON.stringify(state[k] || [])));
    localStorage.setItem('sb_aiProfile', JSON.stringify(state.aiProfile || {}));
    localStorage.setItem('sb_meta', JSON.stringify(state.meta || {}));
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
      } else if (res.status === 404) {
        ghSha = null;
      } else if (res.status === 401 || res.status === 403) {
        backend = 'local'; setStatus(false);
        return { ok: false, reason: 'Token 无效或权限不足（请确认 Token 有这个私有仓库的 Contents 读写权限，且未过期）' };
      } else {
        throw new Error('GitHub 返回 ' + res.status);
      }
      setStatus(true); backend = 'sync';
      startAutoPull();
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
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('GitHub 返回 ' + res.status);
    const j = await res.json();
    ghSha = j.sha;
    return JSON.parse(b64d(j.content));
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
        content: b64e(JSON.stringify(state, null, 2))
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

  /* ---------- 结构性合并（按 id 去重，cloud 优先） ---------- */
  function structuralMerge(local, cloud) {
    const merged = JSON.parse(JSON.stringify(local));
    ENTITIES.forEach((k) => {
      if (!Array.isArray(local[k]) || !Array.isArray(cloud[k])) return;
      const map = new Map();
      (local[k] || []).forEach((it) => { if (it && it.id) map.set(it.id, it); });
      (cloud[k] || []).forEach((it) => {
        if (!it || !it.id) return;
        const ex = map.get(it.id);
        if (!ex) map.set(it.id, it);
        // 同 id 两边都有 → 保留 cloud（后写者赢的稳定语义）
      });
      merged[k] = Array.from(map.values());
    });
    // aiProfile + meta：云端优先
    if (cloud.aiProfile && typeof cloud.aiProfile === 'object') merged.aiProfile = cloud.aiProfile;
    if (cloud.meta && typeof cloud.meta === 'object') merged.meta = Object.assign({}, merged.meta || {}, cloud.meta);
    return merged;
  }

  /* ---------- 自动拉取 ---------- */
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
        if (cloudTime > localTime) {
          saveLocal(cloud);
          // 通知上层（app.js 可注册 window.__onSyncPull__ 来刷新 UI）
          if (typeof window.__onSyncPull__ === 'function') {
            try { window.__onSyncPull__(cloud); } catch (_) {}
          }
        }
      } catch (_) { /* 静默失败 */ }
    }, 15000);
  }
  function stopAutoPull() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  /* ---------- 对外 API ---------- */
  async function loadAll() {
    if (backend === 'sync') {
      try {
        const local = loadLocal();
        const cloud = await loadSync();
        if (!cloud) {
          local.meta = local.meta || {};
          local.meta.lastModified = Date.now();
          saveLocal(local);
          await saveSync(local);
          return local;
        }
        const localTime = (local.meta && local.meta.lastModified) || 0;
        const cloudTime = (cloud.meta && cloud.meta.lastModified) || 0;
        if (cloudTime > localTime && cloudTime > 0) {
          // 云端更新 → 替换本地
          saveLocal(cloud);
          return cloud;
        } else if (localTime > cloudTime && localTime > 0) {
          // 本地更新 → 推上云端
          await saveSync(local);
          return local;
        } else if (cloudTime === 0 && localTime === 0) {
          // 两边都没有时间戳 → 结构性合并
          const merged = structuralMerge(local, cloud);
          merged.meta = merged.meta || {};
          merged.meta.lastModified = Date.now();
          saveLocal(merged);
          await saveSync(merged);
          return merged;
        }
        // 一致
        return local;
      } catch (e) {
        console.error('[第二大脑] loadSync 失败，使用本地：', e);
        setStatus(false);
        return loadLocal();
      }
    }
    return loadLocal();
  }
  async function saveAll(state) {
    state.meta = state.meta || {};
    state.meta.lastModified = Date.now();
    saveLocal(state);
    if (backend === 'sync') {
      try { await saveSync(state); }
      catch (e) { console.error('[第二大脑] saveSync 失败：', e); setStatus(false); }
    }
  }

  return {
    initSync, loadAll, saveAll, onStatus,
    getBackend: () => backend,
    isConnected: () => connected,
    useLocal: () => { backend = 'local'; setStatus(false); stopAutoPull(); }
  };
})();