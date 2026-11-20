// 静态资源前缀：构建时由 Vite base 决定（'./' 支持 GitHub Pages 子路径，'/' 支持根路径部署）。
// 仅用于 public/ 下的静态文件（data、textures）；/api 后端接口保持绝对路径。
export const BASE_URL = import.meta.env.BASE_URL;

export function assetUrl(path) {
  return `${BASE_URL}${String(path).replace(/^\.?\//, '')}`;
}
