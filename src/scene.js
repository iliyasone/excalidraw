// Загрузка доски: сцена без картинок одним запросом, картинки — отдельными (их кэширует браузер).
const toDataURL = (blob) => new Promise((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.readAsDataURL(blob);
});

export async function fetchScene(file, client) {
  const q = `file=${encodeURIComponent(file)}${client ? `&client=${client}` : ""}`;
  return (await fetch(`/api/scene?${q}&lite=1`)).json();
}

// Дописывает dataURL в scene.files; onFile вызывается по мере загрузки каждой картинки.
export function fetchFiles(file, scene, onFile) {
  return Promise.all(Object.values(scene.files || {}).map(async (meta) => {
    const r = await fetch(`/api/file?file=${encodeURIComponent(file)}&id=${encodeURIComponent(meta.id)}`);
    if (!r.ok) return;
    const data = { ...meta, dataURL: await toDataURL(await r.blob()) };
    scene.files[meta.id] = data;
    onFile?.(data);
  }));
}
