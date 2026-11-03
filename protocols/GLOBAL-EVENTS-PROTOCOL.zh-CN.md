# RPEN 全局事件协议 v1

全局事件不属于判定线，不受当前线、事件层、判定线 BPM 倍率或多线模式影响。时间使用谱面 BPM 表和 `[整数, 分子, 正分母]` 拍数，谱面延迟沿用正常播放规则。宿主提供注册、时间轴、密度总览、属性编辑、事务和存储，各事件的实际播放语义由提供方定义。

## 1. 页面和交互

“谱面工具 → 全局事件”打开非常驻总览页，左侧进入全局事件模式，没有新增常驻标签。总览逐类显示名称、来源、事件数、列数和横向全曲密度条。密度按事件覆盖时间统计，同类型多列合并，可点击定位。

只选中一个事件时打开独立属性页，属性页不包含种类列表和密度条，可返回总览。选中多个事件时显示总览，暂不提供右侧批量属性编辑。总览和属性页分开实现。切换其他右侧页面可保留左侧工作区；总览、属性页中的“关闭全局事件编辑”或工具栏“× 全局事件”均可退出编辑模式。

一类事件可以有多列。同类连续排列，不同类间隔 18 CSS 像素。默认列宽等于普通“音符＋事件”视图的一列事件，不随全局列数拉伸；窗口尺寸变化时跟随普通编辑区基准。页面不提供调宽控件；注册项的 `column.width` 优先于 `type.width`，可指定 24–2048 CSS 像素。横线、竖线和底部判定线仅绘制在事件栏范围，每栏左右有细边界，间隔及末列以外保持空白。列多时可拖动空白处横向浏览或使用横向滚动条。

支持 Q/R 两次放置、Q 钩定、拖动事件平移和首尾缩放、Ctrl 多选、Shift/中键框选、复制/剪切/粘贴、删除、撤销/重做、滚轮调时间。空白拖动用于横向浏览，不进行划线多选。多选仍可进行时间轴拖拽、删除等操作。文本框保留原生快捷键；有效数值、拍数和文字输入时即应用，保留当前输入字符串和光标，不要求按回车，暂未完整输入的内容不会写入。默认数值列 A 取反首尾，S 把尾值设为首值，列可自行改写。音符工具、多线切换等没有全局事件含义的操作不执行。

内置 `rpen/placeholder` 只测试编辑，不产生效果。其数据仅存当前会话，可撤销重做，不影响谱面或未保存状态，不写入导出文件；重新打开谱面清空。

## 2. 注册、来源和命名

Mod API 1 新增 `api.globalEvents`。注册自动归属当前模组，返回注销函数，停用也会自动注销实现。

```js
export function activate(api) {
  api.globalEvents.register({
    id: 'wind',
    name: `${api.manifest.name} · ${api.manifest.author}`,
    description: '由模组解释的二维风场',
    columns: [
      { id: 'x', name: 'X', valueType: 'number', defaultValue: 0 },
      { id: 'y', name: 'Y', valueType: 'number', defaultValue: 0, width: 120 },
      { id: 'mode', name: '模式', valueType: 'text', defaultValue: 'calm' }
    ]
  });
}
```

宿主构成 `<模组 id>/<类型本地 id>`；内置使用 `rpen/<类型本地 id>`。类型本地 ID 和列 ID 以小写字母开头，随后允许小写字母、数字、点、下划线、连字符，最长 96 字符。显示名可以改，稳定 ID 变更须由提供方迁移数据。禁止重复注册。

**模组新增的持久化全局事件必须在谱面中标识来源模组 id、name、author、version；推荐用“模组名 + 作者名”命名类型。** 托管接口从清单自动写入来源，模组不得伪造来源；直接修改原始谱面或替换导出机制时也必须遵守这一要求。

## 3. 定义接口

类型必需 `id`、`name`、非空 `columns`。可选 `description`、`width`、`persistent`（默认 true）、`validate(event,column)`、`inspector(context)`。

每列必需 `id`、`name`，可选项如下。

| 字段 | 含义 |
|---|---|
| valueType | number（默认）、text、boolean、color、json |
| defaultValue | 默认依次为 0、空字符串、false、[255,255,255]、null |
| min/max/step | 数值约束及步长，step 大于 0 |
| width | 固定 CSS 像素列宽，覆盖类型 width |
| timelineLabel | 可选时间轴短标题，避免完整类型名在窄列中被压缩；总览及属性页仍显示完整名称 |
| overlap | 默认 false，新建放置是否允许区间重叠 |
| create(context) | 最终放置时补充事件数据，返回事件或 null 取消；虚影每帧绘制不执行 |
| validate(event) | 同步校验，返回 false、错误文字或抛错拒绝提交 |
| formatValue(value) | 时间轴首尾值的文字 |
| draw(context) | 在事件条上附加绘制，已裁剪并 save/restore 画布状态 |
| inspector(context) | 添加专属属性控件，可返回清理函数；覆盖类型 inspector |
| shortcut({action,event}) | NumberMirror/NumberFill 操作，返回新事件或 null 保持不变 |

数值必须有限；颜色为三个 0–255 数的 RGB 数组；json 和额外字段可为任意可保存的 JSON 数据，不能包含函数、DOM、循环引用、NaN、Infinity 等。`overlap` 负责新建检查，拖拽及属性编辑与普通事件一致；需要更严格约束的提供方可在事务提交前检查整列。

```js
// create(context)
{ event, previous, type, column }
// draw(context)：rectangle 为 CSS 像素，context 已处理设备像素比
{ context, rectangle, event, selected, tempo, seconds, timeline, type, column }
// inspector(context)
{ container, event, entries, type, column, update, editor, document }
```

属性控件仅在单选时创建，调用 `update((event, entry) => nextEvent, label?)` 提交不可变事务，可撤销重做；`entry` 含 type、column、key、events，表示当前列。传入的 event/entries 是副本，entries 仅含一个选中事件；多选不创建属性控件，update 也不会执行右侧批量修改。返回的清理函数在属性页重建、退出或重置时执行。默认属性页提供首尾拍、值、钩定、缓动与图示、缓动范围、绑定组、Bezier 和完整 JSON 编辑。

这些接口没有把事件限定为数值缓动：可增加任意数据、专属控件和绘制。更深的界面、交互、求值和语义仍可组合通用 `api.patch`、`api.hook`、`api.onFrame`、`api.onPreview` 和 `api.editor`。注册、校验、绘制及属性回调是同步函数，校验不得修改原对象。

## 4. 读写和生命周期

```js
api.globalEvents.open();
const types = api.globalEvents.list();
const copied = api.globalEvents.read('wind', 'x');
api.globalEvents.replace('wind', 'x', [
  { startTime: [4,0,1], endTime: [8,0,1], start: 0, end: 12,
    easingType: 1, custom: { mode: 'gust' } }
], '修改全局风场');
```

list 返回类型、来源、持久化/只读状态和列摘要。read 返回深复制，支持本地或完整 ID，完整 ID 可读取其他提供方的列。replace 只修改本模组命名空间，自动标注来源，一次写入谱面历史并更新未保存状态；失败不部分提交。

停用模组只注销实现，**不删除事件数据**。总览和时间轴保留未加载类型，只读展示，保存时完整保留未知字段；重新启用后恢复编辑。提供方变更 schema 或减少列时必须自行迁移旧数据，重新注册不能抹掉未识别数据。

全局事件数据属于谱面，随谱面库保存、恢复副本和 Next JSON/PEZ 保留；模组包、是否启用及其个人设置是独立数据，不随谱面一起安装。网页端与桌面端共用这些业务规则，模组不应依赖 IndexedDB 名称或原生文件路径，参见[模组协议的存储约定](MOD-PROTOCOL.zh-CN.md#61-保存个人设置与平台存储)。

persistent:false 与占位一样仅存本次会话，不应承载需要保存的内容。联机中临时数据仅属本机；持久化数据走现有事务同步。目前全局数据以整个类型对象为冲突粒度，不提供逐事件协作锁，提供方需注明其联机策略。

大列的 read 深复制有成本，播放求值应缓存轨道，在谱面引用变化时重建；不要每帧 commit 谱面。内置后续类型可使用同一 registry/document 接口，无需接入判定线事件数组。

内置“三维摄像机”提供位置 X/Y/Z、偏航/俯仰/画面倾斜及视角七列，展示全局事件驱动的透视渲染、自定义属性控件、拖拽草稿和跨列原子生成。坐标、求值和文件约定见 [模组说明](../assets/mods/spatial-camera/README.zh-CN.md)。

## 5. 谱面结构和导出

仅实际写入持久化事件时新增 globalEvents，版本为 1；包含它的 Next 文件 META.RPEVersion 至少为 240，旧谱面不因此改变。可选 width 可写入类型或列元数据，供未加载类型展示。

```json
{
  "globalEvents": {
    "version": 1,
    "types": {
      "example/wind": {
        "name": "Wind · Writer",
        "source": { "kind": "mod", "id": "example", "name": "Wind", "author": "Writer", "version": "1.0.0" },
        "columns": {
          "x": {
            "name": "X", "valueType": "number",
            "events": [{ "startTime": [4,0,1], "endTime": [8,0,1], "start": 0, "end": 12, "easingType": 1 }]
          }
        }
      }
    }
  }
}
```

内置来源为 kind:builtin,id:rpen,name:RPE Next；模组来源必须完整并匹配命名空间。事件必需首尾拍数和 start/end，结束拍不早于开始拍。缓动沿用 1–29、easingLeft/easingRight/bezier/bezierPoints，其他字段由提供方约定。

Next JSON/PEZ 按每列开始拍稳定排序，保留全部属性。原 RPE 导出须明确勾选在副本中移除全局事件，不能无提示丢弃；原谱不变。占位不保存，所以不触发此提示。

谱面仅保存 JSON 和来源，不包含可执行模组代码；载入谱面不会因来源信息自动下载、导入或启用模组。完整类型声明见 schemas/mod-api-v1.d.ts。

全局事件的 customEasing 与普通、扩展、噪域共用自定义动画曲线 v1；持久化数据包含完整快照，格式版本至少 250，详见 ANIMATION-CURVES-PROTOCOL.zh-CN.md。未知提供方保持只读；RPE 仍需明确移除全局事件。
