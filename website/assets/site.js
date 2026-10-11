document.documentElement.classList.add('js');
const copyText = {
  "buttonDefault": "复制",
  "buttonSuccess": "已复制",
  "statusSuccess": "已复制到剪贴板。",
  "buttonFallback": "请手动复制",
  "statusFallback": "浏览器未允许自动复制，内容已选中，请按 ⌘C 或 Ctrl+C 复制。"
};
const diagramText = {
  "local": {
    "routingLabel": "经 Hub 派到本机",
    "reviewLocation": "本机 · 共享目录",
    "implementationLocation": "本机 · 独立 worktree",
    "description": "示意：评审直接读当前目录，能看到未提交的改动；实现放进独立 worktree。报告和代码回来后，由你决定是否合入。"
  },
  "remote": {
    "routingLabel": "经 Hub 派到远端",
    "reviewLocation": "远端 · 独立 worktree",
    "implementationLocation": "远端 · 独立 worktree",
    "description": "示意：远端从已提交的 Git 版本建出独立 worktree，未提交的改动不会带过去；完成后报告、代码和附件回到当前对话。"
  }
};
const status = document.querySelector('#copy-status');
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const target = document.getElementById(button.dataset.copy);
    const label = button.querySelector('span');
    try {
      await navigator.clipboard.writeText(target.textContent);
      label.textContent = copyText.buttonSuccess;
      status.textContent = copyText.statusSuccess;
    } catch {
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      target.closest('pre')?.focus();
      label.textContent = copyText.buttonFallback;
      status.textContent = copyText.statusFallback;
    }
    clearTimeout(button.resetTimer);
    button.resetTimer = setTimeout(() => { label.textContent = copyText.buttonDefault; }, 2500);
  });
}

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => {
    const selected = diagramText[button.dataset.mode];
    for (const other of document.querySelectorAll('[data-mode]')) other.setAttribute('aria-pressed', String(other === button));
    document.querySelector('#collaboration-map').dataset.mode = button.dataset.mode;
    document.querySelector('#routing-label').textContent = selected.routingLabel;
    for (const element of document.querySelectorAll('[data-location]')) element.textContent = selected[`${element.dataset.location}Location`];
    document.querySelector('#map-description').textContent = selected.description;
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
    document.querySelector('#runtime-command').textContent = `runweft runtime register ${button.dataset.runtime} --machine <machineId>\nrunweft runtime list`;
  });
}
