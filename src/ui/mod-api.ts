export interface ModHost {
  apiVersion: number;
  editor: unknown;
  runtime: unknown;
  manager: unknown;
  resolveModule(loadId: string, specifier: string, from: string): string;
  disableAll(): Promise<void>;
}

let provider: ModHost | null = null;
export const apiVersion = 1;
export function installModApi(value: ModHost): void { provider = value; }
export function getModHost(): ModHost { if (!provider) throw Error('模组接口尚未就绪'); return provider; }
export function getEditor(): unknown { return getModHost().editor; }
export default getEditor;
