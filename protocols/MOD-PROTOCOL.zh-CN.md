# RPEN 模组协议与开发指南 · API 1

本协议定义可执行的编辑器扩展。模组可以修改界面、交互、渲染、编辑语义、谱面数据、导入导出和存储流程，也可以实现独立工具或游戏。内置示例不构成能力白名单。编辑器皮肤和音符皮肤属于各自的数据协议；模组可以调用、扩展或替换它们的实现。

机器可读清单见 `schemas/mod-v1.schema.json`，接口声明见 `schemas/mod-api-v1.d.ts`。API 1 从当前开发版本提供。`api.version` 是模组宿主接口版本，`mod.json.version` 是模组自己的版本，与谱面的 `RPEVersion` 相互独立。

## 1. 权限与用户流程

右上角“模组”打开独立管理器，可查看包内源码、启停、配置快捷键与参数、恢复默认参数、导入、导出和删除。右下角显示实际已装载数量。首次使用没有自动启用的模组；用户启用过的模组会在下次启动时自动装载。删除外部模组会清除其参数和专属存储。内置模组可以禁用、配置及导出，但不能删除或被同 ID 外部包覆盖。

外部包在解析和语法检查后、保存和执行前必须经过风险说明与主动勾选确认。确认导入后仍处于禁用状态。替换已有包再次显示风险提示，并停用原版本。风险提示说明完整编辑器权限、未知影响、作者免责，以及可信来源、源码或 AI 检查和备份建议；检查并非安全保证。

**模组与编辑器在同一个 JavaScript 页面运行，没有模组权限沙箱。** 它可以访问页面 DOM、当前编辑器存储中的谱面与设置，执行网络请求，调用宿主公开对象、导入内部模块和改写原型。网页端访问限于同源存储；桌面端也可通过编辑器的存储接口读取、修改或删除所选原生谱面库中的数据。启用意味着信任其全部代码。管理器的包大小、路径和语法检查用于诊断和防止意外资源耗尽，不是恶意代码隔离。

网页仍受浏览器权限、同源策略、CORS、CSP 和文件选择授权约束。桌面版渲染进程没有 Node.js、任意磁盘读写或终端接口；模组不能借本协议突破这些边界。远程脚本可能被 CSP 拦截，依赖应打包进模组。网络请求也不因本协议获得额外跨域权限。模组不可假定 `eval`、`new Function`、Node.js `require` 或 npm 裸模块名能运行。

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

必填项为 `protocol/api/id/name/version/author/description/entry`。`author`、`description` 可为空。`name`、`version`、`author`、`description`，以及设置的 `label`、`description` 和 `select` 选项文本，都可以写成语言映射（`{ "zh-CN": "…", "en-US": "…" }`），管理器按当前界面语言显示，缺失语言回退到 `zh-CN`。`id` 和设置键以小写字母开头，只含小写字母、数字、`-`，最长 64 字符。`version` 用 `1.0.0` 形式，可有 `-beta.1` 或 `+build` 后缀。`entry` 为包内 `.mjs` 或 `.js` ES 模块，必须存在。未知清单字段保留但不自动执行，可用 `x-` 前缀保存扩展元数据。

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

可直接访问实际对象：`audio/playback/preview/realtimePreview/timeline/skin/images/hitSounds/editorSkins/noteSkins/noiseEditor/eventSampler/trajectoryPanel/textLinesPanel/noiseFitPanel/noiseTrackingPanel/multiEdit/batchControls/collaboration/versionControl`。它们不是只读快照或受限代理，可以包装方法、调整字段或替换底层行为；具体接口看同名源码。持久设置修改需调用相应的保存流程。

`editor.raw` 提供更底层入口：实时 `session/chart/assets/tempo`、`renderSession/replaceChart/activatePane/togglePlayback/togglePreview/save/applyDisplaySettings/persistEditor/setHome`。`raw.chart=` 直接替换历史当前文档并通知，**不增加撤销记录**；`raw.tempo=` 更新时间轴 TempoMap。其他内部一致性由作者负责，优先使用普通 commit。可以通过任意 DOM/Web API、内部 ES 模块、类原型与这些入口继续扩展，宿主不限制为本节列出的功能。

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

进阶绘制接口中，`LineRuntime.noteState` 的 `size` 为宽度倍率，`sizeY` 为不含音符自身 `size` 的高度倍率；尺寸控制曲线仍作用于两轴。`RpeSkin.head` 在既有 `minimumHeight` 后可接 `heightWidth`，`hold` 在 `color` 后可接 `heightWidth`，表示计算贴图高度的基准宽度，省略时沿用传入宽度以保持旧调用兼容。模组自绘或生成碰撞框时应使用两轴各自的倍率。判定线 `anchor` 是左下原点的归一化纹理锚点，图片和文本共用；线坐标及音符判定位置不因它移动。`bpmfactor` 文件语义仍为拍时倍率，面板的“BPM 倍率”显示其倒数，读取谱面时不可再把字段倒置一次。

## 8. 示例、恢复与兼容

内置“星航 · 谱面躲避”展示预览覆层、快捷键、临时编辑锁、几何碰撞、音效、成绩存储及完整恢复；“像素矿工”展示控件移动、布局恢复、动画与音效；“三维摄像机”展示全局事件、透视渲染和三维交互。它们都是普通 `mod.json + ES module` 包，使用同一加载器，可导出查看和派生，不拥有专有游戏接口。

内置“像素矿工”展示提前输入拦截、真实控件的暂存/放置、九格物品栏、掉落与经验动画以及恢复。默认 F9 开关工具状态，Ctrl+Shift+F9 恢复全部；1–9 选栏位，文本框输入和滚轮保留原行为。关工具状态保留挖掘结果，停用模组才全部恢复。经验球先受重力落地，停留半秒后飞向鼠标；控件掉落物使用方形边框。控件暂存期间会拦截皮肤重新整理，面板按同一 ID 或同一表单语义字段重建控件时更新持有的真实控件，避免自动补回。控件状态仅在本次页面有效；没有稳定标识的自定义控件，或切换谱面后含义变化的控件，应恢复后重新操作。与星航声明冲突，避免同时接管输入。

星航默认 F8，可在管理器修改：从当前音乐位置开始；关闭介绍后鼠标进入画面才播放。音符和 Hold 身体为障碍；**仅 active 噪域参与碰撞，ready/disabled 均不参与**。各噪域层分别处理普通覆盖及反转。五颗心，受击无敌，移出暂停、移回扣心；星星、连击、随机修复补给和结算均由模组实现。关闭或停用恢复原界面并暂停，不写入谱面。

托管回调第一次错误会通知，累计 5 次会停用该模组及依赖它的模组，保留错误说明；可修正后手动启用。不要把异常捕获视为隔离：同步死循环无法被页面自己的计时器或热键打断。

恢复途径：

1. 管理器中禁用单个或全部模组；运行中仍可打开管理器。
2. `Ctrl+Alt+Shift+F11` 紧急禁用全部；只恢复托管资源。
3. 重载地址末尾加 `?mods=off`（已有查询时用 `&mods=off`）本次不装载模组，再到管理器排查。桌面版可从开发者控制台执行 `location.search='?mods=off'` 后重载。
4. 如果上次在激活途中被关闭，下次会跳过自动装载并提示。严重死循环需先关闭窗口，再以恢复地址启动；桌面启动可用 `--mods-off`。

API 1 的托管方法、清单和钩子是稳定契约；新增可选字段与钩子可兼容加入。对内部类、DOM 结构和 raw 流程的依赖需要随编辑器版本验证。API 不兼容时宿主拒绝装载，不悄悄执行。模组作者应注明测试的编辑器版本、是否改变格式/语义、与联机的兼容性以及停用后需不需要重载。协议没有模组签名、在线市场、网络权限白名单或进程级隔离。

## 9. 制作与测试

### 全局事件扩展

`api.globalEvents.register(definition)` 可向原生全局事件工作区注册多种事件，每种允许多列、指定列宽、自定义 JSON 值、校验、绘制、属性控件和快捷数值操作。`list/read/replace/open` 提供查询、事务编辑和打开页面；停用注销实现并保留谱面数据。**持久化模组全局事件必须在谱面中声明来源模组 id、名称、作者、版本；推荐用“模组名 + 作者名”命名类型。** 托管接口自动从清单写入来源，自行修改原始结构时也必须遵守。

详细格式、示例和生命周期见 [全局事件协议](GLOBAL-EVENTS-PROTOCOL.zh-CN.md)，类型声明见 `schemas/mod-api-v1.d.ts`。全局事件不绑定当前判定线，实际语义仍由提供方通过通用模组接口扩展。

内置“三维摄像机”用七列数值事件驱动透视相机，包含专属属性控件、拖拽取样、实时过渡助手和七列原子事务；[完整说明](../assets/mods/spatial-camera/README.zh-CN.md)记录坐标、求值及序列化约定。它通过 `api.patch` 扩展两个 `Preview` 实例的 `drawScene(context, chart, tempo, seconds, selectedLine, frame)`：该独立世界绘制阶段位于背景之后、第一层 shader 之前，frame 含 width/height/viewport/scale/divisor/states。可选 center 为捕获窗口世界中心，默认 (0,0)。噪域的 `transformGeometry(entry, frame)` 在状态求值后、各层合成前变换点集，frame 含 width/height/scale/viewport/seconds，返回 null 可裁掉几何。两者均属进阶实现接口，模组应托管恢复补丁，保持“谱面物件 → 第一层 shader → 游戏 UI → 噪域 → 第二层 shader”的原有顺序；不要在几何变换中改写激活或反转语义。

在项目目录执行 `node tools/pack-mod.mjs <模组目录> [输出.rpenmod]`，会校验清单和 JS 语法并打包。也可将文件直接 ZIP 打包；不要含用户谱面、密钥、开发日志或 node_modules。测试时使用备份谱面和独立浏览器或桌面数据目录；桌面测试还应使用独立的谱面库，不能只更换程序文件夹就假定数据隔离。

`Preview.drawBackground`、`Preview.drawUi` 使用同样的绘制阶段签名，分别位于背景阶段及第一层 shader 后的游戏 UI 阶段。前者支持 center 捕获窗口偏移；后者使用 frame.viewport 定义 UI 的逻辑布局范围，并依赖 frame.states。三维摄像机的“跟随谱面”选项组合这两个可恢复补丁，让背景图片和游戏 UI 参与投影，同时保留它们在 shader 与噪域前后的顺序。

发布前至少验证：导入后不执行、启用及再次启用、修改快捷键、文本输入不穿透、切换谱面、撤销/重做、禁用时清理、依赖/冲突和异常恢复；自定义数据还须验证保存、重开、Next 导出及兼容导出的行为。支持桌面端的模组还应验证更新后设置继承、切换谱面库、大素材保存、冲突或写入失败时保留编辑。替换素材优先提交新的字节数组；保存仍会重新校验可变数组内容，不以对象引用相同作为素材未变化的保证。高自由度来自同页执行能力，可靠性来自模组作者对状态与恢复的完整管理。
