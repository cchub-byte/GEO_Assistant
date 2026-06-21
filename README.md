# GEO System

本地可运行的 GEO（Generative Engine Optimization）系统，覆盖 Query集管理、多平台采集、答案解析、引用/吸收指标、品牌画像分析、内容资产、内容写作和最新批次报告导出。

## Quick Start

```bash
npm install
cp .env.example .env
npm run db:setup
npm run seed
npm run demo
npm run dev
```

打开 `http://localhost:3000`。

## Browser Collection

系统优先使用 Playwright 持久化浏览器会话。首次采集真实平台前，在“采集计划”页面打开登录窗口并手动登录豆包、千问、ChatGPT、Google 或 Perplexity。未登录或平台 UI 变化时，采集会记录明确失败原因；mock connector 和手动导入仍可保持系统闭环。
