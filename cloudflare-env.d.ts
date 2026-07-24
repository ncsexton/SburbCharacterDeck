interface Fetcher {
  fetch(input: Request): Promise<Response>;
}

interface D1Database {}

declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
  };
}
