/* Mermaid initialization */
if (typeof mermaid !== 'undefined') {
  mermaid.initialize({
    startOnLoad: true,
    theme: 'base',
    themeVariables: {
      darkMode: true,
      background: '#1E293B',
      mainBkg: '#1E293B',
      secondBkg: '#334155',
      primaryColor: '#1E293B',
      primaryBorderColor: '#22C55E',
      primaryTextColor: '#F8FAFC',
      secondaryColor: '#334155',
      secondaryBorderColor: '#3B82F6',
      secondaryTextColor: '#F8FAFC',
      tertiaryColor: '#0F172A',
      lineColor: '#475569',
      textColor: '#F8FAFC',
      nodeBorder: '#22C55E',
      clusterBkg: '#0F172A',
      clusterBorder: '#334155',
      titleColor: '#F8FAFC',
      edgeLabelBackground: '#1E293B',
      noteTextColor: '#F8FAFC',
      noteBkgColor: '#334155',
      noteBorderColor: '#475569',
      actorBkg: '#1E293B',
      actorBorder: '#22C55E',
      actorTextColor: '#F8FAFC',
      actorLineColor: '#475569',
      signalColor: '#94A3B8',
      signalTextColor: '#F8FAFC',
      labelBoxBkgColor: '#1E293B',
      labelBoxBorderColor: '#334155',
      labelTextColor: '#94A3B8',
      loopTextColor: '#94A3B8',
      activationBorderColor: '#22C55E',
      activationBkgColor: '#1E293B',
      sequenceNumberColor: '#22C55E',
    },
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 14,
    flowchart: { curve: 'basis', padding: 20 },
    sequence: { actorMargin: 80, messageMargin: 40 },
  });
}

/* Sidebar toggle (mobile) */
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  if (toggle && sidebar) {
    toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.querySelector('.main-content')?.addEventListener('click', () => sidebar.classList.remove('open'));
  }

  /* Scroll to top */
  const scrollBtn = document.querySelector('.scroll-top');
  if (scrollBtn) {
    window.addEventListener('scroll', () => {
      scrollBtn.classList.toggle('visible', window.scrollY > 400);
    });
    scrollBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }

  /* Tab system */
  document.querySelectorAll('.code-tabs').forEach(tabGroup => {
    const buttons = tabGroup.querySelectorAll('.tab-btn');
    const panels = tabGroup.querySelectorAll('.tab-panel');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const target = tabGroup.querySelector(`#${btn.dataset.tab}`);
        if (target) target.classList.add('active');
      });
    });
  });

  /* Active sidebar link */
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.sidebar-link').forEach(link => {
    if (link.getAttribute('href') === currentPage) {
      link.classList.add('active');
    }
  });

  /* Syntax highlighting */
  if (typeof hljs !== 'undefined') {
    hljs.configure({
      ignoreUnescapedHTML: true,
      languages: ['typescript', 'python', 'go', 'csharp', 'json', 'bash', 'yaml']
    });
    document.querySelectorAll('pre code[class*="language-"]').forEach(block => {
      hljs.highlightElement(block);
    });
  }

  /* Reading time estimate */
  const content = document.querySelector('.content-area');
  if (content) {
    const text = content.textContent || '';
    const wordCount = text.trim().split(/\s+/).length;
    const readingTime = Math.ceil(wordCount / 200);
    const badge = document.querySelector('.phase-badge');
    if (badge) {
      const timeSpan = document.createElement('span');
      timeSpan.style.cssText = 'margin-left: 1rem; opacity: 0.7; font-size: 0.75rem;';
      timeSpan.textContent = readingTime + ' min read';
      badge.appendChild(timeSpan);
    }
  }
});
