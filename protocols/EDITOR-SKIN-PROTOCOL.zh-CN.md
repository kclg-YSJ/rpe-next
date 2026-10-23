# RPEN 编辑器皮肤协议 v1

模组管理界面提供 `@mods-open/@mod-manager/@mod-list/@mod-details/@mod-status/@mod-warning` 别名，沿用 API 3。模组入口可参与 organize；皮肤不会改变外部模组导入的确认流程。

本文同时是皮肤作者的实现规范和 AI agent 的制作指南。协议标识为 `rpen-editor-skin`，协议版本为整数 `1`。编辑器皮肤管理位于 **设置 → 编辑器皮肤**，适用于网页端和桌面端。

当前界面契约版本为 **API 3**。旧的 v1 清单继续有效；使用 API 2 能力（响应式规则、参数、变体等）的皮肤应声明 `"compatibility":{"minApi":2}`，在画布色板中引用参数（API 3）的皮肤应声明 `"minApi":3`。API 版本针对编辑器皮肤接口，与应用版本、皮肤自身版本和文件协议 version 各自独立。

本文描述已经实现的能力。结构校验参见 [`schemas/editor-skin-v1.schema.json`](../schemas/editor-skin-v1.schema.json)，组件、变量及静态控件清单参见 [`schemas/editor-skin-components.v1.json`](../schemas/editor-skin-components.v1.json)。最终导入还会进行文件、引用、CSS、图片和字体校验；只通过 JSON Schema 不代表包一定有效。

## 1. 范围与设计原则

皮肤可以改变整个编辑器的表面、文字、尺寸、间距、控件样式、布局、可移动命令的分组、图标、装饰、字体和动画，也可以为编辑时间轴、框选层、剪贴板及切线缩略图调整画布颜色与字体。可以制作亮色、暗色、高对比、紧凑、宽松、侧边命令栏等不同外观。

皮肤不改变音符、事件、噪域的语义，不写入谱面，不调整热键，不添加可执行脚本，不改变预览中判定线、音符、噪域、shader 或素材本身的颜色与外观。噪域皮肤仍使用独立协议。工具按钮上的图片可以替换；播放预览中的音符图片不在此协议范围。

界面的原始功能节点仍由应用拥有，皮肤操作的是这些节点的呈现。`organize` 可以移动列入白名单的命令按钮，其原有事件和禁用状态保留。其他组件可以通过 CSS 的 flex/grid/order 等重排，也可以通过 `hide` 从界面隐藏控件；隐藏后不占位，内部节点继续存在。v1 不允许任意添加 HTML、替换表单、销毁功能节点或将画布重新挂接到另一个父节点。

没有自定义皮肤时直接使用编辑器现有样式，不加载皮肤基础覆盖层。缺省皮肤不是一个导入包，其保留标识为 `default`。本版本另外内置“墨线 Inkline(cmdysj)”，可直接在设置中选择。

### 1.1 当前限制概览

| 范围 | 当前边界 | 原因 / 替代方式 |
| --- | --- | --- |
| 功能与数据 | 不执行脚本、不修改谱面数据、热键和编辑算法 | 皮肤负责呈现，功能扩展由应用实现 |
| 控件结构 | 可以隐藏、重排；不能销毁功能节点或用任意 HTML 替换表单 | 现有应用会直接读取这些节点及其值；使用 hide 不会破坏引用 |
| 跨容器移动 | organize 支持命令、工具、页签和指定组合控件，目标为八个容器 | 输入标签成组移动；取样、画布、页面正文不任意换父级 |
| 绘制 | 每类画布可以有独立色板、透明度、线宽、虚线和字体，尚非每个图形都有独立语义变量 | 同一画布中共用源色仍共用映射；图片像素、音符贴图及播放渲染不改变 |
| 动画与素材 | CSS 动画、动态图片、字体；不支持视频、音频、Lottie 或活动 SVG | 支持包内素材、有限内置图标和高 DPI 来源，不引用任意远程资源 |
| 样式语法 | 声明式 CSS；支持 media/container/supports/starting-style/property | 不能导入 raw CSS 或脚本，important 只开放外观及排列属性；显示逻辑和恢复入口保留 |
| 资源与数量 | 总包 32 MiB、单文件 12 MiB、最多 512 个文件等 | 防止解压和解码成本失控，完整上限见第 11 节 |

这里的“不能销毁节点”来自当前 UI 与功能代码的耦合，不是隐藏控件的限制。例如应用刷新时仍会查询保存按钮、时间输入框或画布；直接删除会让查询返回空值或破坏坐标关系。hide 保留这些节点，不改其输入值、应用隐藏状态或事件绑定，只从皮肤的界面呈现中移除它们。

## 2. 包结构与最小样例

`.rpenskin` 是 UTF-8 文件名的普通 ZIP，也接受 `.zip` 或导入文件夹。支持 ZIP Stored、Deflate，不支持加密、分卷、ZIP64。推荐将 `skin.json` 直接放在根目录，也接受一个共同的外层文件夹。外层文件夹之外不能有其他文件。

```text
my-skin/
  skin.json
  images/
    save.svg
    panel.webp
  fonts/
    ui.woff2
```

包中只能有 `skin.json` 和 `assets` 显式声明的素材，不要附带 README、系统隐藏文件或源码。许可声明可写入 license 字段并在包外提供完整许可；字体和图片的再分发权由作者确认，不能省略其许可证要求的声明。

仅需一个文件即可构成皮肤：

```json
{
  "$schema": "../../schemas/editor-skin-v1.schema.json",
  "protocol": "rpen-editor-skin",
  "version": 1,
  "id": "paper-example",
  "name": "纸面",
  "author": "Your name",
  "colorScheme": "light",
  "tokens": {
    "background": "#eef2f7",
    "surface": "#ffffff",
    "surface-alt": "#f2f5fa",
    "elevated": "#ffffff",
    "input": "#ffffff",
    "text": "#243347",
    "muted": "#526680",
    "border": "#bccbde",
    "accent": "#286bd1",
    "accent-text": "#154a99",
    "selected": "#e2edff"
  },
  "styles": [
    { "selector": "@header", "set": { "border-bottom": "1px solid #bccbde" } }
  ]
}
```

`$schema` 仅供编写工具使用，编辑器不会请求它，不需将 schema 放进皮肤包。这里的相对路径需按作者的目录调整。

### 2.1 清单顶层字段

| 字段 | 类型 / 默认 | 作用 |
| --- | --- | --- |
| `protocol` | 必填字符串 | 固定 `rpen-editor-skin` |
| `version` | 必填整数 | 固定 `1`，不是应用版本 |
| `id` | 必填字符串 | 稳定标识，见下文；同 id 导入会询问是否替换 |
| `name` | 必填，1–80 字符 | 显示名称；也可写成 `{ "zh-CN": "…", "en-US": "…" }` |
| `author` | 可选，1–100 字符 | 在名称后以括号显示 |
| `description` | 可选，1–2000 字符 | 设置中显示的说明；同样支持多语言映射 |
| `colorScheme` | `dark` | `light` 或 `dark`，影响浏览器原生控件 |
| `assets` | `{}` | 图片和字体注册表 |
| `tokens` | `{}` | 基础设计变量，未填写时使用下表缺省值 |
| `styles` | `[]` | 按顺序应用的声明式 CSS 规则 |
| `motions` | `{}` | 命名关键帧动画 |
| `organize` | `[]` | 命令分组和移动 |
| `hide` | `[]` | 隐藏指定控件，不占位，不销毁功能节点 |
| `texts` | `[]` | 界面文字、提示和无障碍名称覆盖 |
| `icons` | `{}` | 组件别名到图片素材 id 的映射 |
| `decorations` | `[]` | 无交互的装饰图片 |
| `canvas` | `{}` | 编辑器画布的色板和字体 |
| `skinVersion` | 可选字符串，最多 40 字符 | 皮肤自身版本，建议采用 `1.0.0` 形式 |
| `compatibility` | `{}` | minApi/maxApi，正整数，检查当前 API 是否在闭区间内 |
| `preview` | 可选 image 素材 id | 设置中的预览图 |
| `license` | 可选字符串，最多 4000 字符 | 许可名称/声明，显示在设置说明中 |
| `parameters` | `{}` | 用户可调的颜色、数值、开关、选择参数 |
| `variants` / `systemVariants` | `{}` / 未设置 | 同包变体及系统明暗映射 |
| `properties` | `{}` | 受限的 CSS 自定义属性注册，用于可插值动画 |

标识（清单 id、素材 id、动画 id、分组 id、装饰 id、变量名）采用 `^[a-z][a-z0-9-]{0,63}$`，例如 `paper-blue`。皮肤 id 不能为 `default`。名称、说明等支持 Unicode。字符串不得只有空白。未知字段会忽略，建议元数据扩展使用 `x-` 前缀；未知协议版本拒绝导入，不能借扩展字段引入脚本或额外文件。

文件路径必须为包内相对路径，用 `/` 分隔，最多 240 字符。禁止绝对路径、盘符、反斜杠、空路径段、`.`、`..`、控制字符、`?`、`#`；文件名大小写冲突会被拒绝。文件名可以包含汉字或空格，推荐使用便于跨平台传输的英文文件名。

## 3. 设计变量 tokens

清单中的 `tokens.surface` 被编译为 `--rpen-surface`，CSS 中使用 `var(--rpen-surface)`。所有变量值都是 CSS 字符串，包括数值。变量不是表达式脚本。

| 变量 | 缺省值 | 自动作用范围 |
| --- | --- | --- |
| `background` | `#303030` | 页面与图片预览底色 |
| `surface` | `#303030` | 主工作台、右侧面板、窗口 |
| `surface-alt` | `#282828` | 工具栏、列表卡片、分组、辅助栏 |
| `elevated` | `#202020` | 顶栏、播放栏、通知、底栏 |
| `input` | `#383838` | 输入框、选择器、普通按钮 |
| `hover` | `#505050` | 普通按钮悬停 |
| `text` | `#f0f0f0` | 正文、标题、控件和标签 |
| `muted` | `#aaaaaa` | 提示、次要信息、小字 |
| `border` | `#666666` | 普通边框 |
| `border-strong` | `#888888` | 悬停强调边框 |
| `accent` | `#ffdc70` | 焦点轮廓、强调、范围/勾选控件 |
| `accent-text` | `#ffe49b` | 选中按钮文字 |
| `selected` | `#4d4632` | 选中按钮、列表项底色 |
| `selected-border` | `#aa9251` | 选中边框 |
| `success` | `#65c878` | 成功通知边框 |
| `warning` | `#e6c65c` | 警告通知和属性提示 |
| `error` | `#e46e6e` | 错误文字与边框 |
| `info` | `#8dd6ee` | 分组名等信息文字 |
| `radius` | `1px` | 普通控件圆角 |
| `radius-panel` | `4px` | 窗口和弹出层圆角 |
| `font-family` | `RPE, "Microsoft YaHei", sans-serif` | DOM 界面字体；可用 `font(id)` |
| `font-size` | `13px` | 根字号，已有专用字号需 styles 单独调整 |
| `control-height` | `29px` | 文件栏、操作网格、窗口和皮肤管理按钮的最小高度 |
| `control-padding` | `6px 10px` | 上述普通命令按钮内边距；微型按钮保留专用几何 |
| `gap` | `6px` | organize 创建的分组间距，其他容器可在 styles 引用 |
| `inspector-width` | `29.7%` | 宽屏右侧面板宽度，下限 240px；窄屏使用原有响应布局 |
| `panel-shadow` | `0 4px 16px #0005` | 窗口、菜单、通知阴影 |
| `motion-fast` | `120ms` | 普通按钮的颜色和边框过渡 |
| `motion-normal` | `220ms` | 供皮肤自定义动画引用 |
| `motion-easing` | `ease` | 普通按钮过渡缓动，也可自行引用 |
| `icon-filter` | `none` | 既有单色伪元素图标及静音图标的滤镜 |
| `scrollbar-thumb` | `#777777` | 滚动条颜色 |

基础变量是覆盖入口，不保证每一处历史专用颜色都能仅靠一个变量改变。精细主题应继续通过组件规则调整。允许额外的合法 token（例如 `card-gap`，对应 `--rpen-card-gap`）；只定义它不会自动产生新行为。`styles.set` 中可声明 `--skin-*` 私有变量，也可覆盖 `--rpen-*`。应用的 `--accent`、`--muted`、`--line` 在根与编辑/右侧区域桥接为皮肤的 accent、muted、border。

tokens 是初始默认值，不是只能读取的常量。可在 `@root` 状态/媒体规则中覆盖全局变量，在 `@inspector` 等子树中覆盖局部变量。原生控件明暗由 CSS 的 `color-scheme` 属性决定，同样可以在规则中改变，不限于顶层 colorScheme。

不要通过 CSS 改写 `--icon` 绕过资源管理，请使用 `icons` 或 `asset(id)`。多选控制球的语义颜色保留在 `--ball-color`；改变大小、边框或阴影时，应保留红/绿/蓝的可区分性。

## 4. 组件与界面组织

选择器中的 `@名称` 会展开成下列稳定组件选择器。使用自定义皮肤期间，匹配的元素还会有 `data-ui="名称"` 标记。动态页面创建后会补上标记；同一节点可能匹配多个别名，所以**推荐直接用 `@别名`，不依赖 data-ui 的最后取值**。

| 别名 | 组件 / 实际选择器 |
| --- | --- |
| `app` | `body`，整个应用 |
| `header` / `brand` | `header` / `.brand` |
| `document-name` / `file-actions` | `#document-name` / `header nav` |
| `transport` / `transport-actions` | `.transport` / `.transport-group` |
| `workspace` / `editor` | `.workspace` / `.editor` |
| `toolbar` / `tools` / `view-controls` | `.editor-toolbar` / `.tools` / `.view-controls-inline` |
| `timeline-header` / `stage` | `.timeline-head` / `.stage` |
| `editor-actions` | `.editor-footer` |
| `inspector` / `inspector-tabs` | `.inspector` / `.inspector-tabs` |
| `chart-tools` | `[data-panel="chart"] .action-grid` |
| `project-home` / `project-list` | `#home` / `#project-cards` |
| `footer` / `status` | `body > footer` / `#status` |
| `notifications` | `#notifications` |
| `dialog` / `settings` / `settings-body` | `#modal` / `#settings-modal` / `.settings-body` |
| `theme-settings` | `#editor-skin-settings` |
| `context-menu` | `.timeline-context-menu` |
| `line-overview` | `.line-switcher`，Ctrl+滚轮线缩略图 |
| `clipboard-history` | `#clipboard-results` |
| `version-control-tool` / `version-control-panel` | 谱面版本控制入口按钮 / 右侧版本控制页面根节点 |
| `root` | 文档根；可附加状态属性及伪类 |
| `line-controls` / `beat-controls` | 线号组合 / 拍数输入组合 |
| `offset-control` / `rate-control` / `pitch-control` | 延迟 / 倍速 / 保调标签及其控件 |
| `view-buttons` / `multi-line-controls` | 视图按钮组 / 多线头栏按钮组 |
| `time-progress` | 横向时间滑条及标记整体 |
| `time-readouts` | 当前秒数、总时长与当前拍数的组合，可整体重排 |
| `note-skin-settings` / `note-skins-open` / `note-skin-manager` / `note-skin-gallery` | 音符皮肤设置入口区域 / 管理按钮 / 独立管理界面 / 皮肤卡片列表；管理界面保留图片预览本色，不经过 Canvas 色板换色 |
| `clock` / `beat-display` / `bpm-display` | 当前秒数与总时长 / 当前拍数 / 当前 BPM 读数，可分别设置样式或隐藏 |
| `note-properties` / `event-properties` / `line-properties` / `noise-properties` | 四类属性表单 |
| `noise-layers` / `noise-list` / `line-list` / `multi-line-list` | 对应层/物件列表 |
| `asset-tree` / `asset-details` | 素材树 / 素材详情 |
| `sample-bar` / `sample-panel` | 预览取样操作条 / 原地取样面板 |
| `field` / `hint` / `panel-title` / `panel-actions` | 字段行 / 提示 / 标题 / 页面操作区 |
| `batch-controls` / `batch-ball` | 多选控制球整体 / 单个控制球 |
| `chat` / `peer-markers` | 联机聊天框 / 他人时间位置 |
| `tab-notes` / `tab-events` / `tab-lines` / `tab-chart` / `tab-noise` | 对应右侧页签，移动后别名仍有效 |
| `tool-select` / `tool-tap` / `tool-hold` / `tool-flick` / `tool-drag` | 选择与各类音符工具 |

以下命令的别名均直接展开为同名 id，例如 `@save` → `#save`：

| 范围 | 别名 |
| --- | --- |
| 文件 | `new`, `open`, `save`, `export`, `library`, `migrate`, `recover`, `preferences`, `help` |
| 播放 | `play`, `rewind`, `view-toggle`, `seek` |
| 编辑 | `undo`, `redo`, `copy`, `cut`, `paste`, `mirror`, `delete` |
| 视图 | `notes-only`, `game-ui`, `reset-camera`, `mute-current-line` |
| 谱面工具 | `metadata`, `bpm`, `assets`, `audio-analysis-tool`, `noise-areas-tool`, `curve-notes`, `curve-trajectory`, `text-lines-tool`, `noise-fit-tool`, `multi-line-tool`, `diagnose`, `history-panel`, `collaboration-tool` |

### 4.1 右侧页面与动态控件

右侧页面用 `[data-panel="页面名"]` 定位，用 `:not([hidden])` 区分当前显示。页面枚举如下：

| 页面名 | 内容 / 内容根 |
| --- | --- |
| `notes` | 音符属性，`#properties` |
| `events` | 判定线事件，`#event-properties` |
| `lines` | 判定线及分组，`#line-panel` |
| `chart` | 谱面工具 |
| `assets` | 素材库，`#asset-library` |
| `collaboration` | 联机，`#collaboration-panel` |
| `audio-analysis` | 波形/频谱，`#audio-analysis-panel` |
| `multi` | 多音符/多事件，`#multi-editor` |
| `multi-line` | 多线，`#multi-line-editor` |
| `metadata` | 谱面信息，`#metadata-editor` |
| `bpm` | BPM，`#bpm-editor` |
| `trajectory` | 曲线轨迹，`#trajectory-editor` |
| `text-lines` | 文字拼合，`#text-lines-editor` |
| `noise-fit` | 噪域图案，`#noise-fit-editor` |
| `curve` | 曲线音符，`#curve-editor` |
| `diagnose` | 检查，`#diagnose-results` |
| `history` | 编辑历史，`#history-results` |
| `noise` | 噪域列表/层，`#noise-panel` |
| `noise-properties` | 噪域及内部事件属性，`#noise-properties` |
| `clipboard` | 剪贴板历史 |

常见样式入口：`.panel-title` 标题、`.field` 标签/控件行、`.hint` 提示、`.action-grid` 操作网格、`.primary` 主操作、`.wide-button` 整行按钮、`details > summary` 折叠头、`.modal-actions` 窗口底栏。例如 `[data-panel="events"] .field input` 只修改事件输入框。不要将 CSS 绑定到某一行索引或中文标签文本；可参考组件目录中的静态 id，动态字段以所属面板加控件类型作通用定制。

音符属性字段与普通事件的首尾等输入提供 `data-rpen-field`，采用数据字段名，如 `positionX`、`startTime`、`start`、`end`；设置字段采用其控件 id。使用 data-key 的轨迹等工具也会映射同名字段。示例：`@note-properties input[data-rpen-field=positionX]`。没有显式登记此属性的历史表单不能按它定位，请使用对应稳定组件别名，不能用翻译后的 aria-label 充当字段契约。

本文登记的别名、面板名、变量、画布角色、状态属性与已经明确标注的字段名在同一 API 内保留意义；底层 class/id 可以调整，别名会同步适配。未登记的实现 class/id 不作此承诺。清单可用 compatibility.maxApi 限制未经作者验证的后续 API。旧运行时曾忽略未知字段，不能指望这些历史构建识别 API 2 的兼容声明；发布时请同时标注需要支持 API 2 的编辑器。

列表入口包括 `.line-entry`、`.line-group`、`.multi-line-row`、`.multi-line-group`、`.asset-tree`、`.asset-folder`、`.asset-row`、`.clipboard-card`、`.project-card`、`.noise-layer-card`、`.history-results`。取样入口包括 `.noise-sample-bar`、`.event-sample-bar`、`.event-sampler`、`.alpha-sample-gradient`；保持取样控制点、透明度渐变和颜色选择器的可辨识性。

### 4.2 模式、状态与布局约束

`.editor.notes-only`、`.editor.multi-notes`、`.editor.multi-events`、`.editor.event-sampling` 是现有模式类；其他模式状态可结合静态目录与源码查看。`button.active`、`:disabled`、`:hover`、`:focus-visible`、`:checked`、`[aria-expanded=true]`、`[aria-pressed=true]` 和 `#play[data-playing=true]` 可用于状态样式。`:has(...)` 可以按当前页面变化调整父容器。

布局可以改变整体网格比例、面板所在方向、控件尺寸和视图中的排列，但必须保留 `.stage` 及画布之间的相对定位、叠层和指针关系。不要改变 canvas 自身的 transform、CSS 宽高比或为它添加内边距；这可能破坏命中与坐标映射。可以改变包含它的编辑区域尺寸，由应用重新计算绘制尺寸。请保留多线滑条、间隔、取样隐藏、播放预览覆盖和 `[hidden]` 的行为。

含固定底部操作区的页面采用“滚动正文 + 不收缩底栏”，如 `.trajectory-scroll` / `.trajectory-footer`、`.text-lines-scroll` / `.text-lines-footer`、`.noise-fit-scroll` / `.noise-fit-footer`。主题可以重设布局，但要继续使用 `min-height:0`、`min-width:0` 和正确的 overflow，使生成/应用按钮在小窗口中仍能触达。

### 4.3 organize：重组现有命令

```json
{
  "organize": [
    {
      "slot": "file-actions",
      "id": "project",
      "label": "项目",
      "direction": "row",
      "collapsible": false,
      "items": ["new", "open", "save", "export"]
    }
  ],
  "styles": [
    { "selector": "[data-skin-group=project]", "set": { "gap": "8px", "order": "-1" } }
  ]
}
```

允许目标容器：`file-actions` 文件栏、`transport-actions` 播放按钮组、`editor-actions` 编辑底栏、`chart-tools` 谱面工具网格、`toolbar` 工具栏、`inspector-tabs` 右侧页签栏、`timeline-header` 编辑头栏、`footer` 底部状态栏。每个条目指定 `slot` 和 `items`。`id` 可选：填写时创建 `.skin-control-group[data-skin-group=id]`，未填写时直接追加到 slot。`direction` 默认 row，也可 column。`label` 为分组名；`collapsible:true` 需要 label，并使用默认展开的 details/summary。指定 direction、label 或 collapsible 时必须提供 id。分组 display、flex-direction 和 gap 由低优先级基础 CSS 提供，示例中的 gap 覆盖可以正常生效。

分组和未分组命令按清单顺序追加在目标末尾，未列出的原命令留在原处。可用 `order` 改变分组在 flex/grid 中的次序。单个命令只能在整个 organize 中出现一次，分组 id 不能重复；最多 40 个条目。暂时不存在的动态命令会在其创建后移动，丢失的命令不会被皮肤制造出来。

可移动命令白名单：

```text
new open save export library migrate recover preferences help
play rewind view-toggle
undo redo copy cut paste mirror delete
metadata bpm assets audio-analysis-tool noise-areas-tool
curve-notes curve-trajectory text-lines-tool noise-fit-tool noise-tracking-tool
multi-line-tool diagnose history-panel collaboration-tool version-control-tool
seek notes-only game-ui reset-camera mute-current-line
tools view-controls view-buttons line-controls beat-controls
offset-control rate-control pitch-control time-readouts multi-line-controls
tab-notes tab-events tab-lines tab-chart tab-noise
tool-select tool-tap tool-hold tool-flick tool-drag
```

时间、线号、视图参数按上表的组合容器移动，保留标签与输入的关系，不拆出其内部单个 input。取样控件、画布和页面正文不在移动名单内。移动后原父级选择器不再适用，请使用组件别名或对应数据属性。目标栏的原始 grid/flex 会保留，作者应为新组合设置明确的布局并验证模式切换；编辑器不会凭空创建命令副本。折叠命令组应保证重要操作还有可发现的入口。

`@clock` 显示“当前时刻s/总时长s”，当前时刻沿用谱面秒数、总时长为音频长度，均保留两位小数；`@beat-display` 另显示当前拍数（两位小数），不会替换用于定位的 `@beat-controls` 输入框。拍数依据当前编辑时间与 BPM 映射，普通编辑沿用当前线的 BPM 倍率，噪域编辑采用全局拍数。可用 `@time-readouts` 整体移动这两个读数，或分别用 styles/hide 调整；动态读数由应用更新，不应用 texts 写入固定文案。这些入口是 API 3 的兼容扩展，已有皮肤不需要提高协议版本。

当前秒数与总时长以“当前时刻s/总时长s”连续显示，作为整体与拍数读数分别占固定槽位并靠右对齐，位数变化不会改变相邻读数的位置；任一槽位不足时，全部读数按同一比例缩小并保留各自的右端位置。皮肤可调整 `@time-readouts` 的宽度与字体；请保留 `@clock`、`@beat-display` 内的数值节点，数值更新与自适应缩放由编辑器处理。时间滑条在自身容器中竖直居中，上方仍为时间标记留出空间。

### 4.4 hide：隐藏控件

```json
{
  "hide": [
    "@migrate",
    "@recover",
    "@toolbar .tools button[data-tool=\"4\"]"
  ]
}
```

hide 为选择器字符串数组，最多 300 项，默认空。支持与 styles 相同的组件别名、选择器列表和状态选择器。此例隐藏迁移、恢复备份和工具栏中的 Drag 按钮。隐藏只作用于当前皮肤，在切换或恢复默认时撤回；原先由应用隐藏的控件仍保持其应用状态，不会被强行显示。

匹配元素采用高优先级 `display:none`，不占布局空间、不参与鼠标命中或键盘焦点顺序。即使应用重新生成控件，或给控件设置普通内联 display，也继续按规则隐藏。设置和输入值、事件处理器、快捷键与功能本身保留；隐藏“保存”不等于禁用保存快捷键，隐藏勾选框也不等于取消勾选。用状态选择器可以有条件隐藏，用媒体规则中的 styles 可按窗口宽度隐藏。

需要隐藏一个带标签的输入时，应将标签或组合容器一起定位，例如 `.line-select-group`，仅隐藏 input 不会自动删除它旁边的标签。hide 不会自动删除空分组、补上替代入口或调整其他控件次序；这些通过 styles/organize 明确处理。独立的皮肤恢复控件与恢复快捷键保留。

原先就可以用 styles 的 `display:none` 或 `visibility:hidden` 改变可见性；后者仍保留占位，且普通声明可能受应用样式优先级影响。hide 提供专门的、不占位的隐藏规则，避免把“隐藏”和“销毁节点”混为一谈。不要用它隐藏整个工作台或画布后还假定该编辑视图可交互，控件是否仍有入口由皮肤作者负责设计。

## 5. styles：声明式 CSS

普通规则为 `{ "selector": "@header button", "set": { "border-radius": "8px" } }`。`set` 的属性名使用 CSS 的 kebab-case，可用标准 CSS 属性、浏览器支持的厂商前缀属性和 `--skin-*` 私有变量。每个 set 最多 100 个属性，属性值为非空字符串，最长 3000 字符。

支持选择器列表、子代/后代、属性、伪类、伪元素。别名可以组合，例如 `@save::before,@open::before`。别名中的 `@` 为协议保留语法，不应用于选择器字符串中的邮件地址。选择器最长 500 字符，必须能被当前浏览器解析；不存在的选择器暂时没有效果。

每个选择器分支都会加上 `:root[data-editor-skin="皮肤id"]` 作用域。以 `@root`、`:root` 或 html 开头的分支会与这个作用域根合并，可直接覆盖根变量；其他分支匹配其后代。以 `@app` 指定 body。即使使用逗号，各分支也分别保留皮肤作用域。

支持嵌套媒体规则：

```json
{
  "media": "(max-width: 700px)",
  "rules": [
    { "selector": "@workspace", "set": { "grid-template-columns": "minmax(0,1fr)", "grid-template-rows": "3fr 2fr" } },
    { "selector": "@file-actions", "set": { "overflow-x": "auto", "min-width": "0" } }
  ]
}
```

每个 rules 数组最多 1000 条，条件嵌套最多 4 层。media 支持逗号、斜杠、范围比较，如 `(width <= 700px), (aspect-ratio < 4/3)`。另外支持 `{ "container":"(width <= 360px)", "rules":[...] }`、`{ "supports":"(display: grid)", "rules":[...] }`、`{ "startingStyle":true, "rules":[...] }`，分别生成 @container、@supports、@starting-style。一个条件对象只有一种条件，用 rules 嵌套组合。编辑区域和右侧面板已经是 inline-size 容器；具名容器可在 styles 中通过 container-name 定义。条件仍禁止花括号、分号、注释、资源 URL 和转义；浏览器不支持的条件不会生效，应保留普通规则作为回退。

需要覆盖内联外观或复选框等旧有尺寸限制时，在规则旁声明 `"important":["width","height","color"]`。仅允许该规则 set 中的外观、文字、尺寸、间距、flex/grid、order、阴影和滤镜属性；不能给 display、visibility、pointer-events、position 等申请 important。应用的 `[hidden]` 与模式隐藏逻辑保留，装饰的 pointer-events:none 也是交互边界。普通 CSS 值里仍不能直接写 !important。

`properties` 可登记最多 40 个 `--skin-*` 自定义属性。例如 `"properties":{"--skin-example-progress":{"syntax":"<number>","inherits":false,"initialValue":"0"}}` 会生成 @property，syntax 支持 `*`、`<number>`、`<length>`、`<angle>`、`<color>`、`<percentage>`、`<time>`。initialValue 仍经过安全值校验，是否符合 syntax 及是否计算独立由浏览器决定。注册生效于当前样式表，名称请含皮肤 id 以避免冲突；切换后删除样式表，不调用永久的 CSS.registerProperty。

样式优先级依次由应用原有 CSS、皮肤基础层、皮肤图标规则、皮肤 styles 参与正常 CSS 级联；每条皮肤规则带有作用域的 specificity，同级时后写覆盖前写。应用的内联布局值和必需的 `[hidden]` 规则可能优先。不要假设 styles 总能覆盖所有内联几何；需要时修改其容器布局。

普通 CSS 声明值中禁止：raw CSS 文件、`@import`、`url(...)`、远程/数据/文件 URL、CSS 转义、注释、花括号/分号/尖括号、直接写 `!important`、`expression()`、`attr()`、`env()`、`image-set()`、`paint()`、`src()`、`behavior`、`-moz-binding`、`all`。条件表达式和 properties.syntax 采用上文单独规则，例如条件中的范围比较符和注册语法中的尖括号合法。资源必须通过下一节的宏引用；高 DPI image-set 由已声明 sources 生成。`:visited`、`:host`、`::slotted`、iframe 与皮肤恢复控件选择器也不可用。浏览器不支持的 CSS 属性或值可能被忽略，因此作者应在目标网页端与桌面端检验，不能仅依靠 JSON 结构校验。

## 6. 图片、字体、图标与装饰

```json
{
  "assets": {
    "save-blue": { "type": "image", "path": "images/save.svg" },
    "paper": { "type": "image", "path": "images/paper.webp" },
    "ui": { "type": "font", "path": "fonts/ui.woff2" }
  },
  "tokens": { "font-family": "font(ui), sans-serif" },
  "icons": { "save": "save-blue" },
  "styles": [
    { "selector": "@inspector", "set": { "background-image": "asset(paper)", "background-size": "cover" } },
    { "selector": "@save::before", "set": { "filter": "none", "width": "20px", "height": "20px" } }
  ]
}
```

`assets` 最多 256 项。图片支持 PNG/JPG/JPEG/WebP/GIF/AVIF/APNG/SVG，字体支持 TTF/OTF/WOFF/WOFF2，须以实际浏览器解码能力为准。GIF、动态 WebP、APNG 可直接作为动画图片；v1 不支持音频、视频、Lottie、可执行 SVG 动画和第三方运行库。

宏 `asset(id)` 仅引用 image，编译为本次载入的本地 blob URL 或高 DPI image-set；`font(id)` 仅引用 font，编译为皮肤命名空间内的字体名。可以在 background、content、border-image 等接受图像的 CSS 属性中使用 asset。字体加载完毕再应用皮肤，切换时释放。静态 SVG 可以使用基本几何、渐变、滤镜和本文件内 `<use href="#id">`；不能含 script、foreignObject、style、image、iframe、链接、animate/set 等活动元素、事件属性、外部 href、外部 URL、实体或 DOCTYPE。SVG 的 style 元素暂不开放，内嵌 CSS 需要另一套资源与选择器检查；用 presentation 属性和编辑器 motions 替代。

`icons` 可以继续使用“组件别名 → image id”对象，也可以使用数组，如 `[{"selector":"@play[data-playing=true]","asset":"pause-icon"},{"selector":".my-button:not(:disabled)","asset":"icon"}]`。数组支持任意合法选择器和状态；按声明次序级联。实现通过 `::before` 绘制 18×18 图标并保留文字、快捷键子节点与原功能。建议只用于按钮，不要给画布、input 等不能可靠显示伪元素的组件指定 icons。styles 可继续调整图标尺寸、margin、滤镜。

`decorations` 为 `{ "id":"sun", "target":"header", "asset":"sun-image" }` 数组，最多 24 项，id 唯一。也可用 selector 代替 target 以定位其他元素。placement 可为 prepend（默认）、append、before、after。每项针对第一个匹配目标，具有 `[data-skin-decoration=sun]`，为空 alt、aria-hidden、无指针事件，不会触发应用功能。max-width、尺寸和位置可通过样式覆盖；不允许恢复它的指针事件。无目标时等待目标创建；input、img、canvas、textarea、select 不接受内部插入装饰，可改为 before/after。

## 7. 动画 motions

```json
{
  "motions": {
    "panel-enter": {
      "from": { "opacity": "0.3", "transform": "translateY(3px)" },
      "to": { "opacity": "1", "transform": "translateY(0)" }
    }
  },
  "styles": [
    {
      "selector": "[data-panel]:not([hidden])",
      "set": { "animation": "motion(panel-enter) 160ms ease-out both" }
    },
    { "selector": "button:hover:not(:disabled)", "set": { "transform": "translateY(-1px)", "transition": "transform 100ms ease" } }
  ]
}
```

`motions` 最多 64 个动画，每个最多 40 个位置，位置为 `from`、`to` 或百分比字符串，如 `50%`、`12.5%`，声明规则与 styles.set 相同。`motion(id)` 编译为 `rpen-皮肤id-动画id`。CSS 的 duration、delay、iteration-count、direction、fill-mode、timing-function 等都可指定，也可只使用 transition。动画由 CSS 状态变化或元素进入 DOM 触发，也可使用第 13 节的只读状态与瞬时信号；不执行皮肤脚本。

启用系统“减少动态效果”时，编辑器强制将 CSS 动画和过渡缩短为近乎立即，并限制动画迭代。动画图片仍由浏览器播放，不能依赖这一机制停下，请另用 `prefers-reduced-motion: reduce` 媒体规则隐藏或替换它们。不要对大型可滚动列表的每个条目持续施加 blur/filter、阴影动画或无限动画。建议以 transform/opacity 为主，过渡约 100–200ms，避免影响画布性能。

## 8. texts：文字与无障碍

```json
{
  "texts": [
    { "selector": "@save", "text": "保存谱面 ", "title": "保存到本机", "ariaLabel": "保存当前谱面" },
    { "selector": "#project-search", "placeholder": "查找谱面" }
  ]
}
```

最多 300 项。每项需要 selector，其他字段可选，内容为最多 1000 字符的纯文本，允许空字符串。每个字段也可写成语言映射（`{ "zh-CN": "…", "en-US": "…" }`），运行时按当前界面语言取值，缺失的语言回退到 `zh-CN`。text 替换第一个非空的**直接文本节点**，保留 img、kbd、input 等子节点；不会用 innerHTML，不解释标签。没有直接文字节点时不制造整段内容，可改为针对内部 span 的选择器。input、textarea、select、canvas 及皮肤管理内的 text 不被替换，避免改变输入值或破坏恢复入口。

title、ariaLabel、placeholder 分别修改同名 HTML 提示、aria-label、占位属性，不修改表单值。页面动态生成和状态改变后会重新匹配；同一元素同一字段的后续匹配项覆盖前项。状态不再匹配或卸载皮肤时复原应用原来的内容。应用主动更新的状态文字仍作为复原来源，不永久回写。

不要给播放/暂停按钮始终写同一个静态动作名；可使用 `@play[data-playing=true]` 与 `@play:not([data-playing=true])` 分开设置。不要覆盖用户输入、音符属性值、谱名或联机聊天为装饰文案。图标按钮必须有 title 或 aria-label，并保留键盘焦点提示。

## 9. canvas：编辑器画布

```json
{
  "canvas": {
    "fontScale": 1,
    "palette": {
      "#303030": "#f5f8fd",
      "#555555": "#bac8da",
      "#ffffff": "#345c8f",
      "#f6e5ce": "#705b40"
    }
  }
}
```

palette 的键必须为 `#rrggbb`；值为 `#rrggbb`，或以 `parameter(id)` 引用一个 type 为 color 的参数（API 3），例如 `"#e58d24": "parameter(event-fill)"`。引用在应用皮肤时解析为参数当前值，用户在设置中调整后画布随之重绘；引用不存在或非颜色参数会在导入时被拒绝。全局 palette、targets 和变体中的 palette 都可以引用。源色按绘制时的 RGB 匹配，支持原调用中的 #RGB、#RGBA、#RRGGBB、#RRGGBBAA、rgb()/rgba() 逗号写法，替换时保留原透明度。键推荐小写。经适配器创建的渐变，其 addColorStop 颜色同样映射；未匹配颜色、已经存在的外部渐变对象和图像像素保持原状；不存在自动反色或调换游戏素材的机制。

当前接入时间轴音符/事件/噪域、密度条与历史条（包括其离屏缓存）、波形/频谱、框选层、批量编辑虚线预览、事件缓动与 Bezier 编辑、曲线音符对话框、文字拼合结果、轨迹/噪域图案小预览、切线/剪贴板缩略图。接入依靠绘制入口显式包装上下文，不会自动拦截浏览器所有 canvas；新增绘制功能必须登记角色并接入。字体测量、文字/图片二值化等算法用画布不接入，避免改变生成结果。编辑器后面的 `#realtime-preview` 和播放 `#preview` 完全排除，取样实际渲染和 shader 输出不做色板改写。

可参考的常用源色：

| 源色 | 常见用途（多个组件可能共用） |
| --- | --- |
| `#303030`, `#202020`, `#20252d`, `#292929` | 编辑底色、缩略图底色 |
| `#555555`, `#414956`, `#334154` | 网格或分隔 |
| `#4e545b`, `#71767c`, `#7f8387`, `#8f9095`, `#75777c` | 辅助刻度和横线 |
| `#ffffff`, `#dddddd`, `#d0d0d4`, `#f5f5f5`, `#d3d3d3`, `#cccccc` | 文本、轮廓、时间提示 |
| `#f6e5ce`, `#ffe0a3`, `#fff4c2` | 事件数值或强调文字 |
| `#80ffa0`, `#ffe080`, `#efe5ff`, `#a0ffdb` | 不同类别的事件数值 |
| `#00ffff`, `#ffff00`, `#80ffff`, `#81bfff`, `#ffdd77` | 选框、辅助线等强调 |

这是一种**绘制色板映射**，并非每一个图形都有独立语义 token；不要假设一个源色只属于一种对象。对不希望改变的语义色不作映射即可。属性中可设置的底部判定线颜色也可能经过同 RGB 映射。

fontScale 为 0.7–1.8，默认 1，仅缩放画布文本的 px 字号，不改变音符几何、坐标、拍数与命中范围。canvas.font 可引用一个 font 素材，替换被接入的画布中 RPE/RPEGame 字族；不强制覆盖工具绘图有意选择的其他字体。DOM 字体使用 tokens.font-family 单独指定。

`canvas.targets` 允许针对角色覆盖同一套配置，角色表见机器目录 canvases：`notes`、`events`、`noise`、`density`、`history`、`audio`、`selection`、`batch-preview`、`easing`、`bezier`、`curve`、`text-lines`、`trajectory`、`noise-fit`、`line-thumbnail`、`clipboard-thumbnail`。例如 `"targets":{"events":{"palette":{"#ffffff":"#102030"}},"batch-preview":{"lineDash":[3,2],"lineWidthScale":1.5,"opacity":0.8}}`。全局 palette 与角色 palette 合并，角色同键优先；其他已指定参数覆盖全局。

opacity 范围 0–1，在绘制时乘以原 globalAlpha；lineWidthScale 范围 0.25–4，在描边时乘原线宽；lineDash 最多 16 个 0–100 数值，替换原代码设置的非空虚线，原有实线仍为实线。绘制完成后还原上下文数值，不改变命中几何。密度/历史缓存完成绘制后直接合成，避免透明度重复相乘。图片像素仍不可换色，音符仍使用已有资源包贴图。

## 10. 导入、持久化、切换与恢复

1. 设置中导入 `.rpenskin`/`.zip` 或文件夹。完整解析和素材解码成功后存入本机皮肤库，导入本身不会切换外观。
2. 选择皮肤，点击“预览 15 秒”。倒计时结束会回到预览前已保存的皮肤；可点浮动条“保留”或设置里的“应用”确认。
3. “应用”保存当前选择，重新打开编辑器仍使用它。网页端皮肤包存入单独的 IndexedDB，当前 id 与个人参数存入 localStorage；桌面端通过统一存储接口分别保存到谱面库的 `editor-skins` 与 `preferences`，沿用原生安全写入与更新继承规则。
4. “恢复默认皮肤”不删除已导入的包，也不清除其他皮肤已保存的参数。删除皮肤会同时移除包、该 id 的本机参数/变体偏好和未确认草稿；再次导入时使用包内默认值。删除已应用的导入皮肤会恢复默认；内置皮肤不能删除。

Ctrl+Alt+Shift+F12 是独立捕获的恢复快捷键，也可在设置中恢复默认。右下浮动确认条仅在限时预览期间显示，正式应用或保留皮肤后消失，不常驻恢复按钮；布局写坏时仍可使用快捷键。也可以在应用 URL 查询参数加入 `skin=default` 临时跳过自定义皮肤，例如 `?skin=default`。该参数不会删除皮肤包，也不会自行清掉保存的选择。

切换时恢复原控件顺序、文字和样式，释放旧字体和 blob URL，再应用新皮肤。启动时找不到皮肤或读取失败则使用默认并报告原因。解析/解码失败不会应用半套皮肤。导入同 id 的包前会询问替换，导入不能覆盖内置 id。

设置中显示 preview 图片、skinVersion 与 license，并按 parameters 自动生成可调控件。调整已应用皮肤的参数或变体会进入 15 秒预览，点击应用/保留后持久化，超时恢复已保存参数。若皮肤配置了 systemVariants，可选择跟随系统明暗。

“恢复此皮肤原始参数”恢复设置中所选皮肤的所有 parameters.default，保留其当前变体；若正在使用这套皮肤则立即应用并保存，无需再次确认，否则只清除该皮肤的自定义参数，不切换当前皮肤。Ctrl+Alt+Shift+Backspace 对正在使用的皮肤执行相同操作，与 Ctrl+Alt+Shift+F12 切换到编辑器默认皮肤不同。恢复后不会被此前的预览倒计时覆盖；其他皮肤的参数保持原状。覆盖安装同 id 的已安装皮肤仍保留个人参数；删除后重装则重新开始。启动时会清理已不存在皮肤留下的参数，修正早期版本遗漏清理的情况。

开发时，如果浏览器支持目录句柄，点击“导入文件夹”只读选择一次目录，此后“重读开发目录”会重新读取、校验并更新同 id 的包，当前正在使用它时自动进入预览。不重复弹出同包替换确认。目录授权仅在本次运行保留，不后台扫描或持续监听；不支持该 API 的环境继续使用普通文件夹导入。默认包的导入、重读和导出不包含个人参数，它们单独保存在本机；替换包的动作本身不由预览超时回滚。

皮肤是个人编辑器偏好，不进入谱面 JSON/PEZ，不发送给联机成员，不修改谱面未保存标记。网页端、桌面端、不同同源地址的存储独立。网页端清理网站数据也会清理导入的皮肤；桌面端更新或移动程序仍沿用原谱面库中的包、选择和参数，切换谱面库时使用目标库的个人设置。

应用维护者若要增加内置皮肤，将同样结构的目录放入 `assets/editor-skins/paper-example/`，再在 `assets/editor-skins/index.json` 中登记 `{ "directory":"paper-example", "files":["skin.json","images/icon.svg"] }`。目录名使用小写英文字母、数字或连字符，files 列出所有包内文件。内置与导入皮肤共用同一解析器和呈现协议，以平级列表显示名称与作者；内置包不接受同 id 的导入覆盖。

## 11. 资源限制与安全边界

| 项目 | v1 上限 |
| --- | --- |
| 包中文件数（含 skin.json） | 512 |
| 解压后总大小 | 32 MiB |
| 单文件大小 | 12 MiB |
| 输入 ZIP 本身 | 33 MiB |
| 单图片解码宽×高 | 1600 万像素 |
| assets / motions / decorations | 256 / 64 / 24 |
| hide 选择器 | 300 |
| styles 每层 / 嵌套 | 1000 条 / 4 层 |
| 单规则属性 / 动画关键帧 | 100 / 40 |
| parameters / variants / properties | 40 / 12 / 40 |
| 每个图片的额外高 DPI 来源 | 4，倍率大于 1 且不超过 4，不重复 |

ZIP 在解压前检查目录声明大小，在读取解压流时检查实际长度，并验证 CRC。SVG 会解析并检查活动内容，字体和图片须实际解码。浏览器 CSP 不因皮肤开放远程资源来源；字体仅补充允许本地 blob。没有文件系统、网络、剪贴板、聊天或命令执行 API。

CSS 仍有很大的布局自由，错误主题可能遮挡按钮、制造低对比或过量动画。导入校验不是视觉可用性认证，也不保证任意压缩图片/字体解码的内存成本固定。分发前必须做以下验收；保留恢复机制，并避免导入来源不明的巨大媒体。

## 12. 制作、打包和验收

可参考内置皮肤 `assets/editor-skins/inkline/` 的清单、素材引用、命令分组与响应式规则。制作新皮肤时应使用自己的 id，不要覆盖内置标识。

在仓库目录运行：

```sh
node tools/pack-editor-skin.mjs path/to/my-skin release/editor-skins/my-skin.rpenskin
# 省略输出文件时，生成 release/editor-skins/<皮肤id>.rpenskin
```

打包器进行与导入器相同的纯数据校验；浏览器导入继续验证 CSS 选择器和媒体解码。`node tools/editor-skin-spec.mjs` 从运行时组件/变量定义重新生成 schema 与目录。`npm test` 包含协议解析、安全、打包导入和画布隔离测试。

程序化界面回归可先设置环境变量 `RPE_PORT=4187` 并运行 `node tools/serve.mjs`，再用 `electron tools/test-editor-skin-electron.cjs`。测试使用最小合成测试数据和独立本机数据目录，不依赖额外主题包，输出截图到忽略提交的 `.local-tools/`。服务地址可用 `RPE_SKIN_TEST_URL` 指定。

建议人类或 AI agent 按以下顺序制作：

1. 阅读本文、Schema 和组件目录，复制最小清单，先决定色系、字体、信息密度与右侧面板宽度。
2. 先完成 tokens 与画布底色/文字色板，检查普通/选中/禁用/悬停/键盘焦点的对比。
3. 逐个处理顶栏、播放栏、工具栏、编辑头栏、右侧页面、主界面、列表、弹窗、通知和右键菜单。所有功能都应可发现。
4. 有必要时使用 organize 重组命令；不要克隆有 id 的按钮、用文字模拟按钮或改变表单值。
5. 注册原创或获准分发的素材，使用 asset/font/motion 宏；为图标保留文字或无障碍名称。静态 SVG 与动画素材分开考虑。
6. 在编辑、播放预览、单线/多线、噪域、取样、批量编辑、素材库、设置、主界面及弹窗中检查效果。后四类动态页面也必须可读。
7. 至少检查约 1440×900、1000×680、600×800 的窗口，以及系统字体缩放、高 DPI、减少动态效果；窄窗口使用滚动而非裁掉主要操作。
8. 验证导入不直接应用、预览超时恢复、重启恢复、自定义皮肤间切换、恢复默认、删除皮肤、错误包拒绝，确认原有保存、选择、撤销功能仍能工作。

协议后续可增加组件别名、语义画布颜色等入口；v1 作者应优先使用本文明确的稳定入口，对源码特定 class/id 的高级定制保留回退。需要执行脚本、自定义编辑逻辑或新型控件的功能应作为应用功能开发，不能通过皮肤绕过。

## 13. API 2 作者指南与完整扩展示例

### 13.1 响应式变量、局部配色、系统明暗

```json
{
  "compatibility": { "minApi": 2 },
  "styles": [
    {
      "media": "(width <= 900px), (aspect-ratio < 4/3)",
      "rules": [{ "selector": "@root", "set": { "--rpen-inspector-width": "280px", "--rpen-font-size": "12px" } }]
    },
    {
      "selector": "@inspector",
      "set": { "--rpen-surface": "#f4f8ff", "--rpen-text": "#203040", "--rpen-input": "#ffffff" }
    },
    {
      "container": "(width <= 360px)",
      "rules": [{ "selector": "@panel-title", "set": { "padding": "8px 12px" } }]
    },
    {
      "media": "(prefers-color-scheme: dark)",
      "rules": [{ "selector": "@root", "set": { "--rpen-background": "#152030", "color-scheme": "dark" } }]
    }
  ]
}
```

样式的作用域优先级仍高于许多旧应用规则，协议不会自动猜测作者要保留哪些响应式样式。自己覆盖了 padding、字号等布局属性后，应补充相应容器规则；系统明暗可用此处的 media 规则，也可用下节的成对变体，但不要同时写互相冲突的两套配色。inspector-width 是工作台父容器使用的值，要在 @root 或 @workspace 上覆盖，在 @inspector 内定义不会反向影响父容器宽度。

### 13.2 可调参数与同包变体

```json
{
  "skinVersion": "1.2.0",
  "compatibility": { "minApi": 2 },
  "license": "填写此皮肤实际采用的许可与必要声明",
  "parameters": {
    "panel-width": { "type": "number", "label": "侧栏宽度", "min": 260, "max": 520, "step": 10, "unit": "px", "default": 350 },
    "accent": { "type": "color", "label": "强调色", "default": "#2469d9" },
    "dense": { "type": "boolean", "label": "紧凑倾向", "default": false },
    "corners": { "type": "select", "label": "圆角", "options": { "2px": "轻微", "8px": "圆润" }, "default": "8px" }
  },
  "tokens": { "inspector-width": "parameter(panel-width)", "accent": "parameter(accent)", "radius": "parameter(corners)" },
  "variants": {
    "day": { "name": "日间", "colorScheme": "light", "tokens": { "surface": "#ffffff", "text": "#203040" } },
    "night": { "name": "夜间", "colorScheme": "dark", "tokens": { "surface": "#172330", "text": "#eaf1fa" } }
  },
  "systemVariants": { "light": "day", "dark": "night" }
}
```

参数 type 为 number/color/boolean/select，需要 label 和 default；label 与 select 的选项文本同样可以写成语言映射。数值必须提供有限的 min/max/default，可提供正 step（默认 1）和 unit：空、px、em、rem、%、ms、s、deg。应用时钳制范围；颜色为 #rrggbb，开关编译为 0/1，选择参数的键是安全 CSS 值、值为界面标签，default 必须是已有键。`parameter(id)` 编译为 `var(--rpen-param-id)`；可在 calc 等表达式中使用，定义参数本身不会自动引入编辑器行为。颜色参数还可以直接作为 canvas palette 的值（API 3，见第 9 节），让时间轴等画布与界面配色一起调整；画布值只接受完整的 `parameter(id)`，不支持 color-mix 等表达式，需要派生色时请另设参数。

variants 的每个条目需要 name，可覆盖 colorScheme、tokens、styles、canvas。基础规则与变体规则依次叠加，变量按键覆盖，画布全局 palette 按键合并，targets 按角色替换后由绘制器与全局配置合并；不会重建另一套功能结构。最多 12 个变体，id 不可为 base/auto；base 为基础外观，auto 为跟随系统。systemVariants 必须指向已有的 light/dark 两个变体，可指向同一变体。

本轮不实现跨包继承、任意多个皮肤同时叠加。这样导入包不依赖本机是否安装某个父皮肤，切换和导出结果可重现。共享外观可放同一包的基础字段，差异放 variants；需要分发两个包时由作者工具在打包前展开共享定义。

### 13.3 只读界面状态与瞬时信号

文档根始终提供下列稳定属性，皮肤不需从按钮文字反推：

| 根属性 | 值 |
| --- | --- |
| data-rpen-playing | true / false |
| data-rpen-dirty | true / false，包含素材未保存状态 |
| data-rpen-pane | 当前右侧页面名 |
| data-rpen-mode | notes、notes-events、multi-notes、multi-events、noise、global-events |
| data-rpen-location | home、editor、preview |
| data-rpen-collaboration | offline、connecting、ready |
| data-rpen-beat | 当前拍数向下取整的整数 |

例如 `@root[data-rpen-dirty=true] @save` 高亮未保存按钮，`@root[data-rpen-pane=assets] @inspector` 改变素材页面配色。状态用于样式，不赋予修改状态的能力，也不暴露消息文本、成员昵称、文件路径等隐私。

信号以约 180ms 的根属性脉冲呈现，属性名为 `data-rpen-event-信号名=true`。登记信号：beat（播放跨越整数拍）、save-started、save-succeeded、save-failed、error、warning、collaboration-changed。信号再次触发会先清除再在下一帧置为 true，可用属性选择器重新启动 motion。它们用于装饰和反馈，不是完整事件总线；快进跨多拍只发当前跨越信号，不回放中途每拍，减少动态效果偏好仍生效。不要依赖信号执行谱面操作。需要完整的逐拍动画可依据 beat 状态设计，但协议不提供任意 JS 回调。

### 13.4 内置图标、高 DPI 与素材复用

全局事件新增稳定别名 `global-events-tool`、`close-global-events`、`global-events-panel`、`global-event-types`、`global-event-density`、`global-event-inspector`、`global-event-properties`；页面名为 `global-events`（总览）和 `global-event-properties`（独立属性），没有常驻标签。画布角色 `global-events` 和 `global-density` 分别控制事件时间轴和横向密度条，沿用全局色板并可在 canvas.targets 单独覆盖。全局事件列宽由普通事件基准或提供方注册项决定，总览不提供调宽控件。

```json
{
  "assets": {
    "native-save": { "type": "image", "builtin": "save" },
    "picture": { "type": "image", "path": "images/picture.png", "sources": [{ "path": "images/picture@2x.png", "scale": 2 }] }
  },
  "icons": [{ "selector": "@save", "asset": "native-save" }],
  "preview": "picture"
}
```

builtin 必须使用组件目录 builtinAssets 表中登记的有限名称，不能输入任意应用文件路径。当前包含 folder、save、setting、help、play、replay、showback、jump、copy、shear、paste、delete0、switch、layout、return、info、waves、bezier、addline、mute；复用时无需把这些图片拷贝进包，应用升级由目录保持引用映射。未列出的音符/打击素材不作通用资源接口。

普通 image 的 path 为 1x 来源，sources 提供最多 4 个额外倍率，倍率须大于 1、不超过 4 且互不重复。每张来源都计入文件与大小上限并解码校验。asset()/icons 的背景生成 image-set，装饰使用 srcset，浏览器按显示密度选择；显式预览图使用 path 的基础来源。字体与 builtin 不接受 sources。为了避免接入任意资源字符串，直接在 CSS 中手写 image-set/url 仍禁止。
