// Действия над досками: переименовать, архив, вернуть, удалить. Общие для списка досок и редактора.
const post = async (action, body) => {
  const r = await fetch(`/api/boards/${action}`, { method: "POST", body: JSON.stringify(body) });
  const out = await r.json();
  if (!r.ok) {
    alert(out.error || "Не получилось");
    return null;
  }
  return out;
};

export const title = (file) => file.replace(/\.excalidraw$/, "");

// Возвращает новое имя файла или null, если передумали или сервер отказал.
export async function renameBoard(file) {
  const name = prompt("Новое имя доски", title(file));
  if (!name || name.trim() === title(file)) return null;
  return (await post("rename", { file, name }))?.file ?? null;
}

export async function archiveBoard(file) {
  if (!confirm(`Убрать «${title(file)}» в архив? Вернуть можно со страницы «Все доски».`)) return false;
  return Boolean(await post("archive", { file }));
}

export const restoreBoard = async (file) => Boolean(await post("restore", { file }));

export async function deleteBoard(file) {
  if (!confirm(`Удалить «${title(file)}» насовсем?`)) return false;
  return Boolean(await post("delete", { file }));
}
