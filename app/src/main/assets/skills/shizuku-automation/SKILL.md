---
name: shizuku-automation
description: "UIAutomator2 JSON-RPC 透传接口（仅函数签名 + 一句说明）。"
---

# UIAutomator2 接口说明

本文档只保留函数签名，并给出每个接口的一句说明。Skill 层只负责透传，不做业务封装。

## 调用方式（本地端口）

- `GET http://127.0.0.1:9008/ping`
- `POST http://127.0.0.1:9008/jsonrpc/0`

## Selector 类型说明（重点）

`Selector` 在协议里是 JSON 对象，不是字符串。类型：`com.wetest.uia2.stub.Selector`。

对应 JSON 结构（可选字段）：

```json
{
  "text": "确定",
  "textContains": "确",
  "textStartsWith": "确",
  "textMatches": "确定.*",
  "description": "确定按钮",
  "descriptionContains": "确定",
  "descriptionMatches": ".*确定.*",
  "descriptionStartsWith": "确",
  "className": "android.widget.Button",
  "classNameMatches": "android\\.widget\\..*",
  "packageName": "com.example",
  "packageNameMatches": "com\\.example.*",
  "resourceId": "com.example:id/btn_ok",
  "resourceIdMatches": ".*:id/btn_.*",
  "index": 0,
  "instance": 0,
  "checkable": false,
  "checked": false,
  "clickable": true,
  "longClickable": false,
  "scrollable": false,
  "enabled": true,
  "focused": false,
  "focusable": true,
  "selected": false,
  "mask": 7,
  "childOrSibling": ["child", "sibling"],
  "childOrSiblingSelector": [{}, {}]
}
```

字段作用说明：
- `text/textContains/textMatches/textStartsWith`：文本匹配条件，`textMatches` 支持正则。
- `description/descriptionContains/descriptionMatches/descriptionStartsWith`：content-desc 匹配条件。
- `className/classNameMatches`：控件类名。
- `packageName/packageNameMatches`：包名。
- `resourceId/resourceIdMatches`：资源 ID。
- `index`：同级序号。
- `instance`：同类同名控件实例序号。
- `checkable/checked/clickable/longClickable/scrollable/enabled/focused/focusable/selected`：布尔属性。
- `childOrSibling`：字符串数组，值为 `child` 或 `sibling`，用于关系链。
- `childOrSiblingSelector`：与 `childOrSibling` 一一对应的子 selector 数组。
- `mask`：`long`，控制哪些条件生效；未标记时服务端会忽略属性。

内部适配说明：
- 服务端可能把 `Selector` 映射成 `UiSelector`（旧版 API）或 `BySelector`（UiAutomator2 新 API）。
- `checkBySelectorNull()` 会导致带 `index/instance` 或特殊组合时回退到 `UiSelector`。
- `deepSelector()` 支持 `childOrSibling` 链，按链条逐级转换。

## 接口清单

## 1. 连接与状态

- `String ping()`：检测服务是否可用。
- `void sleep()` throws `RemoteException`：让设备休眠。
- `void wakeUp()` throws `RemoteException`：唤醒设备。
- `boolean isScreenOn()` throws `RemoteException`：返回当前屏幕亮灭状态。
- `DeviceInfo deviceInfo()`：返回设备基础信息。
- `void waitForIdle(long timeout)`：等待系统空闲，超时单位通常为毫秒。
- `boolean waitForWindowUpdate(String packageName, long timeout)`：等待目标应用窗口刷新。

## 2. 截图与层级抓取

- `String dumpWindowHierarchy(boolean compressed)`：导出当前窗口无格式压缩 XML。
- `String dumpWindowHierarchy(boolean compressed, int maxDepth)`：限制深度导出窗口层级。
- `String takeScreenshot(float scale, int quality)` throws `NotImplementedException`：返回 base64 编码截图。
- `String takeScreenshot(String filename, float scale, int quality)` throws `NotImplementedException`：保存截图到文件并返回路径。

## 3. 点击与文本输入

- `boolean click(int x, int y)`：按坐标点一次。
- `boolean click(int x, int y, long durationMs)`：按住后在指定时长抬起。
- `boolean click(Selector selector)` throws `UiObjectNotFoundException`：按 selector 点击。
- `boolean click(Selector selector, String corner)` throws `UiObjectNotFoundException`：按 selector 指定方位点击。
- `boolean click(String obj)` throws `UiObjectNotFoundException`：按服务端对象 id 点击。
- `boolean click(String obj, String corner)` throws `UiObjectNotFoundException`：按对象 id 指定方位点击。
- `boolean clickAndWaitForNewWindow(Selector selector, long timeout)` throws `UiObjectNotFoundException`：点击 selector 后等待窗口变化。
- `boolean clickAndWaitForNewWindow(String obj, long timeout)` throws `UiObjectNotFoundException`：对象 id 版点击并等待窗口变化。
- `boolean longClick(Selector selector)` throws `UiObjectNotFoundException`：对 selector 长按。
- `boolean longClick(Selector selector, String corner)` throws `UiObjectNotFoundException`：按方位对 selector 长按。
- `boolean longClick(String obj)` throws `UiObjectNotFoundException`：按对象 id 长按。
- `boolean longClick(String obj, String corner)` throws `UiObjectNotFoundException`：按方位对对象 id 长按。
- `void clearInputText()`：清空当前焦点输入框文本。
- `void clearTextField(Selector selector)` throws `UiObjectNotFoundException`：清空指定 selector 对应输入框。
- `void clearTextField(String obj)` throws `UiObjectNotFoundException`：清空对象 id 对应输入框。
- `String getText(Selector selector)` throws `UiObjectNotFoundException`：读取 selector 的文本。
- `String getText(String obj)` throws `UiObjectNotFoundException`：读取对象 id 的文本。
- `boolean setText(Selector selector, String text)` throws `UiObjectNotFoundException`：设置 selector 的文本。
- `boolean setText(String obj, String text)` throws `UiObjectNotFoundException`：设置对象 id 的文本。
- `String getClipboard()`：读取剪贴板文本。
- `void setClipboard(String label, String text)`：设置剪贴板内容。
- `void pasteClipboard()`：执行粘贴动作。

## 4. 拖拽 / 滑动 / 手势

- `boolean swipe(int startX, int startY, int endX, int endY, int steps)`：在屏幕上执行一次线性滑动。
- `boolean swipePoints(int[] points, int segmentSteps)`：按坐标数组执行分段滑动路径。
- `boolean swipe(Selector selector, String dir, float percent, int steps)` throws `UiObjectNotFoundException`：对 selector 进行方向滑动。
- `boolean swipe(Selector selector, String dir, int steps)` throws `UiObjectNotFoundException`：以默认距离方向滑动 selector。
- `boolean swipe(String selectorObj, String dir, int steps)` throws `UiObjectNotFoundException`：对象 id 版方向滑动。
- `boolean drag(int startX, int startY, int endX, int endY, int steps)` throws `NotImplementedException`：坐标拖拽（可能不完全实现）。
- `boolean dragTo(Selector selector, int destX, int destY, int steps)` throws `UiObjectNotFoundException, NotImplementedException`：将 selector 拖拽到指定坐标。
- `boolean dragTo(Selector selector, Selector destSelector, int steps)` throws `UiObjectNotFoundException, NotImplementedException`：将源 selector 拖拽到目标 selector。
- `boolean dragTo(String obj, int destX, int destY, int steps)` throws `UiObjectNotFoundException, NotImplementedException`：对象 id 版拖拽到坐标。
- `boolean dragTo(String obj, Selector destSelector, int steps)` throws `UiObjectNotFoundException, NotImplementedException`：对象 id 版拖拽到目标 selector。
- `boolean gesture(Selector selector, Point p1, Point p2, Point p3, Point p4, int steps)` throws `UiObjectNotFoundException, NotImplementedException`：构造双指手势（起止点四坐标）。
- `boolean gesture(String obj, Point p1, Point p2, Point p3, Point p4, int steps)` throws `UiObjectNotFoundException, NotImplementedException`：对象 id 版双指手势。
- `boolean pinchIn(Selector selector, int percent, int steps)` throws `UiObjectNotFoundException, NotImplementedException`：执行缩小手势。
- `boolean pinchIn(String obj, int percent, int steps)` throws `UiObjectNotFoundException, NotImplementedException`：对象 id 版缩小手势。
- `boolean pinchOut(Selector selector, int percent, int steps)` throws `UiObjectNotFoundException, NotImplementedException`：执行放大手势。
- `boolean pinchOut(String obj, int percent, int steps)` throws `UiObjectNotFoundException, NotImplementedException`：对象 id 版放大手势。
- `boolean flingForward(Selector selector, boolean isVertical)` throws `UiObjectNotFoundException`：快速向前惯性滚动。
- `boolean flingBackward(Selector selector, boolean isVertical)` throws `UiObjectNotFoundException`：快速向后惯性滚动。
- `boolean flingToBeginning(Selector selector, boolean isVertical, int maxSwipes)` throws `UiObjectNotFoundException`：快速滚动到起始端。
- `boolean flingToEnd(Selector selector, boolean isVertical, int maxSwipes)` throws `UiObjectNotFoundException`：快速滚动到末端。
- `boolean scrollForward(Selector selector, boolean isVertical, int steps)` throws `UiObjectNotFoundException`：向前滚动。
- `boolean scrollBackward(Selector selector, boolean isVertical, int steps)` throws `UiObjectNotFoundException`：向后滚动。
- `boolean scrollTo(Selector selector, Selector targetSelector, boolean isVertical)` throws `UiObjectNotFoundException`：在容器内滚动到目标控件。
- `boolean scrollToBeginning(Selector selector, boolean isVertical, int maxSwipes, int steps)` throws `UiObjectNotFoundException`：滚动到顶部或左侧起始位置。
- `boolean scrollToEnd(Selector selector, boolean isVertical, int maxSwipes, int steps)` throws `UiObjectNotFoundException`：滚动到底部或右侧末端位置。
- `boolean injectInputEvent(int action, float x, float y, int metaState)`：透传输入事件到底层注入。

## 5. 查找与对象处理

- `boolean exist(Selector selector)`：判断 selector 是否存在。
- `boolean exist(String obj)`：判断对象 id 是否仍然可用。
- `int count(Selector selector)`：统计匹配对象数量。
- `ObjInfo objInfo(Selector selector)` throws `UiObjectNotFoundException`：获取 selector 对象快照。
- `ObjInfo objInfo(String obj)` throws `UiObjectNotFoundException`：获取对象 id 的快照。
- `ObjInfo[] objInfoOfAllInstances(Selector selector)`：批量获取匹配对象快照。
- `String getUiObject(Selector selector)` throws `UiObjectNotFoundException`：创建一个服务端对象句柄（UUID）。
- `String getChild(String obj, Selector selector)` throws `UiObjectNotFoundException`：基于已知对象获取其子节点并返回句柄。
- `String getFromParent(String obj, Selector selector)` throws `UiObjectNotFoundException`：基于对象与选择器从父节点逻辑取子对象。
- `void removeUiObject(String obj)`：移除对象缓存句柄。
- `String[] getUiObjects()`：列出当前仍在管理的对象句柄。
- `String childByText(Selector collection, Selector child, String text)` throws `UiObjectNotFoundException`：按文本在集合中查找子节点并返回句柄。
- `String childByText(Selector collection, Selector child, String text, boolean allowScrollSearch)` throws `UiObjectNotFoundException`：支持滚动搜索的文本查找。
- `String childByDescription(Selector collection, Selector child, String text)` throws `UiObjectNotFoundException`：按 content-desc 查找子节点。
- `String childByDescription(Selector collection, Selector child, String text, boolean allowScrollSearch)` throws `UiObjectNotFoundException`：支持滚动的内容描述查找。
- `String childByInstance(Selector collection, Selector child, int instance)` throws `UiObjectNotFoundException`：按实例序号定位子节点。

## 6. 等待类

- `boolean waitForExists(Selector selector, long timeout)`：等待 selector 出现。
- `boolean waitForExists(String obj, long timeout)` throws `UiObjectNotFoundException`：等待对象 id 出现。
- `boolean waitUntilGone(Selector selector, long timeout)` throws `UiObjectNotFoundException`：等待 selector 消失。
- `boolean waitUntilGone(String obj, long timeout)` throws `UiObjectNotFoundException`：等待对象 id 消失。

## 7. 按键与系统行为

- `boolean pressKey(String key)` throws `RemoteException`：按键名称触发按键事件。
- `boolean pressKeyCode(int keyCode)`：按 keycode 触发按键。
- `boolean pressKeyCode(int keyCode, int metaState)`：带 meta 的 keycode 触发。
- `void setOrientation(String direction)` throws `RemoteException, NotImplementedException`：设置方向锁定模式。
- `void freezeRotation(boolean freeze)` throws `RemoteException`：冻结或解冻旋转。
- `boolean openNotification()` throws `NotImplementedException`：打开通知面板。
- `boolean openQuickSettings()` throws `NotImplementedException`：打开快速设置面板。
- `ConfiguratorInfo getConfigurator()` throws `NotImplementedException`：读取配置参数。
- `ConfiguratorInfo setConfigurator(ConfiguratorInfo info)` throws `NotImplementedException`：设置并返回配置快照。
- `void clearLastToast()`：清空最近一次 toast 记录。
- `String getLastToast()`：获取最近一次 toast 文本。
- `String getLastTraversedText()`：获取最近一次无障碍遍历文本。
- `void clearLastTraversedText()`：清空遍历文本缓存。

## 8. Watcher

- `void registerClickUiObjectWatcher(String name, Selector[] conditions, Selector target)`：注册点击型 watcher。
- `void registerPressKeyskWatcher(String name, Selector[] conditions, String[] keys)`：注册按键型 watcher。
- `void removeWatcher(String name)`：移除 watcher。
- `void runWatchers()`：手动触发一次 watcher 执行。
- `boolean hasWatcherTriggered(String name)`：检查某个 watcher 是否触发。
- `boolean hasAnyWatcherTriggered()`：检查任意 watcher 是否触发。
- `String[] getWatchers()`：获取已注册 watcher 名称。
- `void resetWatcherTriggers()`：清空所有触发状态。

## 9. Shell

- `ShellCommandResult executeShellCommand(String command, long timeout)`：执行 shell 命令并返回标准输出、错误和返回码。该接口用于所有需要下发 adb shell 的场景，优先统一走该接口。

## 示例（JSON-RPC）

```bash
curl -sS -X POST http://127.0.0.1:9008/jsonrpc/0 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id": 1,
    "method":"click",
    "params": {
      "obj": {
        "resourceId": "com.example:id/btn_ok",
        "text": "确定"
      }
    }
  }'
```
