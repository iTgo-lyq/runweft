import { installationCommands } from './install.js';

document.documentElement.classList.add('js');
const status = document.querySelector('#copy-status');
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const target = document.getElementById(button.dataset.copy);
    const label = button.querySelector('span');
    try {
      await navigator.clipboard.writeText(target.textContent);
      label.textContent = '已复制';
      status.textContent = '命令已复制到剪贴板。';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      target.closest('pre')?.focus();
      label.textContent = '请手动复制';
      status.textContent = '浏览器未允许自动复制。命令已选中，请按 ⌘C 或 Ctrl+C 复制。';
    }
    clearTimeout(button.resetTimer);
    button.resetTimer = setTimeout(() => { label.textContent = '复制'; }, 2500);
  });
}

const releaseElement = document.querySelector('#release-data');
if (releaseElement) {
  const release = JSON.parse(releaseElement.textContent);
  const tabs = [...document.querySelectorAll('[data-platform]')];
  function selectPlatform(platform, focus = false) {
    const item = release.platforms.find(item => item.id === platform);
    if (!item) return;
    for (const tab of tabs) {
      const selected = tab.dataset.platform === platform;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    document.querySelector('#install-panel').setAttribute('aria-labelledby', `platform-${platform}`);
    document.querySelector('#install-command').textContent = installationCommands(item.id, release.version, item.sha256);
    const link = document.querySelector('#platform-download');
    link.href = `downloads/${item.filename}`;
    link.setAttribute('download', item.filename);
    document.querySelector('#platform-download-label').textContent = `下载 ${item.label}`;
    document.querySelector('#platform-size').textContent = item.size;
    document.querySelector('#platform-note').textContent = item.note;
    document.querySelector('#platform-checksum').href = `downloads/${item.filename}.sha256`;
    document.querySelector('#platform-filename').textContent = item.filename;
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectPlatform(tab.dataset.platform));
    tab.addEventListener('keydown', event => {
      const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectPlatform(tabs[next].dataset.platform, true);
    });
  });
  selectPlatform(new URLSearchParams(location.search).get('platform') || 'darwin-arm64');
}

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => {
    const remote = button.dataset.mode === 'remote';
    for (const other of document.querySelectorAll('[data-mode]')) other.setAttribute('aria-pressed', String(other === button));
    document.querySelector('#collaboration-map').dataset.mode = button.dataset.mode;
    document.querySelector('#routing-label').textContent = remote ? '通过 Hub 调度' : '在本机调度';
    for (const element of document.querySelectorAll('[data-location]')) element.textContent = remote ? '远端机器 · 独立 worktree' : '本机 · 独立 worktree';
    document.querySelector('#map-description').textContent = remote ? '远端示意：固定 Git 基线先到达执行机，任务结束后从中心取回成果。' : '本地示意：从主工作区派生两个独立 worktree，任务完成后由主 agent 审查合入。';
  });
}

const menu = document.querySelector('#menu-toggle');
const nav = document.querySelector('#site-nav');
if (menu && nav) {
  menu.hidden = false;
  function closeMenu() { menu.setAttribute('aria-expanded', 'false'); nav.classList.remove('is-open'); }
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
  });
  nav.addEventListener('click', event => { if (event.target.closest('a')) closeMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') { closeMenu(); menu.focus(); } });
}

for (const button of document.querySelectorAll('[data-client]')) {
  button.addEventListener('click', () => {
    for (const other of document.querySelectorAll('[data-client]')) other.setAttribute('aria-pressed', String(other === button));
    const flag = button.dataset.client === 'all' ? '' : ` --client ${button.dataset.client}`;
    document.querySelector('#mcp-command').textContent = `runweft mcp install${flag}\nrunweft mcp check${flag}`;
  });
}
for (const button of document.querySelectorAll('[data-runtime]')) {
  button.addEventListener('click', () => {
    for (const other of document.querySelectorAll('[data-runtime]')) other.setAttribute('aria-pressed', String(other === button));
    document.querySelector('#runtime-command').textContent = `runweft runtime discover\nrunweft runtime register ${button.dataset.runtime}\nrunweft runtime list`;
  });
}
