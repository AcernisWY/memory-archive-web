(() => {
  'use strict';

  const experience = document.querySelector('#experience');
  const scenes = [...document.querySelectorAll('.scene')];
  const reducedMotion = window.ArchivePreferences.motion;
  const finePointer = window.matchMedia('(pointer: fine)');
  const form = document.querySelector('#login-form');
  const username = document.querySelector('#username');
  const password = document.querySelector('#password');
  const consent = document.querySelector('#consent');
  const submit = document.querySelector('#login-submit');
  const status = document.querySelector('#form-status');
  const dialog = document.querySelector('#info-dialog');
  const dialogPrimary = document.querySelector('#dialog-primary');
  let currentScene = 'intro';
  let introTimer;
  let sceneTimer;
  let submitTimer;
  let closeTimer;
  let dialogAction = null;
  let lastDialogTrigger = null;
  let busy = false;

  // The state of this prototype stays in memory; no credentials are persisted.
  function setBusy(value) {
    busy = value;
    submit.disabled = value;
    submit.classList.toggle('is-loading', value);
    submit.setAttribute('aria-busy', String(value));
    submit.querySelector('.button-text').textContent = value ? '正在开启记忆…' : '开始使用';
    username.readOnly = value;
    password.readOnly = value;
    consent.disabled = value;
  }

  function cancelSubmission() {
    window.clearTimeout(submitTimer);
    setBusy(false);
    status.textContent = '';
  }

  function setScene(next, { focus = true, route = null } = {}) {
    if (!['intro', 'welcome', 'login', 'archive'].includes(next)) return;
    if(next!=='archive'&&window.RecordEditor?.isOpen()){
      window.MemoryArchive.bridge.writeRoute();
      window.RecordEditor.requestLeave(()=>setScene(next,{focus,route}));return;
    }
    window.clearTimeout(introTimer);
    window.clearTimeout(sceneTimer);
    cancelSubmission();
    if (next !== 'login') {
      password.value = '';
      resetPasswordVisibility();
      clearError('password');
    }
    document.body.classList.remove('intro-playing');
    const previous = currentScene;
    if (previous === 'archive' && next !== 'archive') window.MemoryArchive.deactivate();
    currentScene = next;
    experience.dataset.scene = next;
    scenes.forEach((scene) => {
      const active = scene.id === next;
      scene.classList.toggle('is-active', active);
      scene.classList.toggle('is-leaving', scene.id === previous && !active);
      scene.inert = !active;
      scene.setAttribute('aria-hidden', String(!active));
    });
    document.querySelectorAll('.scene-nav button').forEach((button) => {
      if (button.dataset.go === next) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    if (next === 'archive') {
      resetParallax();
      window.MemoryArchive.activate({ focus, route });
    } else {
      try { history.replaceState(null, '', `#${next}`); } catch { /* file:// remains usable. */ }
    }
    if (focus && next !== 'archive') {
      document.querySelector(`#${next} h1`).focus({ preventScroll: true });
    }
    sceneTimer = window.setTimeout(() => scenes.forEach((scene) => scene.classList.remove('is-leaving')), 650);
    if (next === 'intro') {
      // Restart the narrative progress line, including after replay.
      void experience.offsetWidth;
      document.body.classList.add('intro-playing');
      introTimer = window.setTimeout(() => {
        if (dialog.open) return;
        setScene('welcome', { focus: document.activeElement.closest?.('#intro') !== null });
      }, reducedMotion.matches ? 350 : 2900);
    }
  }

  document.querySelectorAll('[data-go]').forEach((button) => {
    button.addEventListener('click', () => setScene(button.dataset.go));
  });

  const particles = document.querySelector('#particles');
  for (let i = 0; i < 18; i += 1) {
    const particle = document.createElement('span');
    particle.className = 'particle';
    particle.style.cssText = `left:${(i * 37 + 11) % 96}%;top:${(i * 29 + 7) % 94}%;--duration:${5 + (i % 6)}s;--delay:-${i % 7}s`;
    particles.appendChild(particle);
  }

  let pointerFrame;
  function resetParallax() {
    cancelAnimationFrame(pointerFrame);
    document.documentElement.style.setProperty('--pointer-x', '0px');
    document.documentElement.style.setProperty('--pointer-y', '0px');
  }
  experience.addEventListener('pointermove', (event) => {
    if (currentScene === 'archive' || !finePointer.matches || reducedMotion.matches || event.pointerType === 'touch') return;
    cancelAnimationFrame(pointerFrame);
    pointerFrame = requestAnimationFrame(() => {
      const rect = experience.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * 9;
      const y = ((event.clientY - rect.top) / rect.height - 0.5) * 7;
      document.documentElement.style.setProperty('--pointer-x', `${x.toFixed(2)}px`);
      document.documentElement.style.setProperty('--pointer-y', `${y.toFixed(2)}px`);
    });
  });
  experience.addEventListener('pointerleave', resetParallax);
  reducedMotion.addEventListener('change', resetParallax);

  function resetPasswordVisibility() {
    password.type = 'password';
    const toggle = document.querySelector('#toggle-password');
    toggle.setAttribute('aria-label', '显示密码');
    toggle.setAttribute('aria-pressed', 'false');
    toggle.querySelector('use').setAttribute('href', '#i-eye');
  }
  document.querySelector('#toggle-password').addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    const toggle = document.querySelector('#toggle-password');
    toggle.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    toggle.setAttribute('aria-pressed', String(show));
    toggle.querySelector('use').setAttribute('href', show ? '#i-eye-off' : '#i-eye');
  });

  function clearError(name) {
    document.querySelector(`#${name}-group`).classList.remove('has-error', 'nudge');
    document.querySelector(`#${name}-error`).textContent = '';
    document.querySelector(`#${name}`).removeAttribute('aria-invalid');
  }
  username.addEventListener('input', () => clearError('username'));
  password.addEventListener('input', () => clearError('password'));
  consent.addEventListener('change', () => clearError('consent'));

  const dialogCopy = {
    register: {
      title: '给记忆一个专属空间',
      body: '账户注册将在后续页面开放。\n现在无需填写账号或密码，直接点击“开始使用”即可进入演示档案馆。',
      button: '回到登录',
    },
    forgot: {
      title: '让记忆，再次与你相遇',
      body: '当前是前端交互演示，无需真实账户。\n直接点击“开始使用”即可继续；真实的密码找回功能将在账户服务接入后提供。',
      button: '继续体验',
    },
    terms: {
      title: '用户协议',
      body: '欢迎体验记忆档案馆。\n本网站用于设计作业与界面交互展示。记忆、图片和草稿保存在当前浏览器中，刷新后可以继续查看；不提供真实注册、身份验证或云端同步。',
      button: '我已了解',
    },
    privacy: {
      title: '珍视每一份私人记忆',
      body: '此演示不会上传、保存或记录你的用户名和密码，也不会使用统计追踪。\n输入仅保留在当前页面内存中。建议使用虚构信息体验，离开登录页后会清空密码。',
      button: '我已了解',
    },
  };

  function openDialog(copy, trigger, onPrimary = null, success = false) {
    window.clearTimeout(closeTimer);
    lastDialogTrigger = trigger || document.activeElement;
    dialogAction = onPrimary;
    dialog.classList.remove('is-closing');
    document.querySelector('#dialog-title').textContent = copy.title;
    document.querySelector('#dialog-body').textContent = copy.body;
    dialogPrimary.querySelector('span').textContent = copy.button;
    document.querySelector('#dialog-emblem use').setAttribute('href', success ? '#i-check' : '#i-spark');
    document.querySelector('#dialog-eyebrow').textContent = success ? 'A NEW MEMORY BEGINS' : 'ARCHIVE OF MEMORIES';
    if (!dialog.open) dialog.showModal();
    document.querySelector('#close-dialog').focus({ preventScroll: true });
  }

  function closeDialog(runAction = false) {
    if (!dialog.open || dialog.classList.contains('is-closing')) return;
    const action = runAction ? dialogAction : null;
    dialog.classList.add('is-closing');
    closeTimer = window.setTimeout(() => {
      dialog.close();
      dialog.classList.remove('is-closing');
      if (action) action();
      else if (lastDialogTrigger?.isConnected && !lastDialogTrigger.closest('[inert]')) lastDialogTrigger.focus({ preventScroll: true });
      dialogAction = null;
    }, reducedMotion.matches ? 0 : 170);
  }
  document.querySelectorAll('[data-dialog]').forEach((button) => {
    button.addEventListener('click', () => openDialog(dialogCopy[button.dataset.dialog], button));
  });
  document.querySelector('#close-dialog').addEventListener('click', () => closeDialog());
  dialogPrimary.addEventListener('click', () => closeDialog(true));
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    ['username', 'password', 'consent'].forEach(clearError);
    setBusy(true);
    status.textContent = '正在开启记忆…';
    submitTimer = window.setTimeout(() => {
      if (currentScene !== 'login') return;
      setScene('archive', { route: '#archive/view' });
    }, reducedMotion.matches ? 0 : 420);
  });

  document.addEventListener('archive:exit', () => setScene('welcome'));
  document.addEventListener('archive:info', (event) => openDialog(event.detail));
  window.addEventListener('hashchange', () => {
    const route = location.hash;
    const scene = route.slice(1).split('/')[0];
    if (dialog.open) { window.clearTimeout(closeTimer); dialog.close(); }
    setScene(['intro', 'welcome', 'login', 'archive'].includes(scene) ? scene : 'welcome', { route });
  });
  const images = [...document.images].map((img) => img.decode ? img.decode().catch(() => {}) : Promise.resolve());
  Promise.allSettled(images).then(() => {
    document.body.classList.add('is-ready');
    const initialRoute = location.hash;
    const initialScene = initialRoute.slice(1).split('/')[0];
    setScene(['intro', 'welcome', 'login', 'archive'].includes(initialScene) ? initialScene : 'intro', { focus: false, route: initialRoute });
  });
})();
