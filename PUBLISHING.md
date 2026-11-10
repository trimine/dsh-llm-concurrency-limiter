# 发布到 GitHub / Publishing to GitHub

目标仓库 / Repository: https://github.com/trimine/dsh-llm-concurrency-limiter

## 中文步骤

此目录已准备好发布文件，但尚未代您创建仓库、推送或发布 Release。`1.0.0` 是首个公开版本；开发过程的 1.1.x 不作为公开历史发布。

1. 登录 GitHub 的 `trimine` 账号，新建公开仓库 `dsh-llm-concurrency-limiter`。建议不要勾选自动生成 README 或许可证，避免首次推送冲突。
2. 解压提供的源码 ZIP，进入直接包含 `package.json` 的目录。不要直接上传 ZIP 作为仓库全部内容；应提交解压后的文件（包括 `.github`、`.gitignore`）。不要提交 `config-before-audit.json` 等个人备份。
3. 如果使用 Git，在该目录执行：

```sh
git init
git branch -M main
git add .
git commit -m "Release v1.0.0"
git remote add origin https://github.com/trimine/dsh-llm-concurrency-limiter.git
git push -u origin main
git tag v1.0.0
git push origin v1.0.0
```

如果已有 Git 仓库或 remote，请核对后使用现有设置，不要重复初始化或覆盖远端。

4. 本地运行 `npm run check` 和 `npm test`。GitHub Actions 也会在 push/PR 时测试 Node 22、24。
5. 使用提供的安装包，或在仓库目录重新运行 `npm pack` 生成 `dsh-llm-concurrency-limiter-1.0.0.tgz`。
6. 在 GitHub **Releases → Draft a new release**，选择 `v1.0.0` 标签，标题填写 `LLM并发限制器 v1.0.0`，复制 CHANGELOG 的发布说明。上传 `.tgz` 附件，可同时上传源码 ZIP 和校验和文件。不要将源码 ZIP 重命名为 `.tgz`。
7. 发布后验证 README 中 Release 下载链接可用，再在 DSH 插件安装入口测试该 URL。GitHub 标签安装来源为 `github:trimine/dsh-llm-concurrency-limiter#v1.0.0`。

## 发布前检查

- 版本、标签与附件名称均为 1.0.0。
- 中英文 README 顶部链接可互相切换。
- 检查许可证与作者信息：当前保留已有的 `DeepSeek Harness Community` 署名，不冒称官方发布；如需改变权利人请自行确认。
- 仓库没有 API Key、会话日志、个人配置备份或 `node_modules`。
- `.tgz` 包内包含 package.json、index.js、client.js、cordis.patch.yml、locale、icon.svg 和文档。
- 不要在未发布 npm 包时宣传可以仅输入包名安装。
- 新版本需同步 package.json、CHANGELOG、README 安装 URL 和标签，重新生成安装包。

## English

The files are prepared locally; no repository, push, tag or public release has been created on your behalf. Version 1.0.0 is the first public release, replacing development-only numbering.

Create the public repository under `trimine`, extract the source archive, and commit its contents including dotfiles. Use the Git commands above only in a new repository; inspect existing remotes before changing them. Run `npm run check` and `npm test`, then `npm pack`. Create a GitHub release for tag `v1.0.0` and upload the generated `.tgz` asset. Do not rename the source ZIP to a tarball.

Check the published download link and install it through DSH. Git-source installation may require Git locally. npm publication is optional and separate. Review the existing MIT attribution before publishing, and never include private configuration backups, API keys, logs or node_modules.
