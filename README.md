# 房屋裂缝智能识别 Web 应用

拍照 / 选图上传房屋照片，由火山方舟 **doubao-1.5-vision-lite** 视觉大模型判断是否存在裂缝，并给出风险等级（高 / 中 / 低）与概率，前端用红 / 黄 / 绿卡片直观展示结果。

- 后端：Node.js + Express，提供 `POST /api/recognize`
- 前端：纯 HTML / CSS / JavaScript（无框架、无构建步骤）
- 密钥：通过 `.env` 读取，**不硬编码**在代码中

---

## 一、目录结构

```
crack-web/
├── server.js            # Express 服务端：静态托管 + 识别接口
├── package.json         # 依赖与启动脚本
├── .env                 # 本地环境变量（存放 API Key，勿提交到 git）
├── .env.example         # 环境变量模板
├── .gitignore
├── README.md
└── public/              # 前端静态资源
    ├── index.html
    ├── style.css
    └── script.js
```

---

## 二、环境要求

- **Node.js >= 18**（后端使用全局 `fetch` 调用方舟接口，Node 18 起原生支持）
- 一个火山方舟 API Key（[控制台获取](https://console.volcengine.com/ark)），且已开通 `doubao-1.5-vision-lite` 模型

检查版本：

```bash
node -v
npm -v
```

---

## 三、启动步骤（完整流程）

### 1. 进入项目目录

```bash
cd crack-web
```

### 2. 初始化 npm（生成 package.json）

如果目录中还没有 `package.json`：

```bash
npm init -y
```

> 本项目已经提供了自带的 `package.json`，可跳过此步；若执行了 `npm init -y`，请把 `package.json` 的 `"scripts"` 改为 `{"start": "node server.js"}`，或直接使用已有的那份。

### 3. 安装依赖

```bash
npm install express dotenv
```

也可直接用项目已声明的依赖安装：

```bash
npm install
```

安装完成后，会生成 `node_modules/` 与 `package-lock.json`。

### 4. 配置 API Key

复制模板文件：

```bash
# macOS / Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

然后编辑 `.env`，把 `your_ark_api_key_here` 换成你自己的 Key：

```ini
ARK_API_KEY=你的火山方舟APIKey
ARK_MODEL=doubao-1.5-vision-lite
ARK_API_URL=https://ark.cn-beijing.volces.com/api/v3/chat/completions
PORT=3000
```

> ⚠️ `.env` 已加入 `.gitignore`，请勿把真实 Key 提交到仓库。

### 5. 启动服务

```bash
npm start
```

或开发模式（Node 18.11+ 支持文件改动自动重启）：

```bash
npm run dev
```

看到下面输出即启动成功：

```
房屋裂缝识别服务已启动：http://localhost:3000
```

### 6. 打开页面

浏览器访问 <http://localhost:3000>，选择或拍摄一张墙体照片，点击「开始识别」。

> 手机端调试：确保手机与电脑在同一局域网，用 `http://<电脑局域网IP>:3000` 访问。
> 注意：浏览器只在 `https` 或 `localhost` 下允许调用摄像头，局域网 `http` 访问时「拍照」按钮可能只能走相册选择。

---

## 四、接口说明

### `POST /api/recognize`

**请求体**

```json
{
  "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABA..."
}
```

`image` 支持完整的 dataURL，也支持不含前缀的纯 Base64 字符串。

**成功响应**

```json
{
  "success": true,
  "data": {
    "hasCrack": true,
    "riskLevel": "高",
    "probability": 85
  }
}
```

**失败响应**

```json
{ "success": false, "message": "错误原因" }
```

### `GET /api/health`

健康检查，返回当前使用的模型与是否已配置 API Key：

```json
{ "success": true, "model": "doubao-1.5-vision-lite", "hasApiKey": true }
```

---

## 五、实现要点

**后端**

1. `express.static('public')` 托管前端文件；`express.json({ limit: '25mb' })` 放大请求体上限以容纳 Base64 图片。
2. 提示词中明确规定判定标准与输出格式，要求模型**只输出 JSON**；`temperature: 0.1` 降低随机性。
3. `extractJson()` 会剥离 ```` ```json ```` 代码块，并兜底截取第一个 `{` 到最后一个 `}`，避免模型附带解释文字导致解析失败。
4. `normalizeResult()` 对 `riskLevel`（兼容「高风险」「high」等写法）与 `probability`（钳制到 0–100）做规范化。
5. 使用 `AbortController` 设置 60 秒超时，避免请求悬挂。

**前端**

1. 上传前用 `canvas` 把图片等比压缩到最长边 1280px、JPEG 质量 0.85，显著减小 Base64 体积。
2. 支持点击选择、拖拽、`Ctrl+V` 粘贴、移动端 `capture="environment"` 直接调起相机。
3. 请求期间展示扫描线动画与加载遮罩，按钮置灰防重复提交。
4. 结果卡片按风险等级切换 CSS 变量：**高=红**、**中=黄**、**低=绿**，并用 `conic-gradient` 圆环 + 进度条展示概率。

---

## 六、常见问题

| 现象 | 原因与解决 |
| --- | --- |
| 提示「服务端未配置 ARK_API_KEY」 | `.env` 未创建或 Key 未填写；填好后**重启服务** |
| HTTP 401 / 403 | API Key 错误或未开通对应模型 |
| HTTP 404 / model not found | `ARK_MODEL` 写错，需与方舟控制台中的模型名称（或推理接入点 ID）一致 |
| 提示「未能从模型返回中解析出识别结果」 | 模型未按 JSON 输出；后端日志会打印原始内容，可据此微调提示词 |
| 图片太大上传失败 | 前端已压缩到 1280px；如仍失败可继续调小 `MAX_EDGE` |
| 端口被占用 | 修改 `.env` 中的 `PORT`，或设置环境变量 `PORT=3001` 后重启 |
