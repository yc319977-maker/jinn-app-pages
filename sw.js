// v3: no-op SW — 不缓存、不拦截任何请求
// 旧版 SW 会拦截跨域 fetch 并返回 null，导致同步失败；新版彻底不碰 fetch，把所有请求交给浏览器原生处理
const CACHE = 'second-brain-v3';

self.addEventListener('install', (e) => {
  // 立刻激活，不等旧 SW
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // 清掉所有旧缓存 + 接管所有页面
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// 故意不写 fetch 监听器 —— 让浏览器原生处理所有网络请求，不让 SW 干扰同步
