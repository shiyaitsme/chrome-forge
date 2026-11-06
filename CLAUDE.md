# Chrome Forge

浏览器端工具:把平面黑白图案转成 3D 铬金属模型。纯静态站,无构建步骤,无 npm 依赖(three.js 已复制到 `vendor/`)。

## 运行与部署

- 本地:`python3 -m http.server 8000`,打开 `http://localhost:8000`。不能用 `file://`,浏览器会拦截 ES module。
- 部署:Cloudflare Workers 静态资源(`wrangler.jsonc` + `.assetsignore`),Build command `exit 0`,Deploy command `npx wrangler deploy`。推送到 `main` 会自动重新部署。
- 新增不该公开的文件(文档、配置)时,同步加进 `.assetsignore`,否则会被当成静态资源发布。

## 结构

- `index.html`:界面和 importmap(`three` 指向 `vendor/three/`)。
- `src/inflate.js`:纯算法,无 DOM(`imageToGray` 除外)。灰度 → 掩码 → 距离变换 → 高度场 → 网格数据,以及轮廓和法线平滑。
- `src/env.js`:程序生成的反射环境(canvas 画出等距柱状图,再用 PMREM 处理),以及用上传图片做反射。
- `src/main.js`:three.js 场景、控件事件、背景图、导出(PNG/GLB/STL)。
- `vendor/three/`:three.js 的 `three.module.js`、`three.core.js` 和用到的 addons(OrbitControls、GLTFExporter、STLExporter)。升级时要把这几个文件一起换,且保持相对路径。

## 约定与注意点

- 滑块的"充气半径"和"液态平滑"以 512px 为基准,代码里按 `max(w,h)/512` 缩放,切换网格精度时手感保持一致。
- 网格边缘顶点(高度为 0)正反面共用同一个索引。改动 `buildMeshData` 时要保持这一点,否则边缘法线会断开,铬面出现缝。
- 法线要在 `computeVertexNormals` 之后调用 `smoothNormals`,不要反过来。
- 渲染器开了 `preserveDrawingBuffer`,PNG 导出依赖它。
- 有背景图时,背景由页面 CSS 画在透明 canvas 后面;PNG 导出会手动合成,逻辑在 `main.js` 的 `#png` 点击处理里。
- `window.__forge` 是给自动化测试用的钩子,不是公开接口。
- 界面文字是中文,保持一致。

## 验证方式

没有自动化测试。改完后用"示例图"按钮检查:预览是否干净、斜角旋转是否立体、边缘是否有锯齿。改动算法时对比修改前后的截图。
