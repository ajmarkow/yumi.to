export {};

declare global {
  interface Shortlink {
    id: string;
    short: string;
    link: string;
    created_at?: string;
  }
}
