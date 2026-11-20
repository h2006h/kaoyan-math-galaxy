import { useEffect, useRef, useState } from 'react';

// 登录界面：进入网站的第一屏。
// 两个入口：直接进入演示账号（含种子数据）/ 账号密码登录；无账号可就地注册。
// 密码校验与哈希发生在 userStore（PBKDF2 加盐），这里只做表单与提示。
export default function LoginScreen({ ready, lastUsername = '', onDemo, onLogin, onRegister }) {
  const [mode, setMode] = useState('login'); // login | register
  const [username, setUsername] = useState(lastUsername);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const userRef = useRef(null);
  const passRef = useRef(null);

  useEffect(() => {
    (lastUsername ? passRef : userRef).current?.focus();
  }, [lastUsername]);

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setPassword('');
    setConfirm('');
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !ready) return;
    setError('');
    const name = username.trim();
    if (!name || !password) {
      setError(mode === 'login' ? '请输入用户名和密码' : '请填写用户名和密码');
      return;
    }
    if (mode === 'register') {
      if (password.length < 6) { setError('密码至少 6 位'); return; }
      if (password !== confirm) { setError('两次输入的密码不一致'); return; }
    }
    setBusy(true);
    try {
      const res = mode === 'login'
        ? await onLogin({ username: name, password })
        : await onRegister({ username: name, password, displayName });
      if (!res?.ok) setError(res?.error ?? '操作失败，请重试');
    } catch {
      setError('操作失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-overlay" role="dialog" aria-label="登录考研数学知识宇宙">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-star">✦</span>
          <h1>考研数学知识宇宙</h1>
          <p className="login-sub">3D 知识星图 · RAG 智能助教 · 登录以继续你的学习旅程</p>
        </div>

        <button
          className="login-demo"
          disabled={!ready || busy}
          onClick={async () => {
            if (busy || !ready) return;
            setBusy(true);
            try { onDemo(); } finally { setBusy(false); }
          }}
        >
          直接进入演示账号
          <span className="login-demo-hint">含完整种子数据，适合快速体验</span>
        </button>

        <div className="login-divider"><span>或使用账号{ mode === 'login' ? '登录' : '注册' }</span></div>

        <form className="login-form" onSubmit={submit}>
          {mode === 'register' && (
            <label className="login-field">
              <span>昵称（选填）</span>
              <input
                name="display"
                type="text"
                autoComplete="nickname"
                maxLength={16}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="展示在右上角的称呼"
                disabled={busy}
              />
            </label>
          )}
          <label className="login-field">
            <span>用户名</span>
            <input
              ref={userRef}
              name="username"
              type="text"
              autoComplete="username"
              maxLength={20}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="3–20 位字母 / 数字 / 下划线 / 中文"
              disabled={busy}
            />
          </label>
          <label className="login-field">
            <span>密码</span>
            <input
              ref={passRef}
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              maxLength={64}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'login' ? '输入密码' : '至少 6 位'}
              disabled={busy}
            />
          </label>
          {mode === 'register' && (
            <label className="login-field">
              <span>确认密码</span>
              <input
                name="confirm"
                type="password"
                autoComplete="new-password"
                maxLength={64}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="再次输入密码"
                disabled={busy}
              />
            </label>
          )}

          <div className={`login-error ${error ? 'show' : ''}`} role="alert">{error}</div>

          <button className="login-submit" type="submit" disabled={!ready || busy}>
            {busy ? '处理中…' : mode === 'login' ? '登录' : '注册并进入'}
          </button>
        </form>

        <button className="login-switch" type="button" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? '没有账号？注册新账号' : '已有账号？返回登录'}
        </button>

        <p className="login-foot">
          {ready ? '账号与记录保存在本地浏览器 · 密码经 PBKDF2 加盐哈希，不以明文存储' : '正在加载知识库…'}
        </p>
      </div>
    </div>
  );
}
