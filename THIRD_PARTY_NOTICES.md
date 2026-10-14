# 第三方组件与素材

本项目代码使用 MIT，第三方组件保留自身许可证。安装包内的 LICENSE 是完整声明来源；分发运行时前需另外整理其全部声明。

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| Electron 44.2.0 | 桌面运行时 | MIT；Chromium、Node.js 等另有声明 |
| playwright-core 1.63.0 | 模拟测试 | Apache-2.0 |
| @electron/get、@types/node、undici-types、debug、env-paths、ms、progress、undici | 开发与下载依赖 | MIT |
| @electron-internal/extract-zip | ZIP 解包 | BSD-2-Clause |
| graceful-fs、semver | 工具依赖 | ISC |
| sumchecker | 下载校验 | Apache-2.0 |
| Pillow、rapidocr-onnxruntime、推理依赖及模型 | 可选 OCR | 各安装包与模型许可证；不捆绑分发 |
| REA | 可选诊断 | 用户自行安装并遵守原项目许可证；不捆绑 |

`test/fixtures/native-input.webm` 是本项目生成的 12 秒无声纯蓝画面，不含外部课程、人物或音乐。用 FFmpeg 重建：

```sh
ffmpeg -f lavfi -i color=c=blue:s=320x180:r=10 -t 12 -an -c:v libvpx -b:v 40k -map_metadata -1 test/fixtures/native-input.webm
```

FFmpeg 只用于素材生成，不属于运行依赖。模拟 HTML、图形及题目由本项目自建，不捆绑课程视频、教材、学校徽标、实际试题或认证文件。
