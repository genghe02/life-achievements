# 人生成就系统

像 Minecraft 的进度一样，把人生里的每个成就记下来。

打开就能用：https://genghe02.github.io/life-achievements/

- 任务树：前置进度都完成后，后面的进度才会解锁。
- 自己加进度、领域和现实奖励，完成进度攒经验和绿宝石。
- 数据只保存在你自己的设备上，可以在菜单里导出和导入备份。
- 手机上用浏览器打开后「添加到主屏幕」，就能像 App 一样用，没网也能打开。

## 开发

需要 Node 22。

```sh
npm ci
npm run dev        # 本地开发
npm run check      # 类型检查 + lint + 单元测试
npm run e2e        # Playwright 端到端测试（电脑和手机尺寸）
npm run build      # 构建到 dist/
```

推送到 `main` 后，GitHub Actions 会自动构建并发布到 GitHub Pages。

架构和设计说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
