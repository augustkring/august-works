import { api, type RequestOptions } from "./client";

export type BoardPrincipal = `user:${string}` | "local-board";

/** Each client captures one account. Paths also partition in-flight GETs. */
export function createAccountClient(principalId: BoardPrincipal): typeof api {
  const bind = (path: string) => {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("#")) {
      throw new Error("Account-bound requests require an API path");
    }
    const queryAt = path.indexOf("?");
    const pathname = queryAt < 0 ? path : path.slice(0, queryAt);
    const query = queryAt < 0 ? "" : path.slice(queryAt + 1);
    const params = new URLSearchParams(query);
    if (params.has("expectedActorId")) throw new Error("Account binding is already set");
    params.set("expectedActorId", principalId);
    return `${pathname}?${params}`;
  };
  return {
    get: <T>(path: string, options?: RequestOptions) => api.get<T>(bind(path), options),
    post: <T>(path: string, body: unknown, options?: RequestOptions) => api.post<T>(bind(path), body, options),
    postForm: <T>(path: string, body: FormData, options?: RequestOptions) => api.postForm<T>(bind(path), body, options),
    put: <T>(path: string, body: unknown, options?: RequestOptions) => api.put<T>(bind(path), body, options),
    putRaw: <T>(path: string, body: Blob, options?: RequestOptions) => api.putRaw<T>(bind(path), body, options),
    patch: <T>(path: string, body: unknown, options?: RequestOptions) => api.patch<T>(bind(path), body, options),
    delete: <T>(path: string, bodyOrOptions?: unknown, options?: RequestOptions) => api.delete<T>(bind(path), bodyOrOptions, options),
    deleteWithBody: <T>(path: string, body: unknown, options?: RequestOptions) => api.deleteWithBody<T>(bind(path), body, options),
  };
}
