# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      ...tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      ...tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      ...tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## 自动部署

仓库根目录下的 `.github/workflows/deploy.yml` 会在每次 push 到 `feature/flower` 分支时运行。流程会自动安装依赖、执行 `npm run build`，随后把 `dist/` 目录通过 SSH 上传到服务器的 `/usr/share/nginx/html/fs/`（如需自定义，可以在 secret 中设置 `DEPLOY_PATH`），并在完成后执行 `nginx -s reload` 让 Nginx 立即读取最新内容。

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中配置以下 secrets 即可生效：

- `SSH_PRIVATE_KEY`：可登录部署服务器的私钥内容。
- `DEPLOY_HOST`：服务器地址或 IP。
- `DEPLOY_USER`：登录服务器的用户名。
- `DEPLOY_PORT`（可选）：SSH 端口，默认 22。
- `DEPLOY_PATH`（可选）：如果需要覆盖默认的 `/usr/share/nginx/html/fs` 路径，可以在这里指定。

配置完成后，只要 commit 并 push 到 `feature/flower`，GitHub Actions 就会触发自动构建、部署到 `/usr/share/nginx/html/fs/`，并自动 reload Nginx。
