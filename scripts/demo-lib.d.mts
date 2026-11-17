// Types for scripts/demo-lib.mjs, which node runs as plain JavaScript.

type Values = Record<string, string>;

export declare const DEMO_DATABASE: string;
export declare const DEMO_ROLE: string;
export declare const DEMO_ADMIN_ID: string;
export declare const STRIPE_MOCK_IMAGE: string;
export declare const POSTGRES_IMAGE: string;
export declare const HIDE_ENV_PRELOAD: string;

export type DemoSecrets = {
  AUTH_SECRET: string;
  WEBHOOK_SECRET: string;
  CRON_SECRET: string;
  PG_PASSWORD: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
};

export declare function vapidKeys(): { publicKey: string; privateKey: string };
export declare function demoSecrets(saved?: Partial<Values>): DemoSecrets;
export declare function parseEnvFile(text: string): Values;
export declare function formatEnvFile(values: Values): string;
export declare function demoEnv(options: {
  shell: Readonly<Record<string, string | undefined>>;
  secrets: DemoSecrets;
  databaseUrl: string;
  port: number;
  stripeMockUrl: string | null;
}): Values;
export declare function databaseUrl(options: {
  host: string;
  port: number;
  password: string;
}): string;
export declare function buildKey(options: {
  commit: string;
  changes: string;
  day: string;
  port: number;
  database: string;
}): string;
