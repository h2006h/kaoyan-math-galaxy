// 静态托管环境（如 GitHub Pages）没有 /api 后端：AI 请求直接走离线模式，
// 避免每次调用产生 405 控制台噪声与等待。本地/自建代理环境不受影响。
export const IS_STATIC_HOST = typeof window !== 'undefined'
  && /(^|\.)github\.io$/i.test(window.location.hostname);
