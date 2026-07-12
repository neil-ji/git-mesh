// ============================================================
// THEME MANAGER
// ============================================================
;(function(){
  const html = document.documentElement;
  const btn = document.getElementById('themeBtn');
  const KEY = 'gitmesh-docs-theme';
  function get(){ return localStorage.getItem(KEY) || 'auto'; }
  function set(v){ localStorage.setItem(KEY, v); }
  function resolve(s){
    if (s === 'auto') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return s;
  }
  function apply(s){
    html.setAttribute('data-theme', resolve(s));
    updateIcon(s);
  }
  function updateIcon(s){
    if (!btn) return;
    const names = { dark: 'moon', light: 'sun', auto: 'sun-moon' };
    btn.innerHTML = `<i data-lucide="${names[s] || 'sun'}" style="width:15px;height:15px"></i>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
  function cycle(){
    const cur = get(), nxt = cur === 'dark' ? 'light' : cur === 'light' ? 'auto' : 'dark';
    set(nxt); apply(nxt);
    if (nxt === 'auto') listen(); else unlisten();
  }
  let mq = null, mqHandler = null;
  function listen(){
    if (mq) return;
    mqHandler = () => { if (get() === 'auto') apply('auto'); };
    mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', mqHandler);
  }
  function unlisten(){ if (mq){ mq.removeEventListener('change', mqHandler); mq = null; mqHandler = null; } }
  const s = get();
  apply(s);
  if (s === 'auto') listen();
  if (btn) btn.addEventListener('click', cycle);
})();

// ============================================================
// MARKED.JS CONFIG + SYNTAX HIGHLIGHTING
// ============================================================
if (typeof marked !== 'undefined') marked.setOptions({ gfm: true, breaks: false });

const SYN = {
  tsKw: 'import|export|from|const|let|var|function|async|await|return|if|else|for|while|do|of|in|new|class|extends|implements|interface|type|enum|namespace|typeof|instanceof|throw|try|catch|finally|switch|case|break|continue|default|yield|void|never|unknown|any|boolean|string|number|symbol|object|true|false|null|undefined|as|is|keyof|readonly|static|public|private|protected|abstract|declare|module|global|get|set',
  jsB: 'console|document|window|JSON|Math|Object|Array|Promise|Map|Set|Error|Date|RegExp|String|Number|Boolean|Symbol|parseInt|parseFloat|setTimeout|setInterval|clearTimeout|clearInterval|fetch|process|Buffer|globalThis|URL|URLSearchParams|FormData|Blob|File|FileReader|WebSocket|Event|CustomEvent|localStorage|sessionStorage|location|history|navigator|performance|requestAnimationFrame|cancelAnimationFrame|addEventListener|removeEventListener|dispatchEvent',
  shCmd: 'npm|git|node|npx|tsc|vitest|python|docker|kubectl|curl|wget|ssh|scp|rsync|ls|cd|echo|mkdir|rm|cp|mv|cat|grep|sed|awk|export|source|exec|test|find|make|bash|sh|zsh',
  shGit: 'gitmesh|install|run|build|test|commit|add|push|pull|rebase|merge|checkout|branch|worktree|stash|reset|restore|switch|init|clone|fetch|remote|config|describe',
};

function escH(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function highlight(code, lang){
  let e = escH(code);
  const { tsKw, jsB, shCmd, shGit } = SYN;
  const patterns = {
    ts: () => e.replace(new RegExp(`\\b(${tsKw})\\b`,'g'),'<span class="c-kw">$1</span>')
      .replace(/(\/\/.*$)/gm,'<span class="c-cm">$1</span>')
      .replace(/(['`])(?:(?!\1)[^\\]|\\.)*?\1/g,'<span class="c-str">$&</span>')
      .replace(/"([^"\\]|\\.)*"/g,'<span class="c-str">$&</span>')
      .replace(/\b(\d+\.?\d*(?:e\d+)?)\b/gi,'<span class="c-num">$1</span>')
      .replace(/:\s*(\b[A-Z]\w*(?:<[^>]+>)?(?:\[\])?\b)/g,': <span class="c-type">$1</span>'),
    js: () => e.replace(new RegExp(`\\b(${tsKw})\\b`,'g'),'<span class="c-kw">$1</span>')
      .replace(new RegExp(`\\b(${jsB})\\b`,'g'),'<span class="c-builtin">$1</span>')
      .replace(/(['`])(?:(?!\1)[^\\]|\\.)*?\1/g,'<span class="c-str">$&</span>')
      .replace(/"([^"\\]|\\.)*"/g,'<span class="c-str">$&</span>')
      .replace(/(\/\/.*$)/gm,'<span class="c-cm">$1</span>')
      .replace(/\b(\d+\.?\d*(?:e\d+)?)\b/gi,'<span class="c-num">$1</span>'),
    sh: () => e.replace(/^(\$\s*)/gm,'<span class="c-op">$1</span>')
      .replace(/#.*$/gm,'<span class="c-cm">$&</span>')
      .replace(new RegExp(`\\b(${shCmd})\\b`,'g'),'<span class="c-fn">$1</span>')
      .replace(new RegExp(`\\b(${shGit})\\b`,'g'),'<span class="c-kw">$1</span>')
      .replace(/(["'])(?:(?!\1)[^\\]|\\.)*?\1/g,'<span class="c-str">$&</span>')
      .replace(/(--?[\w-]+(?:=[^\s]*)?)/g,'<span class="c-var">$1</span>'),
    gen: () => e.replace(/(["'])(?:(?!\1)[^\\]|\\.)*?\1/g,'<span class="c-str">$&</span>')
      .replace(/(\/\/.*$)/gm,'<span class="c-cm">$1</span>')
      .replace(/\b(\d+\.?\d*)\b/g,'<span class="c-num">$1</span>'),
  };
  const fn = patterns[lang] || (['typescript','ts'].includes(lang) ? patterns.ts :
           ['javascript','js'].includes(lang) ? patterns.js :
           ['bash','sh','shell','zsh'].includes(lang) ? patterns.sh : patterns.gen);
  return fn();
}

// Post-process marked.js HTML output
function postProcess(html){
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstChild;

  // Wrap tables
  root.querySelectorAll('table').forEach(tbl => {
    if (!tbl.closest('.doc-table-wrap')){
      const wrap = doc.createElement('div');
      wrap.className = 'doc-table-wrap';
      tbl.parentNode.insertBefore(wrap, tbl);
      wrap.appendChild(tbl);
    }
  });

  // Process code blocks: add .code-block wrapper, lang tag, copy button, highlighting
  root.querySelectorAll('pre > code').forEach(code => {
    const pre = code.parentElement;
    let lang = '';
    const m = (code.className || '').match(/language-(\w+)/);
    if (m) lang = m[1];

    const container = doc.createElement('div');
    container.className = 'code-block';

    if (lang){
      const tag = doc.createElement('span');
      tag.className = 'lang-tag';
      tag.textContent = lang;
      container.appendChild(tag);
    }

    const raw = code.textContent;
    const btn = doc.createElement('button');
    btn.className = 'copy-btn';
    btn.setAttribute('data-code', raw);
    btn.innerHTML = '<i data-lucide="copy" style="width:12px;height:12px"></i><span>复制</span>';
    container.appendChild(btn);

    code.innerHTML = highlight(raw, lang);
    container.appendChild(pre);
    pre.parentNode.insertBefore(container, pre);
  });

  // Convert .md links to internal doc-links
  root.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href');
    if (/\.md$/.test(href)){
      const docId = href.replace(/\.md$/, '').replace(/^\.?\//, '');
      if (DOCS[docId]){
        a.setAttribute('href', 'javascript:void(0)');
        a.setAttribute('data-doc', docId);
        a.classList.add('doc-link');
      }
    } else if (/^https?:/.test(href)){
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    }
  });

  return root.innerHTML;
}

// ============================================================
// APP CONTROLLER
// ============================================================
const contentArea = document.getElementById('contentArea');
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');
const menuBtn = document.getElementById('menuBtn');
const main = document.getElementById('main');

const DOCS = {
  'overview': { title: '概述', file: 'overview.md' },
  'getting-started': { title: '快速开始', file: 'getting-started.md' },
  'feature-checklist': { title: '功能预览', file: 'feature-checklist.md' },
  'core-concepts': { title: '核心概念', file: 'core-concepts.md' },
  'agent-protocol': { title: 'Agent 协议', file: 'agent-protocol.md' },
  'merge-strategies': { title: '合并策略', file: 'merge-strategies.md' },
  'conflict-resolution': { title: '冲突解决', file: 'conflict-resolution.md' },
  'api-reference': { title: 'API 参考', file: 'api-reference.md' },
  'events': { title: '事件系统', file: 'events.md' },
  'error-handling': { title: '错误处理', file: 'error-handling.md' },
  'advanced-usage': { title: '高级用法', file: 'advanced-usage.md' },
};

const cache = {};
let currentDoc = null;

function setActiveLink(docId){
  sidebar.querySelectorAll('.sidebar-link').forEach(el => el.classList.toggle('active', el.dataset.doc === docId));
}

async function loadDoc(docId){
  if (currentDoc === docId) return;
  currentDoc = docId;
  setActiveLink(docId);

  const meta = DOCS[docId];
  if (!meta) return;
  window.scrollTo(0, 0);
  contentArea.innerHTML = '<div class="loading"><div class="spinner"></div>加载中...</div>';

  try {
    if (!cache[docId]){
      const resp = await fetch(meta.file);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      cache[docId] = await resp.text();
    }

    let html = typeof marked !== 'undefined'
      ? marked.parse(cache[docId])
      : cache[docId].split('\n\n').map(p => `<p>${p}</p>`).join('');

    html = postProcess(html);

    const section = document.createElement('div');
    section.className = 'doc-section active';
    section.innerHTML = html;
    contentArea.innerHTML = '';
    contentArea.appendChild(section);

    // Copy buttons
    section.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.code || '');
          const span = btn.querySelector('span');
          if (span) span.textContent = '已复制';
          btn.classList.add('copied');
          setTimeout(() => { if (span) span.textContent = '复制'; btn.classList.remove('copied'); }, 1800);
        } catch { /* clipboard denied */ }
      });
    });

    // Doc links
    section.querySelectorAll('.doc-link[data-doc]').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        if (DOCS[link.dataset.doc]) loadDoc(link.dataset.doc);
      });
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (window.location.hash !== `#${docId}`) history.replaceState(null, '', `#${docId}`);
    closeSidebar();

  } catch (err){
    contentArea.innerHTML = `<div class="doc-error">无法加载文档「${meta.title}」: ${err.message}<br><small>请确保 .md 文件与 sdk.html 在同一目录下</small></div>`;
  }
}

// Sidebar nav
sidebar.querySelectorAll('.sidebar-link').forEach(link => {
  link.addEventListener('click', () => { if (link.dataset.doc) loadDoc(link.dataset.doc); });
});

// Mobile menu
menuBtn.addEventListener('click', () => {
  const open = !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', open);
  overlay.classList.toggle('open', open);
});
overlay.addEventListener('click', closeSidebar);
function closeSidebar(){ sidebar.classList.remove('open'); overlay.classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar(); });

// Hash routing
function init(){
  const hash = window.location.hash.replace('#', '');
  loadDoc(DOCS[hash] ? hash : 'overview');
}
window.addEventListener('hashchange', () => {
  const hash = window.location.hash.replace('#', '');
  if (DOCS[hash] && hash !== currentDoc) loadDoc(hash);
});
function adjustLayout(){ main.style.maxWidth = window.innerWidth >= 1400 ? '960px' : '860px'; }
window.addEventListener('resize', adjustLayout);
adjustLayout();

init();
if (typeof lucide !== 'undefined') lucide.createIcons();
