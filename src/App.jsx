import { lazy, Suspense, useRef, useState } from 'react';
import GalaxyCanvas from './components/GalaxyCanvas.jsx';
import InfoPanel from './components/InfoPanel.jsx';
import LoadingOverlay from './components/LoadingOverlay.jsx';
import ControlDock from './components/ControlDock.jsx';
import QuizPanel from './components/QuizPanel.jsx';
import AdminWorkspace from './components/AdminWorkspace.jsx';
import GalaxySwitcher from './components/GalaxySwitcher.jsx';
import XiaoZhiPanel from './components/XiaoZhiPanel.jsx';
import LoginScreen from './components/LoginScreen.jsx';

// 讲解页按需加载：KaTeX 与其字体只在打开讲解时进入网络（主包不变大）
const NotesPage = lazy(() => import('./components/NotesPage.jsx'));
import {
  DEFAULT_SUBJECT_ID, getSubjects, loadAccount, resetAccount, submitAnswer,
  buildGalaxyView, getQuestionsForPoint,
} from './data/dataService.js';
import { getDemoUser, getLastUser, loginUser, registerUser } from './data/userStore.js';

export default function App() {
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [engine, setEngine] = useState(null);
  const [store, setStore] = useState(null);
  const [selected, setSelected] = useState(null);
  const [quizPointId, setQuizPointId] = useState(null);
  const [user, setUser] = useState(null);
  const [lastUsername] = useState(() => getLastUser()?.username ?? '');
  const [subjectId, setSubjectId] = useState(DEFAULT_SUBJECT_ID);
  const [switchTick, setSwitchTick] = useState(0);
  const [adminOpen, setAdminOpen] = useState(false);
  const [xiaoZhiOpen, setXiaoZhiOpen] = useState(false);
  const [notesPointId, setNotesPointId] = useState(null);
  const toastRef = useRef(null);

  // ── 完整调用链 ─────────────────────────────────────────────
  // QuizPanel.submit → onAnswer → submitAnswer(判题→规则结算→写记录→更新store)
  //   → engine.updatePlanetMastery(星球颜色平滑过渡)
  //   → engine.updateChapterMastery(星团标签重绘)
  //   → 结算明细返回 QuizPanel 展示（本题 ±分 / 考点与章节 before→after / 连对奖励）
  const handleAnswer = (question, payload) => {
    const res = submitAnswer(store, question, payload);
    for (const c of res.pointChanges) engine.updatePlanetMastery(c.pointId, c.after);
    engine.updateChapterMastery(question.chapterId, res.chapter.after);
    return res;
  };

  // 账号切换/重置后：重放账号状态 → 当前星系平滑同步
  const syncGalaxy = () => engine?.syncMastery(buildGalaxyView(store, subjectId));

  // ── 登录 / 注册（用户表）─────────────────────────────────
  // 登录成功：载入该 user_id 的记录并重放掌握度，关闭一切临时浮层后同步星系
  const applyAuth = (u) => {
    if (!store || !u) return;
    loadAccount(store, u.id);
    setUser(u);
    setQuizPointId(null);
    setSelected(null);
    setNotesPointId(null);
    setXiaoZhiOpen(false);
    setAdminOpen(false);
    syncGalaxy();
  };

  const enterDemo = () => {
    const demo = getDemoUser();
    applyAuth(demo);
    showToast('已进入演示账号');
  };

  const handleLogin = async (payload) => {
    const res = await loginUser(payload);
    if (res.ok) {
      applyAuth(res.user);
      showToast(`欢迎回来，${res.user.displayName}`);
    }
    return res;
  };

  const handleRegister = async (payload) => {
    const res = await registerUser(payload);
    if (res.ok) {
      applyAuth(res.user);
      showToast('注册成功，已为你创建全新星图');
    }
    return res;
  };

  const logout = () => {
    if (!user) return;
    engine?.closePanel();
    setUser(null);
    setSelected(null);
    setQuizPointId(null);
    setNotesPointId(null);
    setXiaoZhiOpen(false);
    setAdminOpen(false);
    showToast('已退出登录');
  };

  // 星系切换：热替换星球与连线，关闭面板/做题抽屉，闪光过渡
  const switchGalaxy = (id) => {
    if (!engine || !store || id === subjectId) return;
    const subject = store.knowledge.subjects.find((s) => s.id === id);
    setSubjectId(id);
    setQuizPointId(null);
    setSelected(null);
    engine.setGalaxy(buildGalaxyView(store, id));
    setSwitchTick((t) => t + 1);
    showToast(`已进入「${subject?.name ?? id}」星系`);
  };

  const resetRecords = () => {
    if (!store) return;
    resetAccount(store);
    syncGalaxy();
    showToast('当前账号做题记录已重置');
  };

  // 小智引用跳转：必要时先切到引用考点所在星系，再飞行聚焦该星球
  const openCitedPoint = (pointId) => {
    if (!engine || !store || !store.points.has(pointId)) return;
    const chapterId = store.chapterOf[pointId];
    const target = store.knowledge.subjects.find((s) => s.chapters.some((ch) => ch.id === chapterId));
    if (!target) return;
    if (target.id !== subjectId) {
      setSubjectId(target.id);
      setQuizPointId(null);
      setSelected(null);
      engine.setGalaxy(buildGalaxyView(store, target.id));
      setSwitchTick((t) => t + 1);
    }
    engine.focusPlanet(pointId);
    setXiaoZhiOpen(false);
  };

  // 模拟演示（仅演示账号）：随机抽一个考点，走与真实做题完全相同的提交链路自动作答。
  // 注册用户不展示入口，这里再做一次角色守卫；串行队列进行中重复点击直接忽略，
  // 期间若退出/切换账号则中止，避免把演示数据写进其他账号。
  const simRunRef = useRef(null);
  const simulateMastery = () => {
    if (!engine || !store || user?.role !== 'demo') return;
    if (simRunRef.current) return;
    const ids = engine.getPlanetIds();
    const pid = ids[Math.floor(Math.random() * ids.length)];
    const qs = getQuestionsForPoint(store, pid);
    if (!qs.length) return;
    const ownerId = store.userId;
    qs.forEach((q, i) => {
      setTimeout(() => {
        if (store.userId !== ownerId) return;
        const correct = Math.random() < 0.7;
        const payload = q.type === 'fill'
          ? { text: correct ? q.accept[0] : '0' }
          : { optionIndex: correct ? q.answer : (q.answer + 1) % 4 };
        handleAnswer(q, payload);
      }, i * 450);
    });
    simRunRef.current = setTimeout(() => { simRunRef.current = null; }, qs.length * 450 + 250);
    showToast(`模拟作答「${store.points.get(pid)?.name}」${qs.length} 题`);
  };

  const showToast = (msg) => {
    const el = toastRef.current;
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 1800);
  };

  const subjects = store ? getSubjects(store) : [];
  const currentSubject = subjects.find((s) => s.id === subjectId);

  return (
    <div className={`app ${xiaoZhiOpen ? 'xz-open' : ''} ${!user ? 'login-open' : ''}`}>
      <div className={`scene-layer ${ready ? 'visible' : ''}`}>
        <GalaxyCanvas
          onEngine={(e) => { setEngine(e); if (e) setStore(window.__data); }}
          onProgress={setProgress}
          onReady={() => setReady(true)}
          onSelect={setSelected}
        />
        {engine && user && !quizPointId && (
          <InfoPanel
            engine={engine}
            planet={selected}
            onClose={() => engine.closePanel()}
            onFocusPlanet={(id) => engine.focusPlanet(id)}
            onPractice={(id) => { setXiaoZhiOpen(false); setQuizPointId(id); }}
            onExplain={(id) => { setXiaoZhiOpen(false); setNotesPointId(id); }}
          />
        )}
        {engine && store && quizPointId && (
          <QuizPanel
            store={store}
            pointId={quizPointId}
            onClose={() => setQuizPointId(null)}
            onAnswer={handleAnswer}
          />
        )}
        {switchTick > 0 && <div className="galaxy-flash" key={switchTick} />}
      </div>

      <LoadingOverlay progress={progress} done={ready} />

      <header className="app-header">
        <h1>考研数学知识宇宙</h1>
        <span className="subtitle">{currentSubject?.name ?? '高等数学'} · 星系图</span>
      </header>

      {user && subjects.length > 1 && (
        <GalaxySwitcher subjects={subjects} current={subjectId} onSwitch={switchGalaxy} />
      )}

      {user && (
        <div className="account-box">
          <span className="account-user" title={`${user.displayName}（${user.username}）`}>
            <i className="account-dot" />
            <span className="account-name">{user.displayName}</span>
          </span>
          <button className="account-reset" onClick={resetRecords} title="清空当前账号的做题记录">
            重置记录
          </button>
          <button className="account-admin" onClick={() => setAdminOpen(true)} title="批量导入 / 逐题录入 / AI 辅助检查">
            题库管理
          </button>
          <button className="account-logout" onClick={logout} title="退出登录并返回登录界面">
            退出登录
          </button>
        </div>
      )}

      {adminOpen && store && (
        <AdminWorkspace
          store={store}
          onClose={() => setAdminOpen(false)}
          onImported={(n) => showToast(`已入库 ${n} 题，考点抽题与星图题库同步更新`)}
        />
      )}

      <div className="legend">
        <span><i className="dot state-mastered" />已掌握</span>
        <span><i className="dot state-learning" />学习中</span>
        <span><i className="dot state-weak" />薄弱</span>
        <span><i className="dot state-unlearned" />未学</span>
      </div>

      <ControlDock engine={engine} onSimulate={simulateMastery} canSimulate={user?.role === 'demo'} />

      {user && store && (
        <XiaoZhiPanel
          store={store}
          subjectId={subjectId}
          open={xiaoZhiOpen}
          onOpen={() => setXiaoZhiOpen(true)}
          onClose={() => setXiaoZhiOpen(false)}
          onCite={openCitedPoint}
        />
      )}

      {notesPointId && store && (
        <Suspense fallback={<div className="notes-overlay"><div className="notes-fallback">正在加载知识讲解…</div></div>}>
          <NotesPage
            store={store}
            pointId={notesPointId}
            onClose={() => setNotesPointId(null)}
            onChangePoint={setNotesPointId}
            onPractice={(id) => { setNotesPointId(null); setXiaoZhiOpen(false); setQuizPointId(id); }}
          />
        </Suspense>
      )}

      {ready && !user && (
        <LoginScreen
          ready={!!store}
          lastUsername={lastUsername}
          onDemo={enterDemo}
          onLogin={handleLogin}
          onRegister={handleRegister}
        />
      )}

      <div className="toast" ref={toastRef} />
    </div>
  );
}