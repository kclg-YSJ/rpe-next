const { randomUUID } = require('node:crypto');
const { bitmapFormat, capturePixels, validateFence, matchesFence } = require('./editor-capture-pixels.cjs');

// Full client-area pixels, one capture in flight. No polling or bitmap cache.
function installEditorCapture({ ipcMain, window, origin, nativeImage }) {
  let task = null;
  const end = () => {
    const previous = task; task = null;
    if (previous && !previous.contents.isDestroyed()) previous.contents.setBackgroundThrottling(previous.throttling);
  };
  ipcMain.handle('rpen-editor-capture', async (event, action, id) => {
    try {
      const contents = window()?.webContents;
      if (event.sender !== contents || event.senderFrame !== contents.mainFrame || !event.senderFrame.url.startsWith(origin + '/')) throw Error('无权限');
      if (action === 'begin') {
        if (task) throw Error('已有编辑器录制任务');
        const format = id?.raw === true ? bitmapFormat(nativeImage) : null;
        task = { id: randomUUID(), contents, throttling: contents.getBackgroundThrottling(), busy: false, format };
        contents.setBackgroundThrottling(false);
        return { ok: true, result: { id: task.id, format: format ?? 'png', fence: true } };
      }
      const token = typeof id === 'object' && id ? id.id : id;
      if (!task || task.id !== token || task.contents !== contents) throw Error('录制任务已结束');
      if (action === 'end') { end(); return { ok: true }; }
      if (action !== 'frame' || task.busy) throw Error('截图请求无效');
      const fence = typeof id === 'object' ? id.fence : null;
      validateFence(fence);
      const current = task; current.busy = true;
      try {
        const deadline = performance.now() + 5000;
        for (;;) {
          const image = await contents.capturePage(undefined, { stayHidden: true, stayAwake: true });
          if (task !== current || image.isEmpty()) throw Error('编辑器画面不可用');
          const result = capturePixels(image, current.format);
          const bitmap = fence ? result.format !== 'png' ? result.bytes : image.toBitmap() : null;
          if (fence && bitmap.length !== result.width * result.height * 4) throw Error('无法校验编辑器当前帧的像素尺寸');
          if (!fence || matchesFence(bitmap, result.width, result.height, fence)) return { ok: true, result };
          if (performance.now() >= deadline) throw Error('编辑器当前帧未完成合成，请保持窗口可见后重试');
        }
      } finally { current.busy = false; }
    } catch (error) { return { ok: false, error: error.message }; }
  });
  return end;
}
module.exports = { installEditorCapture };
