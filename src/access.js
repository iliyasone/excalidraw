// Доступ по ссылке: страница /s/<токен> открывает одну доску без пароля, и все запросы
// к API идут тогда с ?share=<токен> вместо ?file=<имя> — доску сервер берёт из токена.
export const share = /^\/s\/([\w-]+)$/.exec(location.pathname)?.[1] ?? null;
export const boardQuery = (file) => (share ? `share=${share}` : `file=${encodeURIComponent(file)}`);
