/// <reference types="@cloudflare/workers-types" />

interface Env {
  RED_CONTACTOS_WORKER: Fetcher;
}

/**
 * Same-origin API gateway for Cloudflare Pages.
 *
 * The Request is forwarded unchanged to the existing Worker so that method,
 * URL/query string, headers, body, and response remain owned by the Worker.
 */
export const onRequest: PagesFunction<Env> = ({ request, env }) => {
  if (!env.RED_CONTACTOS_WORKER) {
    return Response.json(
      {
        error: 'api_binding_unavailable',
        message: 'La API no está configurada en este despliegue de Pages.',
      },
      { status: 503 }
    );
  }

  return env.RED_CONTACTOS_WORKER.fetch(request);
};
