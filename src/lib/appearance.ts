export type Appearance = "system" | "light" | "dark";
declare global { interface Window { FilesAppearance: { get(): Appearance; set(value: string): void; identify(user: string): void } } }
export const appearance = window.FilesAppearance;
