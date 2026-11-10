// Public loader for the pinned, bundled CanvasKit build.
let ready;
export function loadCanvasKit() {
  if (!ready) ready = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('./canvaskit.js', import.meta.url).href;
    script.onerror = () => reject(new Error('CanvasKit script failed to load'));
    script.onload = () => CanvasKitInit({locateFile: name => new URL(name, import.meta.url).href}).then(resolve, reject);
    document.head.append(script);
  });
  return ready;
}
