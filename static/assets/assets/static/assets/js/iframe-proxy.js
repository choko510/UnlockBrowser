// iframe-proxy.js - iframeベースのプロキシ制御

class IframeProxy {
  constructor() {
    this.iframe = document.getElementById('proxy-iframe');
    this.urlInput = document.getElementById('url-input');
    this.loadingEl = document.getElementById('loading');
    this.errorEl = document.getElementById('error-message');
    
    this.history = [];
    this.currentIndex = -1;
    this.defaultHome = 'https://google.com';
    
    this.initializeEventListeners();
    // iframeからのURL同期通知を受信
    window.addEventListener('message', this.handleIframeMessage.bind(this));
    
    // 初期ページを読み込み
    setTimeout(() => {
      this.navigate(this.defaultHome);
    }, 100);
  }
  
  initializeEventListeners() {
    // Enterキーでナビゲート
    this.urlInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.navigate();
      }
    });
    
    // iframe読み込み状態の監視
    this.iframe.addEventListener('load', () => {
      this.onIframeLoad();
    });
    
  }
  
  navigate(url = null) {
    const targetUrl = url || this.urlInput.value.trim();
    
    if (!targetUrl) {
      this.showError('URLを入力してください');
      return;
    }
    
    const processedUrl = this.processUrl(targetUrl);
    const proxyUrl = this.buildProxyUrl(processedUrl);
    
    this.showLoading();
    this.hideError();
    
    // 履歴を更新（重複を避ける）
    if (this.history[this.currentIndex] !== processedUrl) {
      if (this.currentIndex < this.history.length - 1) {
        this.history = this.history.slice(0, this.currentIndex + 1);
      }
      this.history.push(processedUrl);
      this.currentIndex = this.history.length - 1;
    }
    
    this.loadUrl(processedUrl);
    this.updateNavigationButtons();
  }
  
  processUrl(input) {
    let url = input.trim();
    
    // 検索エンジンの設定を取得
    const engine = localStorage.getItem("engine") || "https://www.google.com/search?q=";
    
    // URLかどうか判定
    if (!this.isUrl(url)) {
      // 検索クエリとして処理
      url = engine + encodeURIComponent(url);
    } else if (!(url.startsWith("https://") || url.startsWith("http://"))) {
      // プロトコルを追加
      url = `https://${url}`;
    }
    
    return url;
  }
  
  buildProxyUrl(url) {
    // Ultravioletの既存のエンコーディングを使用
    if (typeof __uv$config !== 'undefined' && __uv$config.encodeUrl) {
      const encodedUrl = __uv$config.encodeUrl(url);
      return `/a/${encodedUrl}`;
    } else {
      // フォールバック: シンプルエンコーディング
      const encodedUrl = encodeURIComponent(url);
      return `/a/${encodedUrl}`;
    }
  }
  
  isUrl(val = "") {
    return /^https?:\/\//.test(val) || 
           (val.includes(".") && val.substr(0, 1) !== " ");
  }
  
  extractDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }
  
  goBack() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      const url = this.history[this.currentIndex];
      this.loadUrl(url);
      this.updateNavigationButtons();
    }
  }
  
  goForward() {
    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
      const url = this.history[this.currentIndex];
      this.loadUrl(url);
      this.updateNavigationButtons();
    }
  }
  
  loadUrl(url) {
    // URLを読み込む共通メソッド
    const proxyUrl = this.buildProxyUrl(url);
    this.iframe.src = proxyUrl;
    this.urlInput.value = url;
    
    // タイトルを更新
    document.title = `${this.extractDomain(url)} - Interstellar Proxy`;
  }
  
  refresh() {
    if (this.iframe.src) {
      this.showLoading();
      this.iframe.src = this.iframe.src;
    }
  }
  
  updateNavigationButtons() {
    const backBtn = document.getElementById('back-btn');
    const forwardBtn = document.getElementById('forward-btn');
    
    backBtn.disabled = this.currentIndex <= 0;
    forwardBtn.disabled = this.currentIndex >= this.history.length - 1;
  }
  
  showLoading() {
    this.loadingEl.style.display = 'block';
  }
  
  hideLoading() {
    this.loadingEl.style.display = 'none';
  }
  
  showError(message) {
    this.errorEl.textContent = message;
    this.errorEl.style.display = 'block';
    this.hideLoading();
  }
  
  hideError() {
    this.errorEl.style.display = 'none';
  }
  
  onIframeLoad() {
    this.hideLoading();
    this.hideError();
    try {
      // URLを同期
      const proxySrc = this.iframe.src;
      const realUrl = this.extractRealUrlFromProxy(proxySrc) || proxySrc;
      if (realUrl && realUrl !== this.urlInput.value) {
        this.urlInput.value = realUrl;
      }
      // タイトルを同期
      const iframeDoc = this.iframe.contentDocument;
      if (iframeDoc && iframeDoc.title) {
        document.title = `${iframeDoc.title} - Interstellar Proxy`;
      } else {
        document.title = `${this.extractDomain(realUrl)} - Interstellar Proxy`;
      }
    } catch (error) {
      console.log('onIframeLoad sync failed:', error);
    }
  }
  onIframeError() {
    this.showError('ページの読み込みに失敗しました。URLを確認してください。');
  }
  
  openAI() {
    // AI質問機能の実装
    const aiUrl = 'https://chatgpt.com';
    this.navigate(aiUrl);
  }
  
  
  extractRealUrlFromProxy(proxyUrl) {
    try {
      // プロキシURLのパターン: /a/[encoded-url]
      const match = proxyUrl.match(/\/a\/(.+)$/);
      if (match) {
        // Ultravioletのデコーディングを使用
        if (typeof __uv$config !== 'undefined' && __uv$config.decodeUrl) {
          return __uv$config.decodeUrl(match[1]);
        } else {
          // フォールバック: シンプルデコーディング
          return decodeURIComponent(match[1]);
        }
      }
    } catch (error) {
      console.error('URL extraction failed:', error);
    }
    return null;
  }
  
  handleIframeMessage(event) {
    // iframe内からのURL変更通知を処理
    if (event.data && event.data.type === 'url-changed') {
      const newUrl = event.data.url;
      if (newUrl && newUrl !== this.urlInput.value) {
        this.urlInput.value = newUrl;
        
        // 履歴を更新（iframe内でのナビゲーションの場合）
        if (this.history[this.currentIndex] !== newUrl) {
          if (this.currentIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.currentIndex + 1);
          }
          this.history.push(newUrl);
          this.currentIndex = this.history.length - 1;
          this.updateNavigationButtons();
        }
        
        // タイトルも更新
        document.title = `${this.extractDomain(newUrl)} - Interstellar Proxy`;
      }
    }
  }
}

// グローバル関数（HTMLから呼び出し用）
let proxyInstance;

function navigate() {
  proxyInstance.navigate();
}

function goBack() {
  proxyInstance.goBack();
}

function goForward() {
  proxyInstance.goForward();
}

function refresh() {
  proxyInstance.refresh();
}

function openAI() {
  proxyInstance.openAI();
}


// 初期化
document.addEventListener('DOMContentLoaded', () => {
  proxyInstance = new IframeProxy();
});

// 既存の関数（後方互換性のため）
function go(value) {
  proxyInstance.navigate(value);
}

function blank(value) {
  proxyInstance.navigate(value);
}

function dy(value) {
  proxyInstance.navigate(value);
}