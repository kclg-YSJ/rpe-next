# RPEN 模组协议与开发指南 · API 1

AI命令扩展：`api.agent.register(definition)` 可将任意模组功能注册给内置Agent，`api.agent.list()` 查看工具结构，卸载自动注销；通用谱面工具也能读写模组字段。权限、只读prepare、变更计划、执行一致性和Provider扩展详见 [AI Agent协议](AI-AGENT-PROTOCOL.zh-CN.md)。此项为API1兼容扩展，不要求旧模组修改。

模型请求按需携带工具定义，新增模组命令可通过 `agent_tools` 发现，注册接口和完整 `api.agent.list()` 不变。`api.editor.agentWorkspaceId` 是当前谱面的稳定本地 AI 工作区标识；`await api.editor.agent.ready` 等待对话恢复，`await api.editor.agent.flush()` 等待本地记录落盘。可信扩展可使用 `api.editor.agent.workspace` 管理该工作区文件；桌面端限制在独立目录，不授予任意磁盘或终端访问。对话及原始请求属于用户本地数据，模组不应未经用户要求上传或读取无关内容。

本协议定义可执行的编辑器扩展。模组可以修改界面、交互、渲染、编辑语义、谱面数据、导入导出和存储流程，也可以实现独立工具或游戏。内置示例不构成能力白名单。编辑器皮肤和音符皮肤属于各自的数据协议；模组可以调用、扩展或替换它们的实现。

机器可读清单见 `schemas/mod-v1.schema.json`，接口声明见 `schemas/mod-api-v1.d.ts`。API 1 从当前开发版本提供。`api.version` 是模组宿主接口版本，`mod.json.version` 是模组自己的版本，与谱面的 `RPEVersion` 相互独立。

## 1. 权限与用户流程

右上角“模组”打开独立管理器，可查看包内源码、启停、配置快捷键与参数、恢复默认参数、导入、导出和删除。右下角显示实际已装载数量。首次使用没有自动启用的模组；用户启用过的模组会在下次启动时自动装载。删除外部模组会清除其参数和专属存储。内置模组可以禁用、配置及导出，但不能删除或被同 ID 外部包覆盖。

外部包在解析和语法检查后、保存和执行前必须经过风险说明与主动勾选确认。确认导入后仍处于禁用状态。替换已有包再次显示风险提示，并停用原版本。风险提示说明完整编辑器权限、未知影响、作者免责，以及可信来源、源码或 AI 检查和备份建议；检查并非安全保证。

**模组与编辑器在同一个 JavaScript 页面运行，没有模组权限沙箱。** 它可以访问页面 DOM、当前编辑器存储中的谱面与设置，执行网络请求，调用宿主公开对象、导入内部模块和改写原型。网页端访问限于同源存储；桌面端也可通过编辑器的存储接口读取、修改或删除所选原生谱面库中的数据。启用意味着信任其全部代码。管理器的包大小、路径和语法检查用于诊断和防止意外资源耗尽，不是恶意代码隔离。

网页仍受浏览器权限、同源策略、CORS、CSP 和文件选择授权约束。桌面版渲染进程没有 Node.js、任意磁盘读写或终端接口；模组不能借本协议突破这些边界。远程脚本可能被 CSP 拦截，依赖应打包进模组。网络请求也不因本协议获得额外跨域权限。模组不可假定 `eval`、`new Function`、Node.js `require` 或 npm 裸模块名能运行。

### 1.1. 在线市场与安装计划

内置“Nyamon 模组市场”由 NyamonZone 提供，使用 API 1 的普通模组能力，默认禁用。它增加目录、依赖安装、发布页和更新检查；[使用说明](../assets/mods/rpen-mod-market/README.zh-CN.md)记录网络范围、配置和恢复入口。市场服务协议由服务提供者维护，不属于宿主 API 1 的稳定方法契约。

在线下载与文件导入遵循相同的风险确认规则：依赖和替换包也须分别审阅并主动勾选；整个计划校验与审阅完成前不得写入或停用原有包。默认不执行下载代码；若提供安装后恢复启用，必须单独选择并说明会运行新版本及受影响的依赖者。内置 ID 和市场自身不可由在线包覆盖。

覆盖前应持久化旧包及参数备份，失败时按实际存储恢复，不能先删除旧包的最后一个副本。恢复未完成时保留备份、提供恢复及导出入口，并停止新安装；管理器不能把未恢复的旧版本显示为已经恢复。正常关闭窗口、切换服务及停用产生的 `AbortError` 应由模组处理为取消，其他异常继续遵循宿主错误规则。

浏览、反馈和更新检查应说明联系的服务及提交的数据。更新检查默认限于当前市场来源，其他包由用户手动选择，提交范围为模组 ID、版本和内容哈希。修改服务配置必须取消旧任务、关闭旧连接及清除会话，提示与实际接收地址一致。

## 2. 包结构与清单

导入 `.rpenmod` 或 `.zip`，两者均为 ZIP；也支持选择整个文件夹。根目录需有唯一 `mod.json`，允许 ZIP 最外面多一层目录。文件采用 UTF-8；路径用 `/`，区分大小写，不允许绝对路径、反斜杠、`..`、查询或片段。忽略目录、隐藏文件和 `__MACOSX` 条目。包最多 2048 个文件、解压后 128 MiB、单文件 32 MiB、单 JS 文件 4 MiB。

```text
example/
  mod.json
  main.mjs
  panel.mjs
  style.css
  data.json
  images/icon.svg
```

```json
{
  "protocol": "rpen-mod",
  "api": 1,
  "id": "example-tool",
  "name": "示例工具",
  "version": "1.0.0",
  "author": "作者",
  "description": "工具说明与会修改的行为。",
  "entry": "main.mjs",
  "dependencies": [],
  "conflicts": [],
  "settings": {
    "toggle-key": {"type":"shortcut","label":"开关","default":"F7"},
    "amount": {"type":"number","label":"数量","default":4,"min":1,"max":20,"step":1}
  }
}
```

必填项为 `protocol/api/id/name/version/author/description/entry`。`author`、`description` 可为空。`name`、`author`、`description`，以及设置的 `label`、`description` 和 `select` 选项文本，都可以写成语言映射（`{ "zh-CN": "…", "en-US": "…" }`），管理器按当前界面语言显示；匹配顺序为完整语言标签、同语种、`zh-CN`、映射首项。`id` 和设置键以小写字母开头，只含小写字母、数字、`-`，最长 64 字符。`version` 必须是字符串，用 `1.0.0` 形式，可有 `-beta.1` 或 `+build` 后缀，不接受语言映射。`entry` 为包内 `.mjs` 或 `.js` ES 模块，必须存在。未知清单字段保留但不自动执行，可用 `x-` 前缀保存扩展元数据。

为兼容 API 1，`api.manifest` 中的名称、作者、说明及设置文本始终是按装载时界面语言解析后的字符串，模组可继续拼接或调用字符串方法。`api.manifestSource` 提供保留语言映射的原始清单副本；类型分别见 `ModManifest` 与 `ModManifestSource`。二者均不改写包内 `mod.json` 或导出内容。界面切换语言后重载模组以重新解析。持久化全局事件的来源名称、作者和版本仍为字符串，类型 ID 和设置键不随语言变化。

可选 `homepage` 表示项目主页。可选 `market` 为市场来源元数据：`{"id":"example-tool","api":"https://example.com/mods/api.php"}`；`id` 应与清单 ID 相同，`api` 是对应市场的 HTTP(S) API 地址。内置市场以完整规范化 API 地址匹配默认更新范围，其实际传输通道仍由市场设置指定。这是来源标记，不是签名或授权；缺少该字段的模组仍可正常导入、启用，也可由用户手动选择检查更新。字段不改变谱面格式或 API 版本。

`dependencies`、`conflicts` 为其他模组 ID 的数组，不允许包含自身。依赖先装载，缺失、循环及双方任何一方声明的冲突会阻止装载。禁用依赖也会禁用依赖它的模组。没有依赖关系时按用户启用顺序装载；自动启动按保存的顺序处理。不支持依赖版本范围，作者应在激活时自行检查功能或版本。

设置类型：

| type | 值与约束 | 控件 |
|---|---|---|
| `boolean` | 布尔值 | 勾选框 |
| `number` | 有限数字，必须声明 `min/max`，可选正数 `step` | 数值框 |
| `text` | 字符串，最长 2000 字符 | 文本框 |
| `color` | `#rrggbb` | 取色器 |
| `select` | `options` 的键；`options` 是“值: 显示名”对象 | 下拉框 |
| `shortcut` | 编辑器快捷键语法，例如 `CTRL&SHIFT&G`、`F8`；空串清除 | 按键录入 |

每项必填 `type/label/default`，可填 `description`。最多 100 项。`default` 必须满足同样的值校验。管理器参数变化会立即保存并通知运行中的模组；不要求重启。快捷键修改立即生效，Backspace 清除。

## 3. 激活、多文件导入与卸载

```js
import { createPanel } from './panel.mjs';
import data from './data.json';
import { fromNumber } from '@rpen/core/beat.mjs';

export function activate(api) {
  api.style(api.package.text('style.css'));
  const panel = createPanel(data);
  api.mount(panel);
  api.commands.register({
    id: 'toggle', title: '显示工具', setting: 'toggle-key',
    run() { panel.hidden = !panel.hidden; }
  });
  api.settings.onChange(({key, value}) => api.log(key, value));
  return () => { /* 还原没有通过托管接口注册的资源 */ };
}
```

入口导出 `activate(api)` 或默认函数，允许异步，返回可选清理函数或 `{dispose()}`。顶层代码在装载时执行，导入包时不执行。每次启用获得独立模块命名空间；静态循环导入遵循标准 ES 模块规则。`./`、`../` 可导入包内 JS/JSON，但不能越过包根；JSON 自动作为 `default` 值，无需 `with {type:'json'}`。支持静态导入、再导出及 `import(variable)`。扩展名必写。

`@rpen/api` 导出 `getEditor()`（等同 `api.editor`）、`getModHost()`（等同 `window.rpenMods`）、`apiVersion`；默认导出是 `getEditor`。`@rpen/core/...mjs`、`@rpen/application/...mjs`、`@rpen/platform/...mjs`、`@rpen/ui/...mjs` 导入编辑器真实内部模块，没有模块白名单。内部源码路径与类方法属于进阶接口，可能随编辑器版本变化。请勿导入 `ui/app.mjs` 来创建第二套编辑器。

包模块由 Blob URL 执行。`import.meta.url` 是 Blob 地址，不能据此拼接素材路径；使用 `api.package.url(path)`。`import.meta.resolve(specifier)` 经包解析器返回可供 `import` 使用的模块标识，不保证返回网络 URL。`api.package.import(path)` 可从包根动态导入，`api.importInternal('core/chart.mjs')` 导入编辑器内部模块。第三方依赖应预先打包成浏览器 ES 模块，许可随包附带。

停用按注册的逆序释放监听、定时器、命令、挂载节点、样式、包内 Blob URL、钩子及托管补丁；`api.signal` 同时中止。提前释放的资源不会再次释放。清理函数应立即恢复可见状态；若返回 Promise，仅观察其错误，宿主不等待网络或其他异步清理完成。异步任务应检查 `api.signal.aborted`，避免停用后继续改写编辑器。

直接赋值、移除原 DOM、网络请求、持久化写入以及已提交的谱面修改不会自动撤销。应使用 `api.patch` / `api.dispose` 或保存原值自行恢复。清理不是事务回滚。卸载不会自动撤销用户已经接受的谱面编辑。

## 4. 通用宿主 API

所有注册类方法返回一个可提前调用、幂等的释放函数，除非表中另有说明。

| API | 行为 |
|---|---|
| `version/id/manifest/editor/signal` | 接口版本、模组 ID、清单、编辑器对象、中止信号 |
| `manifestSource` | 保留多语言文本映射的原始清单副本 |
| `dispose(fn)` | 注册额外清理 |
| `listen(target,type,fn,options)` | 托管任意 DOM/EventTarget 监听 |
| `on(type,fn)` | 监听宿主事件；回调直接接收 detail |
| `emit(type,detail)` | 发出 `mod:<本模组id>:<type>`，避免名称冲突 |
| `hook(name,fn,priority=0)` | 同步可修改的语义钩子，见下一节 |
| `onFrame(fn)` | 每帧回调 `{timestamp,elapsed,chartSeconds,musicSeconds,playing}`；时间戳毫秒、其余时间秒 |
| `onPreview(fn,{target:'preview'})` | 预览画完后回调，可选 `realtime` 背景预览；见第 7 节 |
| `patch(target,key,previous=>replacement)` | 包装方法或替换属性，可按任意顺序停用多个补丁，保留仍启用的补丁 |
| `timeout(fn,ms)` / `interval(fn,ms)` | 托管计时器 |
| `mount(node,parent=document.body)` | 插入 DOM 并返回 node，停用时移除 |
| `style(css)` | 加入 CSS 并返回 style 元素，停用时移除；作者自行约束作用范围 |
| `notify(message,level='success')` / `log(...values)` | 通知、带 ID 前缀的控制台日志 |
| `lockEditing(options)` | 临时阻止普通编辑输入和控件，返回恢复函数，支持多模组与嵌套锁 |
| `settings.get(key)` / `await settings.set(key,value)` | 读取 / 校验并保存清单参数 |
| `settings.onChange(fn)` | 回调 `{key,value}` |
| `storage.read(fallback={})` / `write(value)` / `clear()` | 本模组 JSON 存储，独立于谱面；不要保存巨量二进制数据 |
| `package.files()` / `bytes(path)` / `text(path)` | 包内路径数组、字节副本（缺失 null）、UTF-8 文本（缺失空串） |
| `package.url(path,mime?)` | 素材 Blob URL，停用时回收；常见扩展名自动识别 MIME |
| `package.import(path)` / `importInternal(path)` | 异步导入包内 / 编辑器内部模块 |
| `commands.register(definition)` | 注册可在管理器触发、可绑定快捷键的命令 |

命令必填 `id/run`，可填 `title/shortcut/setting/allowInDialog`。`id` 在本模组内唯一；`setting` 指向清单快捷键参数，优先于 `shortcut`。文本输入、输入法组合及按住重复不会触发模组快捷键。对话框中默认不触发，显式 `allowInDialog:true` 才允许。多个模组绑定相同键时后注册者优先；不要抢占紧急恢复键。编辑器被锁时只有持锁模组的快捷命令可用。

`lockEditing({reason,roots?})` 默认锁住编辑工具、原预览交互和面板，保留模组管理器。模组自己的可交互区域标记 `data-mod-interactive="true"` 可绕过输入拦截。它只锁人机编辑输入，不阻止其他模组、后台任务或联机操作；需要独占环境的工具应自行检查联机状态。`roots` 是要设 inert 的 CSS 选择器数组，替换默认列表；高级模组自行负责覆盖范围。代码层的强制语义禁止可使用提交钩子取消操作。

模组命令接管、`input:before` 标记已处理或取得编辑锁时，会取消正在进行的属性名称拖动并释放指针锁定。普通拖动仅在松手时提交一次；预览草稿不触发提交钩子，最终提交仍经过 `session:before-commit`。草稿期间发生其他谱面提交、撤销或切换谱面时，旧草稿不会覆盖新状态。

桌面本地语音输入在可编辑文本框中处理其按住说话键（默认 `TILDE`），先于普通编辑及模组输入钩子，避免录音键穿透；禁用、只读或 `inert` 控件不触发。Shadow DOM 中的标准文本框通过事件路径识别，设置 `data-dictation="off"` 可对特定输入框关闭此入口。识别结果从原选区插入并触发原生 `beforeinput/input`，不自动发送表单；数值框沿用原有数值更新逻辑，原输入内容发生变化时只提供候选结果。这是 API 1 的兼容补充，不授予模组新的麦克风权限。

## 5. 同步语义钩子

钩子按优先级从高到低执行，同优先级按注册先后执行，共享可变 payload。必须同步修改属性，不等待 Promise；异常会被记录，其他钩子继续运行。避免在提交钩子中递归 `commit`。

| 名称 | payload 与控制方式 |
|---|---|
| `input:before` | `{event,handled:false}`；在编辑器普通处理及模组命令之前同步处理键盘、滚轮、指针按下/释放、鼠标按下/释放、点击、拖放、表单事件；设 `handled=true` 阻止默认行为及后续传播。紧急恢复键优先于此钩子，文本输入应主动豁免 |
| `ui:before-relocate` | `{node,parent,anchor,reason,cancel:false}`；皮肤整理或恢复控件位置前触发，reason 为 `skin-organize/skin-restore`。模组暂存或浮动放置了真实控件时可取消移动；恢复皮肤时可将自己的原位置标记移到 anchor 处并移除 anchor，避免与皮肤反复争抢控件 |
| `session:before-commit` | `{session,label,chart,beforeSelection,cancel,normalizeAlpha}`；可替换数据/标签/选择、设 `cancel=true` 取消、`normalizeAlpha=false` 跳过提交时透明度整形 |
| `session:after-commit` | `{session,label,chart}`；本地提交处理完成后，包括联机提交路径；不代表远端已确认 |
| `chart:parse` | `{text,chart:null}`；可先处理文本，设置 truthy `chart` 则直接返回自定义结果，跳过内置解析 |
| `chart:parsed` | `{chart}`；内置解析完成后改写结果；自定义 `chart:parse` 短路时不触发 |
| `chart:validate` | `{chart,handled:false}`；自行检查后设 `handled=true` 跳过内置 assertChart 检查 |
| `chart:serialize` | `{chart,compact,text:null}`；可替换输入；`text!==null` 直接返回字符串并跳过内置校验和整形 |
| `chart:export-assets` | `{chart,chartName,assets,required}`；PEZ 默认排除未使用文件，在依赖遍历前触发。`chart` 已经过兼容转换，`assets` 为待导出文件 Map，`required` 是需保留的包内路径 Set。模组可用 `required.add(path)` 声明自定义结构或序列化器使用的资源，其 JSON、着色器等依赖会继续追踪；勾选导出未使用文件时不需要筛选，也不触发此钩子。自动保存文件仍遵循通用设置 |
| `preview:before` | `{chart,seconds,lineIndex}`；在预览/背景预览绘制前替换渲染数据、谱面秒数和当前线，不修改存档 |

事件取样及属性拖动可以使用临时谱面和循环预览时间，因此预览钩子、`onPreview` 和渲染包装函数应使用回调传入的 `chart/seconds`；它们不一定等于已提交谱面和实际播放头。`onFrame` 的 `chartSeconds/musicSeconds` 仍表示实际播放时间。以上行为沿用 API 1。

原有 RPEN 导出路径有自己的排序、兼容转换和媒体打包流程。`chart:serialize` 对所有调用该函数的路径生效，但不是任意文件格式流水线的万能拦截点。要完全替换导入、保存、兼容导出或预览算法，可以包装相应实例 / 类原型，或者实现自己的按钮及流水线。

```js
export function activate(api) {
  // 为所有未来提交加自定义字段，仍使用编辑器的撤销记录。
  api.hook('session:before-commit', change => {
    change.chart = {...change.chart, 'x-my-mod': {enabled:true}};
  });
  // 实例、类原型均可包装；this、参数和返回值由模组显式保留。
  api.patch(api.editor.timeline, 'draw', previous => function(...args) {
    const result = previous.apply(this, args);
    // 在时间轴追加自己的绘制。
    return result;
  });
}
```

`LineRuntime` 等内部导出必须参照当前源码核对路径和签名。上面的扩展点是示例，宿主没有把可包装的对象限制为这些实例。

自定义格式示例：

```js
import { createChart } from '@rpen/core/chart.mjs';
export function activate(api) {
  api.hook('chart:parse', input => {
    if (!input.text.startsWith('MYCHART\n')) return;
    const chart = createChart();
    chart['x-custom'] = JSON.parse(input.text.slice(8));
    input.chart = chart; // 保留标准骨架，可继续使用现有面板和预览。
  });
  api.hook('chart:serialize', output => {
    if (output.chart['x-custom'])
      output.text = 'MYCHART\n' + JSON.stringify(output.chart['x-custom']);
  });
}
```

可以取消内置校验并使用完全不同的数据结构，但必须同时接管依赖该结构的时间、面板、预览、保存及兼容导出。宿主不会自动让旧编辑器理解未知字段或未知语义。建议用命名空间保留扩展字段，给用户明确的兼容导出策略。

## 6. 编辑器对象

`api.editor` 是有实时 getter 的对象：每次使用时读取当前 session/chart，不要长期缓存进入另一个谱面前的引用。时间单位和坐标必须明确：

- 拍数是 `[整数,分子,分母]`；数值拍数用 `@rpen/core/beat.mjs` 的 `fromNumber/beatValue` 转换。
- `audio.time` / `musicSeconds` 是音乐秒；`chartSeconds()` 是谱面秒，二者关系为 `音乐秒 = 谱面秒 + offsetSeconds()`。`META.offset` 单位毫秒。
- 判定线使用中央原点、X 向右、Y 向上的谱面坐标。预览屏幕像素 Y 向下，线旋转为顺时针正。不要忽略父线、事件层、锚点、缩放、BPM、摄像机与视野比例。

读取属性：`session/chart/tempo/assets/preferences/editorPreferences/chartName/hasDocument/home/activePane/dirty/libraryProject`。`loop` 可读写。`assets` 是路径到字节的 Map；通过 `addAsset/removeAsset` 修改可正确标记未保存。

| 方法 | 用途 |
|---|---|
| `commit(label,chart)` | 按编辑器提交途径产生可撤销修改，传入新对象，不原地改旧历史 |
| `replace(chart,name?)` | 替换当前谱面并建立新编辑上下文；不是普通可撤销编辑 |
| `chartSeconds()/offsetSeconds()/currentBeat()` | 当前谱面时间、延迟秒、数值拍数 |
| `seek(seconds,{music:false,pause:true})` | 默认按谱面秒定位，music=true 按音乐秒；默认暂停 |
| `seekBeat(beat,pause=true)` | 按数值拍数定位 |
| `selectLine(index)` | 选择从 0 开始的线号索引并刷新 |
| `setPreview(visible,{stay:true,autoplay:false})` | 切换预览界面，不隐式播放 |
| `play()/pause()` | 播放（异步）/ 暂停 |
| `beginPreviewSession()` | 暂停并结束正在进行的放置/取样，暂存视图参数，进入全线预览并开启详细碰撞几何；返回幂等恢复函数，恢复时暂停，不回退时间、不改谱面 |
| `activatePane(name)` | 进入右侧页面，例如 `chart/notes/events/lines/noise`，具体名字见 index.html |
| `invalidate()/render()` | 请求重新绘制 / 同步刷新编辑控件 |
| `save()` | 调用现有主动保存流程，返回 Promise；必须 await 并处理写入或版本冲突错误，详见下文 |
| `addAsset(path,bytes)/removeAsset(path)` | 改素材、标未保存、刷新贴图缓存 |

可直接访问实际对象：`audio/audioSources/audioOnsets/audioAnalysis/playback/preview/realtimePreview/timeline/skin/images/hitSounds/editorSkins/noteSkins/noiseEditor/eventSampler/trajectoryPanel/textLinesPanel/noiseFitPanel/noiseTrackingPanel/multiEdit/batchControls/collaboration/versionControl`。它们不是只读快照或受限代理，可以包装方法、调整字段或替换底层行为；具体接口看同名源码。持久设置修改需调用相应的保存流程。`audioOnsets`管理采音算法、模型推理缓存与候选筛选，供原生界面和AI共用；调用`analyze(buffer, options, signal)`不修改谱面，模型环境需由用户配置，不能绕过其安装确认。

音频分析的 `audioSources.select(id或id数组)` 临时切换实际播放与默认分析音源，至少选择一项；`selectedIds` 返回勾选项，`resolveSelection()` 返回其混合。`audio.buffer` 始终保留原音乐，`audio.playbackBuffer` 是当前实际播放缓冲；两者不可混为保存或导出的素材。所有声部共用原音乐零点与谱面延迟，选择不进入谱面历史或设置，退出谱面恢复原音频。波形/频谱按各声部颜色分列显示，`audioOnsets` 默认分析当前混合。

`editor.raw` 提供更底层入口：实时 `session/chart/assets/tempo`、`renderSession/replaceChart/activatePane/togglePlayback/togglePreview/save/applyDisplaySettings/persistEditor/setHome`。`raw.chart=` 直接替换历史当前文档并通知，**不增加撤销记录**；`raw.tempo=` 更新时间轴 TempoMap。其他内部一致性由作者负责，优先使用普通 commit。可以通过任意 DOM/Web API、内部 ES 模块、类原型与这些入口继续扩展，宿主不限制为本节列出的功能。

`editor.directPlacement` 是直接放置面板实例，属于进阶实现接口：`active` 表示是否展开，`open(lineIndex)` 在预览中展开当前线的音符编辑区，`close()` 关闭。它复用原 `editor.timeline` 与音符画布，通过 `timeline.noteView` 映射指针和绘制坐标，临时停用多线编辑，关闭后恢复；扩展交互应调用时间轴的 `point/noteHorizontal/notePositionAt/vertical`，不要直接用旋转后的 DOM 外接矩形换算。音符横坐标不限制在 −675～675。`beginPreviewSession()` 会先关闭直接放置和重合线列表。

`editor.quickCurve` 与 `editor.noteTrackingPanel` 是进阶实现入口。单选音符长按中键进入曲线填充时，数字键和 Q/W/E/R/Esc 由临时交互消费，Shift+中键及短按仍保留框选；生成前只使用临时预览，不增加历史。音符追踪通过 `note_track` 命令或原生临时页面生成普通事件，默认使用当前线和当前事件层，不新增谱面字段。`timeline.noteSpacing` 为持久化横向间距比例，默认 1；扩展拖拽应调用 `horizontalScale/notePositionAt/noteHorizontal`，不要假设可见横坐标固定为 −675～675，也不要用此比例调整贴图大小。`timeline.notesOnlyNoteScale` 为单线仅音符视图的视觉缩放，默认 0.9；`referenceNoteScale` 保持坐标布局基准，实际音符宽高使用 `renderNoteScale`。

右键默认值面板为 `editor.placementDefaultsPanel`。`editor.session.noteDefaults` 仅属于当前编辑会话，退出谱面时重置；`lineEventDefaults` 由编辑器偏好层跨谱面和重启保存。创建物件时可调用 `session.createNote(type, beat, positionX, endBeat?)`、`session.createLine(name?)` 使用这两组默认值，返回物件后仍须正常提交。默认值不写入谱面、不占用撤销历史，也不自动改动导入、复制或已有物件。底层 `core/chart.mjs` 的 `createNote/createLine` 继续返回固定的格式默认值，适合导入和明确控制属性的算法；两组构造入口不要混淆。`ensureLineCount(chart, count, lineEventDefaults?)` 的第三个参数可将同一套默认值用于批量新线。

`editor.diagnostics` 提供后台谱面检查。`await diagnostics.waitBasic()` 等待当前版本的基础结果，`diagnostics.issues` 为基础与已完成深度结果的合并列表，`pending/running/progress/deepComplete` 表示状态；`change` 更新结果，`progress` 只更新进度。常规选择和播放循环不应调用同步整谱 `diagnose()`。`startDeep()` 仅在用户主动请求时调用，再次调用取消；谱面、素材、模组、目标或比例变化使深度结果失效。基础 Worker 使用结构共享的增量补丁，不传输音频/图片内容。

`missingBaseline` 为自动警告，仅检查判定线第 0 层的五个基础事件轨道。轨道没有开始拍不晚于 0 的有效事件时产生一项结果；零拍前已经结束的事件和零拍瞬时标记也能提供初始值。结果通过 `line/layer=0/eventType/path/beat=0` 定位缺失的栏，没有物件 `index`、不可删除；上层事件和扩展轨道不补足第 0 层。检测与轨道常规校验共用遍历及缓存。

全局事件校验读取注册列的 `valueType/min/max/overlap` 和模组来源，缺失模组与来源、版本变化会显示提示。深度检查还在独立 Worker 执行列的 `validate(event)`：应使用可独立执行、不依赖 DOM 或外部闭包的函数，可返回 `false`、错误字符串或抛出错误；支持异步返回。修改返回的谱面副本不会写回编辑器。依赖主线程闭包而无法运行的校验器会明确显示未能独立校验，不会当作检查通过。一般 Shader 重叠和合法瞬时事件仍然允许。深度位置检查复用场景、父线、倍率、视窗比例与内置三维摄像机投影；任意自定义后处理 Shader 的像素扭曲不属于几何位置判断。

放置区使用 `noteView.flow` 将秒数映射为速度积分距离，`noteView.sideAt(y)` 返回上区 1 / 下区 -1；`timeline.timeAt(y, side?)` 反算拍点时间，`timeline.noteVertical(note, endpoint='startTime')` 按音符的 above 和首尾拍计算绘制位置，`vertical(beat,height?,side=1)` 可显式选择区。零速/反向段保留可编辑的单调距离轴；与实际预览有偏差时绘制对应连线，不改谱面数据。`preview.noteOpacity` 只乘音符本体透明度，展开期间为 0.3，退出恢复原值；`preview.noteCenterLine` 与 `preview.noteCenters` 仅收集目标线已绘制音符的中心几何，避免额外遍历全部谱面。以上为进阶实现接口，不增加协议版本。

普通音符与放置面板拖拽时，`editor.timeline.previewNotes()` 提供临时的 `Map<线号, Map<音符索引, 音符>>`（无草稿时为 null），不改已提交谱面或撤销历史。原生预览通过 `preview.noteOverrides`、`preview.noteDraft` 对受影响音符增量绘制，保留其余场景索引；包装原生 `drawScene` 的模组会沿用此效果。完全自行绘制音符的模组需自行读取草稿。松开提交或取消后草稿撤回，谱面格式不变。

### 6.1. 保存、个人设置与平台存储

模组应通过 `api.editor.commit` 修改当前谱面，通过 `addAsset/removeAsset` 更换素材，再用 `await api.editor.save()` 保存。保存不冻结编辑；调用后发生的新修改仍可能处于未保存状态。重复调用会在需要时排队写入更新的快照。`ProjectConflictError` 表示库内项目已被修改或删除，不能通过清空 `storageRevision` 等方式强制覆盖；应保留当前编辑，让用户导出 PEZ 或另存项目。自动保存生成独立恢复副本，不覆盖谱面库项目，没有新修改时不会重复备份。

`api.storage` 用于本模组的个人 JSON 数据，不属于谱面，也不随谱面 JSON/PEZ 或模组包导出。`write/clear` 保持同步调用形式；网页端写入同源本地存储，桌面端先更新内存再排队安全写入原生文件，返回不表示磁盘已写完，`await api.storage.write(...)` 也不产生额外落盘保证。`settings.set` 的 Promise 表示校验与参数更新完成；桌面持久化同样由后台队列处理。后台失败会报告并保留可重试值，正常关闭桌面窗口前会等待设置写入。模组激活、停用及页面重载时，应遵守异步任务清理约定。

桌面端的导入包位于所选谱面库的 `mods`，启用列表、参数和个人数据位于 `preferences`；固定的桌面配置记录库位置，因此同一用户更新或移动程序后自动沿用。切换到另一个库时使用那个库的包与设置，不能假定任意库共享个人数据。网页端、不同同源地址和桌面库相互独立。需要随作品分享的内容应放入有模组命名空间的谱面字段或全局事件，并说明停用及兼容导出策略。

进阶模组可导入 `@rpen/platform/library.mjs`、`recovery.mjs`、`mods.mjs` 等业务接口。这些接口会按运行环境选择后端；不要直接操作固定名称的 IndexedDB、localStorage 键、SQLite 或原生版本文件，否则桌面数据可能不生效，也可能绕过冲突检测、素材引用和恢复逻辑。`libraryProject.id`、`storageRevision` 和素材哈希都是存储标识，不是目录名或可访问的文件路径。桌面“打开谱面所在文件夹”通过主进程解析已保存项目，未提供通用文件系统权限。

### 6.2. 谱面版本控制

谱面版本历史与撤销栈、谱面库保存、自动恢复副本各自独立。完整行为及仓库包约定见[谱面版本控制说明](CHART-VERSION-CONTROL.zh-CN.md)。`editor.versionControl` 是当前版本控制面板实例，属于可包装的进阶实现接口，`await editor.versionControl.open()` 读取当前谱面的版本库；打开可见页面可用 `editor.activatePane('version-control')`。需要数据级操作时可导入 `@rpen/application/chart-vcs.mjs` 的 `ChartRepository` 与 `@rpen/platform/version-store.mjs` 的 `openVersionStore()`，不要绑定某一平台的存储目录或数据库名。这些内部方法不属于 API 1 的稳定方法契约，调用前应确认实例存在并 await 操作。

快照记录当前谱面 JSON、素材和素材文件夹，保留模组命名空间与全局事件来源信息；快照存储使用保留数值的原始 JSON，不调用导出专用的 `chart:serialize` 钩子，读取时经过 `parseChart` 和现有解析、校验钩子。读取旧版本后会重新创建编辑会话，`editor:chart` / `editor:state` 会通知会话和谱面引用变化；模组应重新读取 `editor.session/chart/assets`，不要继续修改旧引用。恢复结果保持未保存，用户需要再保存到谱面库。模组个人设置、启用状态和模组安装包不属于谱面快照。

合并对内置判定线父子关系和根级 shader 所属线进行身份映射，临时身份不写入谱面。未知模组字段按 JSON 三路合并；结构相同不代表自定义语义一定可合并，自定义线号引用、跨事件约束和外部数据不会自动获得语义重映射。模组可通过现有 `chart:validate` 校验合并结果，或包装版本库方法提供自定义合并；不应将格式转换仅放在 `chart:serialize` 中。模组全局事件仍须保留来源信息，停用模组不会删除历史中的扩展数据。本节为 API 1 的兼容补充，不改变现有钩子或升级 API 版本。

## 7. 事件与预览

`api.on` 监听：

| 事件 | detail |
|---|---|
| `editor:state` | `{session,chart,playing,home,pane,lineIndex,dirty,previous}`；每帧比较，变化时发出，首次也发出 |
| `editor:chart` | `{session,chart}`；谱面引用或会话变化，包括撤销/重做 |
| `editor:time` | 与 onFrame 同形，音乐位置变化时发出 |
| `editor:save-started` | `{}`；主动保存开始 |
| `editor:save-succeeded` | `{message}`；完成一个主动保存快照，不保证此刻没有更新的未保存修改 |
| `editor:save-failed` | `{error}` |
| `mod:loaded` | `{id}` |
| `mod:unloaded` | `{id,reason,error?}`，reason 为 `disabled/error` |
| `mod:<id>:<自定义名称>` | 另一个模组用 emit 发送的内容 |

`onFrame` 不受编辑器绘制节流影响，仍受浏览器实际帧回调、隐藏窗口和主线程负载影响。`elapsed` 单位秒，暂停播放时仍会回调。不要在每帧 commit 大谱面。计算密集任务可自己使用 Worker（受 CSP），用 signal 中止。

`onPreview` 回调 `{renderer,target,chart,tempo,seconds,timestamp}`，发生在判定线、音符、UI、噪域及 shader 画完后。可以操作 renderer.canvas，或挂一个独立 canvas/DOM 覆盖层；自己 save/restore 画布状态，并考虑设备像素比。`renderer.viewport` 是 CSS 像素的可视画面矩形；`viewScale` 将谱面坐标换为 CSS 像素。视口中心与整个居中画布中心一致，但鼠标要减去 canvas 的 getBoundingClientRect 原点。

详细碰撞几何是可选的，`renderer.collisionGeometry=true` 才生成额外数据；普通编辑保持关闭。`noteHitAreas` 含线号/音符索引、头尾屏幕坐标，开启后普通音符带 polygon、collisionWidth/collisionHeight/rotation，Hold 用头尾线段和宽度形成身体。几何在绘制坐标系内、单位 CSS 像素，不含 shader 扭曲后的像素变形。`renderer.noisePreview.hitEntries` 提供当前可见层的噪域世界四边形、area、state；state 为 `active/ready/disabled`，world 点仍需中心平移、Y 翻转及 viewScale。不同噪域层独立合成，反转规则要与核心一致；直接把四边形当独立实心块会误判洞。

`editor.skin.noteScale(highlight)` 返回当前资源包普通 / 高亮音符的贴图尺寸倍率；默认皮肤为 1。自定义点击范围或剔除边界时应计入此倍率；`skin.head` / `skin.hold` 绘制时会内部应用倍率，传入绘制宽度时不应再次相乘。

密集音符可由编辑器批量提交绘制，仍保留逐个音符的取样与碰撞信息，以及原有的绘制顺序、透明度、头尾和图集参数。内置绘制器通过 `skin.noteBatchCompatible` 表明可批量绘制；覆盖 `head` / `hold` 的模组和使用重复 Hold 身体的皮肤自动沿用原 Canvas 路径。模组不得仅为启用优化而把自定义绘制器声明为兼容；批量上下文只实现标准音符绘制所需的图片、矩形和矩阵操作。设备不支持或批次失败时会重新用原路径绘制当前批次。

进阶绘制接口中，`LineRuntime.noteState` 的 `size` 为宽度倍率，`sizeY` 为不含音符自身 `size` 的高度倍率；尺寸控制曲线仍作用于两轴。`RpeSkin.head` 在既有 `minimumHeight` 后可接 `heightWidth`，`hold` 在 `color` 后可接 `heightWidth`，表示计算贴图高度的基准宽度，省略时沿用传入宽度以保持旧调用兼容。`hold` 在 `heightWidth` 后还可接 `zeroDirection`（默认 `1`），仅在首尾坐标相等时决定头尾贴图的朝向；预览自绘应按音符原始上下侧传入，上方为 `1`，下方为 `-1`，避免零长度 Hold 的两侧尾贴图重叠。模组自绘或生成碰撞框时应使用两轴各自的倍率。判定线 `anchor` 是左下原点的归一化纹理锚点，图片和文本共用；线坐标及音符判定位置不因它移动。`bpmfactor` 文件语义仍为拍时倍率，面板的“BPM 倍率”显示其倒数，读取谱面时不可再把字段倒置一次。

## 8. 示例、恢复与兼容

性能监控默认通过 F10 开关，可在快捷键设置中修改。关闭时不启动采样定时器或桌面硬件工作线程；开启后只记录实际编辑器绘制帧，按低频率更新图表与硬件指标。网页端不具备系统 CPU/GPU 查询权限，不可用指标显示 `—`；桌面端 CPU、应用内存与系统内存由原生接口提供，NVIDIA 驱动工具可用时优先读取 NVIDIA GPU/显存，其他 Windows 设备使用系统性能计数器（GPU 取最忙引擎）；这些硬件读数不代表仅编辑器的用量。应用 CPU 以整机逻辑处理器总容量为 100%。测试从音频零秒开始，保持当前播放倍率和预览设置，暂时跳过循环区间；停止、退出预览、切换谱面或隐藏窗口时均保留截至当时的统计。模组正常的预览绘制钩子仍参与测试，监控不改变谱面数据。

内置“星航 · 谱面躲避”展示预览覆层、快捷键、临时编辑锁、几何碰撞、音效、成绩存储及完整恢复；“像素矿工”展示控件移动、布局恢复、动画与音效；“三维摄像机”展示全局事件、透视渲染和三维交互；“Nyamon 模组市场”展示网络请求、安装审阅、取消与恢复副本。它们都是普通 `mod.json + ES module` 包，使用同一加载器，可导出查看和派生。

内置“像素矿工”展示提前输入拦截、真实控件的暂存/放置、九格物品栏、掉落与经验动画以及恢复。默认 F9 开关工具状态，Ctrl+Shift+F9 恢复全部；1–9 选栏位，文本框输入和滚轮保留原行为。关工具状态保留挖掘结果，停用模组才全部恢复。经验球先受重力落地，停留半秒后飞向鼠标；控件掉落物使用方形边框。控件暂存期间会拦截皮肤重新整理，面板按同一 ID 或同一表单语义字段重建控件时更新持有的真实控件，避免自动补回。控件状态仅在本次页面有效；没有稳定标识的自定义控件，或切换谱面后含义变化的控件，应恢复后重新操作。与星航声明冲突，避免同时接管输入。

星航默认 F8，可在管理器修改：从当前音乐位置开始；关闭介绍后鼠标进入画面才播放。音符和 Hold 身体为障碍；**仅 active 噪域参与碰撞，ready/disabled 均不参与**。各噪域层分别处理普通覆盖及反转。五颗心，受击无敌，移出暂停、移回扣心；星星、连击、随机修复补给和结算均由模组实现。关闭或停用恢复原界面并暂停，不写入谱面。

托管回调第一次错误会通知，累计 5 次会停用该模组及依赖它的模组，保留错误说明；可修正后手动启用。不要把异常捕获视为隔离：同步死循环无法被页面自己的计时器或热键打断。

恢复途径：

1. 管理器中禁用单个或全部模组；运行中仍可打开管理器。
2. `Ctrl+Alt+Shift+F11` 紧急禁用全部；只恢复托管资源。
3. 重载地址末尾加 `?mods=off`（已有查询时用 `&mods=off`）本次不装载模组，再到管理器排查。桌面版可从开发者控制台执行 `location.search='?mods=off'` 后重载。
4. 如果上次在激活途中被关闭，下次会跳过自动装载并提示。严重死循环需先关闭窗口，再以恢复地址启动；桌面启动可用 `--mods-off`。

API 1 的托管方法、清单和钩子是稳定契约；新增可选字段与钩子可兼容加入。对内部类、DOM 结构和 raw 流程的依赖需要随编辑器版本验证。API 不兼容时宿主拒绝装载，不悄悄执行。模组作者应注明测试的编辑器版本、是否改变格式/语义、与联机的兼容性以及停用后需不需要重载。协议没有模组签名、网络权限白名单或进程级隔离；内置市场仍执行本节的信任与恢复规则。

## 9. 制作与测试

### 全局事件扩展

`api.globalEvents.register(definition)` 可向原生全局事件工作区注册多种事件，每种允许多列、指定列宽、自定义 JSON 值、校验、绘制、属性控件和快捷数值操作。`list/read/replace/open` 提供查询、事务编辑和打开页面；停用注销实现并保留谱面数据。**持久化模组全局事件必须在谱面中声明来源模组 id、名称、作者、版本；推荐用“模组名 + 作者名”命名类型。** 托管接口自动从清单写入来源，自行修改原始结构时也必须遵守。

详细格式、示例和生命周期见 [全局事件协议](GLOBAL-EVENTS-PROTOCOL.zh-CN.md)，类型声明见 `schemas/mod-api-v1.d.ts`。全局事件不绑定当前判定线，实际语义仍由提供方通过通用模组接口扩展。

内置“三维摄像机”用七列数值事件驱动透视相机，包含专属属性控件、拖拽取样、实时过渡助手和七列原子事务；[完整说明](../assets/mods/spatial-camera/README.zh-CN.md)记录坐标、求值及序列化约定。它通过 `api.patch` 扩展两个 `Preview` 实例的 `drawScene(context, chart, tempo, seconds, selectedLine, frame)`：该独立世界绘制阶段位于背景之后、第一层 shader 之前，frame 含 width/height/viewport/scale/divisor/states。可选 center 为捕获窗口世界中心，默认 (0,0)。噪域的 `transformGeometry(entry, frame)` 在状态求值后、各层合成前变换点集，frame 含 width/height/scale/viewport/seconds，返回 null 可裁掉几何。两者均属进阶实现接口，模组应托管恢复补丁，保持“谱面物件 → 第一层 shader → 游戏 UI → 噪域 → 第二层 shader”的原有顺序；不要在几何变换中改写激活或反转语义。

在项目目录执行 `node tools/pack-mod.mjs <模组目录> [输出.rpenmod]`，会校验清单和 JS 语法并打包。也可将文件直接 ZIP 打包；不要含用户谱面、密钥、开发日志或 node_modules。测试时使用备份谱面和独立浏览器或桌面数据目录；桌面测试还应使用独立的谱面库，不能只更换程序文件夹就假定数据隔离。

`Preview.drawBackground`、`Preview.drawUi` 使用同样的绘制阶段签名，分别位于背景阶段及第一层 shader 后的游戏 UI 阶段。前者支持 center 捕获窗口偏移；后者使用 frame.viewport 定义 UI 的逻辑布局范围，并依赖 frame.states。三维摄像机的“跟随谱面”选项组合这两个可恢复补丁，让背景图片和游戏 UI 参与投影，同时保留它们在 shader 与噪域前后的顺序。

发布前至少验证：导入后不执行、启用及再次启用、修改快捷键、文本输入不穿透、切换谱面、撤销/重做、禁用时清理、依赖/冲突和异常恢复；自定义数据还须验证保存、重开、Next 导出及兼容导出的行为。支持桌面端的模组还应验证更新后设置继承、切换谱面库、大素材保存、冲突或写入失败时保留编辑。替换素材优先提交新的字节数组；保存仍会重新校验可变数组内容，不以对象引用相同作为素材未变化的保证。高自由度来自同页执行能力，可靠性来自模组作者对状态与恢复的完整管理。

编辑器更新入口位于设置的“关于”，更新包的选择、下载、校验与程序替换由宿主负责，没有新增模组安装权限。模组应将用户数据保存至既有谱面、设置或工作区接口，不要写入程序安装目录，也不要依赖安装目录保持不变；宿主重启更新沿用正常的保存、设置写入与关闭流程。
