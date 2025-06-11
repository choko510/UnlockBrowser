importScripts("/assets/history/config.js?v=2025-04-15");
importScripts("/assets/history/worker.js?v=2025-04-15");
importScripts("/assets/mathematics/bundle.js?v=2025-04-15");
importScripts("/assets/mathematics/config.js?v=2025-04-15");
importScripts(__uv$config.sw || "/assets/mathematics/sw.js?v=2025-04-15");

const uv = new UVServiceWorker();
const dynamic = new Dynamic();

const userKey = new URL(location).searchParams.get("userkey");
self.dynamic = dynamic;

// JS Injection Configuration
let jsInjectionConfig = null;

// Load JS injection config
async function loadInjectionConfig() {
  try {
    const response = await fetch('/js-injection-config.json');
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
    // If url_pattern is empty or ".", inject on all pages
    if (!injection.url_pattern || injection.url_pattern === "" || injection.url_pattern === ".") {
      return true;
    }
    return url.includes(injection.url_pattern);
  });
}

// Get content from local files (JS or CSS)
async function getFileContent(fileUrl) {
  try {
    // Remove leading slash if present and fetch from local origin
    const cleanUrl = fileUrl.replace(/^\/+/, '');
    const response = await fetch(`/${cleanUrl}`);
    return await response.text();
  } catch (error) {
    console.error(`Failed to fetch file: ${fileUrl}`, error);
    return null;
  }
}

// Inject scripts and styles into HTML
async function injectResourcesIntoHtml(html, url) {
  const injections = shouldInjectScripts(url);
  if (injections.length === 0) return html;

  let modifiedHtml = html;
  let injectedContent = '';
  let navBarHtml = '';

  for (const injection of injections) {
    console.log(`Injecting resources for: ${injection.name}`);
    
    // Special handling for navigation bar injection
    if (injection.name === "Navigation Bar Injection") {
      try {
        navBarHtml = await getFileContent('assets/navigation/nav-bar.html');
        console.log('Successfully loaded navigation bar HTML');
      } catch (error) {
        console.error('Failed to load navigation bar HTML:', error);
      }
    }
    
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

  // Insert navigation bar HTML at the beginning of body
  if (navBarHtml && modifiedHtml.includes('<body')) {
    const bodyStart = modifiedHtml.indexOf('<body');
    const bodyOpenEnd = modifiedHtml.indexOf('>', bodyStart) + 1;
    modifiedHtml = modifiedHtml.slice(0, bodyOpenEnd) + '\n' + navBarHtml + modifiedHtml.slice(bodyOpenEnd);
    console.log('Successfully injected navigation bar HTML');
  }

  // Insert CSS and JS content before closing head tag (preferred) or body tag
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
      if (await dynamic.route(event)) {
        return await dynamic.fetch(event);
      }

      if (event.request.url.startsWith(`${location.origin}/a/`)) {
        const response = await uv.fetch(event);
        
        // Check if this is an HTML response that might need script injection
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html') && response.status === 200) {
          try {
            // Extract the original URL from the proxied request
            const uvUrl = event.request.url;
            const decodedUrl = __uv$config.decodeUrl ?
              __uv$config.decodeUrl(uvUrl.split('/a/')[1]) :
              decodeURIComponent(uvUrl.split('/a/')[1]);
            
            console.log(`Processing HTML for URL: ${decodedUrl}`);
            const html = await response.text();
            
            // Only process if we actually have HTML content
            if (html && html.trim().length > 0) {
              const modifiedHtml = await injectResourcesIntoHtml(html, decodedUrl);
              
              if (modifiedHtml !== html) {
                console.log(`Injected scripts into: ${decodedUrl}`);
                return new Response(modifiedHtml, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers
                });
              } else {
                console.log(`No injection needed for: ${decodedUrl} - returning original HTML`);
              }
            }
          } catch (error) {
            console.error('Error during script injection, returning original response:', error);
          }
        }
        
        return response;
      }

      return await fetch(event.request);
    })(),
  );
});
