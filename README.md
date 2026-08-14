# dsh-ambience

DeepSeek Harness 客户端插件：界面氛围。

- **背景图片**：可自主淡化的自定义背景（JPG / PNG / WebP），透明度 / 模糊 / 呼吸淡化，表面半透明不遮挡前端 UI；
- **背景音乐**：导入 FLAC / MP3 / WAV / M4A，音量 0–200%，播放列表 / 循环 / 随机；
- **10 段均衡器**：预设 / 预放大 / 旁路；
- 右下角悬浮条展开面板。

## 安装

1. 构建产物拷入 profile 的 `node_modules\dsh-ambience`（或经 `file:` 依赖）；
2. `cordis.patch.yml` 注册：

```yaml
- insert:
    - id: dsh-ambience
      name: dsh-ambience
```

3. 重启 DeepSeek Harness（组合在进程启动时加载）。

## 说明

- 纯客户端插件：host 仅 stub；`dsh.client{platform:"web", inject:["slots","theme"], immediately:true}`；
- 客户端 bundle 为单文件 CJS，包在 `window.__ModuleLoader__.load({id, factory})` 握手壳里；
- 设置持久化在 localStorage（`dsh-ambience:v1` 键）。
