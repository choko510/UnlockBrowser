importScripts("/assets/history/config.js?v=2025-06-01");
importScripts("/assets/history/worker.js?v=2025-06-01");
importScripts("/assets/mathematics/bundle.js?v=2025-06-01");
importScripts("/assets/mathematics/config.js?v=2025-06-01");
importScripts(__uv$config.sw || "/assets/mathematics/sw.js?v=2025-06-01");

// Service Worker バージョン - iframe プロキシ対応
const SW_VERSION = "v2025-06-01-iframe-proxy";
console.log(`Service Worker ${SW_VERSION} loaded for iframe proxy`);

const uv = new UVServiceWorker();
const dynamic = new Dynamic();

const userKey = new URL(location).searchParams.get("userkey");
self.dynamic = dynamic;

// JS Injection Configuration
let jsInjectionConfig = null;

// Load JS injection config
async function loadInjectionConfig() {
  try {
    const response = await fetch('/js-injection-config.json', {
      headers: { 'X-Bypass-Proxy': 'true' }
    });
    jsInjectionConfig = await response.json();
    console.log('JS injection config loaded:', jsInjectionConfig);
  } catch (error) {
    console.error('Failed to load JS injection config:', error);
    jsInjectionConfig = { injections: [] };
  }
}

// Check if URL should have scripts injected
function shouldInjectScripts(url) {
  if (!jsInjectionConfig || !jsInjectionConfig.injections) return [];
  
  return jsInjectionConfig.injections.filter(injection => {
    if (!injection.enabled) return false;
    return url.includes(injection.url_pattern);
  });
}

// Get content from local files (JS or CSS)
async function getFileContent(fileUrl) {
  try {
    // Remove leading slash if present and fetch from local origin
    const cleanUrl = fileUrl.replace(/^\/+/, '');
    const response = await fetch(`/${cleanUrl}`, {
      headers: { 'X-Bypass-Proxy': 'true' }
    });
    return await response.text();
  } catch (error) {
    console.error(`Failed to fetch file: ${fileUrl}`, error);
    return null;
  }
}

// Inject scripts and styles into HTML for iframe proxy
async function injectResourcesIntoHtml(html, url) {
  const injections = shouldInjectScripts(url);
  
  console.log(`Processing HTML for iframe proxy URL: ${url}`);
  
  if (injections.length === 0) {
    console.log(`No injections configured for URL: ${url} - allowing normal access`);
    return html;
  }

  let modifiedHtml = html;
  let injectedContent = '';

  for (const injection of injections) {
    console.log(`Injecting resources for: ${injection.name}`);
    
    // Inject CSS files
    if (injection.css_urls && injection.css_urls.length > 0) {
      for (const cssUrl of injection.css_urls) {
        const cssContent = await getFileContent(cssUrl);
        if (cssContent) {
          injectedContent += `\n<style type="text/css" data-injected="${cssUrl}">
${cssContent}
</style>`;
          console.log(`Successfully prepared CSS injection: ${cssUrl}`);
        }
      }
    }
    
    // Inject JS files
    if (injection.js_urls && injection.js_urls.length > 0) {
      for (const jsUrl of injection.js_urls) {
        const scriptContent = await getFileContent(jsUrl);
        if (scriptContent) {
          injectedContent += `\n<script type="text/javascript" data-injected="${jsUrl}">
${scriptContent}
</script>`;
          console.log(`Successfully prepared JS injection: ${jsUrl}`);
        }
      }
    }
  }

  // iframe用の追加スクリプトを注入（フレームバスター回避 + URL同期）
  const iframeScript = `
<script>
// iframe プロキシ用のフレームバスター回避とURL同期
(function() {
  // top と parent の参照を自身に置き換え
  try {
    if (window.top !== window.self) {
      Object.defineProperty(window, 'top', {
        get: function() { return window.self; },
        configurable: false
      });
    }
  } catch(e) {}
  
  try {
    if (window.parent !== window.self) {
      Object.defineProperty(window, 'parent', {
        get: function() { return window.self; },
        configurable: false
      });
    }
  } catch(e) {}
  
  // URL変更を親フレームに通知
  let lastUrl = window.location.href;
  
  function notifyUrlChange() {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      try {
        // 親フレームにURL変更を通知
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({
            type: 'url-changed',
            url: currentUrl
          }, '*');
        }
      } catch(e) {
        console.log('Could not notify parent of URL change:', e);
      }
    }
  }
  
  // URLの変更を監視
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  history.pushState = function() {
    originalPushState.apply(history, arguments);
    setTimeout(notifyUrlChange, 100);
  };
  
  history.replaceState = function() {
    originalReplaceState.apply(history, arguments);
    setTimeout(notifyUrlChange, 100);
  };
  
  // popstateイベントを監視
  window.addEventListener('popstate', function() {
    setTimeout(notifyUrlChange, 100);
  });
  
  // 定期的にURL変更をチェック
  setInterval(notifyUrlChange, 2000);
  
  // 初期URL通知
  setTimeout(notifyUrlChange, 500);
  
  // location リダイレクトを防ぐ
  const originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    get: function() { return originalLocation; },
    set: function(url) {
      // iframe内での location 変更は許可
      originalLocation.href = url;
      setTimeout(notifyUrlChange, 100);
    }
  });
})();
</script>`;

  injectedContent += iframeScript;

  // Insert content before closing head tag (preferred) or body tag
  if (injectedContent) {
    if (modifiedHtml.includes('</head>')) {
      modifiedHtml = modifiedHtml.replace('</head>', `${injectedContent}\n</head>`);
    } else if (modifiedHtml.includes('</body>')) {
      modifiedHtml = modifiedHtml.replace('</body>', `${injectedContent}\n</body>`);
    } else {
      // Fallback: append to end of HTML
      modifiedHtml += injectedContent;
    }
  }

  return modifiedHtml;
}

// Initialize config on startup
loadInjectionConfig();

self.addEventListener("fetch", event => {
  event.respondWith(
    (async () => {
      const url = event.request.url;
      const headers = event.request.headers;
      
      // プロキシバイパスヘッダーがある場合
      if (headers.get('X-Bypass-Proxy') === 'true') {
        console.log('Bypassing proxy due to header:', url);
        return await fetch(event.request);
      }
      
      // 同じオリジンのAPIアクセスはプロキシを通さない
      if (url.startsWith(`${location.origin}/api/`)) {
        console.log('Bypassing proxy for API request:', url);
        return await fetch(event.request);
      }

      // 同じオリジンの静的リソース（CSS、JS、画像など）もプロキシを通さない
      if (url.startsWith(`${location.origin}/`) &&
          !url.startsWith(`${location.origin}/a/`)) {
        console.log('Bypassing proxy for same-origin request:', url);
        return await fetch(event.request);
      }
      
      // Googleのトラッキングリクエストを特別に処理
      if (url.includes('gen_204') || url.includes('client_204') || url.includes('_/js/') || url.includes('favicon.ico')) {
        console.log('Bypassing tracking/resource request:', url);
        return await fetch(event.request, { mode: 'no-cors' });
      }

      if (await dynamic.route(event)) {
        return await dynamic.fetch(event);
      }

      if (url.startsWith(`${location.origin}/a/`)) {
        try {
          const response = await uv.fetch(event);
          
          // iframe プロキシ用のヘッダーを設定（全てのレスポンスに適用）
          const newHeaders = new Headers(response.headers);
          newHeaders.delete('X-Frame-Options');
          newHeaders.delete('Content-Security-Policy');
          newHeaders.set('X-Frame-Options', 'ALLOWALL');
          
          // HTMLレスポンスの場合のみスクリプト注入を試行
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('text/html') && response.status >= 200 && response.status < 300) {
            try {
              const html = await response.text();
              
              // フレームバスター回避とURL同期スクリプトを注入
              const urlSyncScript = `<script>
                // iframe プロキシ用のフレームバスター回避とURL同期
                (function() {
                  try {
                    if (window.top !== window.self) {
                      Object.defineProperty(window, 'top', { get: () => window.self });
                      Object.defineProperty(window, 'parent', { get: () => window.self });
                    }
                  } catch(e) {}
                  
                  // URL変更を親フレームに通知
                  let lastUrl = window.location.href;
                  
                  function notifyUrlChange() {
                    const currentUrl = window.location.href;
                    if (currentUrl !== lastUrl) {
                      lastUrl = currentUrl;
                      try {
                        if (window.parent && window.parent !== window) {
                          window.parent.postMessage({
                            type: 'url-changed',
                            url: currentUrl
                          }, '*');
                        }
                      } catch(e) {}
                    }
                  }
                  
                  // URLの変更を監視
                  const originalPushState = history.pushState;
                  const originalReplaceState = history.replaceState;
                  
                  history.pushState = function() {
                    originalPushState.apply(history, arguments);
                    setTimeout(notifyUrlChange, 100);
                  };
                  
                  history.replaceState = function() {
                    originalReplaceState.apply(history, arguments);
                    setTimeout(notifyUrlChange, 100);
                  };
                  
                  window.addEventListener('popstate', notifyUrlChange);
                  setInterval(notifyUrlChange, 2000);
                  setTimeout(notifyUrlChange, 500);
                })();
              </script>`;
              
              const modifiedHtml = html.replace(
                /<head>/i,
                `<head>${urlSyncScript}`
              );
              
              return new Response(modifiedHtml, {
                status: response.status,
                statusText: response.statusText,
                headers: newHeaders
              });
            } catch (htmlError) {
              console.log('HTML processing failed, returning original response');
              return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: newHeaders
              });
            }
          }
          
          // HTML以外はヘッダー修正のみで返す
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
          });
          
        } catch (error) {
          console.error('Proxy request failed:', error);
          return new Response('Proxy Error', { status: 500 });
        }
      }

      return await fetch(event.request);
    })(),
  );
});
