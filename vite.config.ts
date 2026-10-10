import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const DEFAULT_REMOTE_API = 'https://red-de-contactos.pages.dev';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const remoteApiTarget = env.VITE_API_PROXY_TARGET || DEFAULT_REMOTE_API;
  const remoteApiOrigin = new URL(remoteApiTarget).origin;

  return {
    plugins: [react()],

    server: {
      proxy: {
        '/api': {
          target: remoteApiTarget,
          changeOrigin: true,
          secure: true,
          cookieDomainRewrite: '',
          configure(proxy) {
            proxy.on('proxyReq', (proxyRequest) => {
              // The Worker validates Origin against the URL it receives.
              // Vite must present the remote Pages origin while proxying;
              // the browser still talks only to localhost.
              proxyRequest.setHeader('Origin', remoteApiOrigin);
            });

            proxy.on('proxyRes', (proxyResponse) => {
              const setCookies = proxyResponse.headers['set-cookie'];

              if (Array.isArray(setCookies)) {
                // The remote Worker correctly emits Secure cookies. The local
                // HTTP dev server needs the flag removed so localhost can keep
                // the same-origin session cookie. This only affects Vite's
                // development proxy; production responses are unchanged.
                proxyResponse.headers['set-cookie'] = setCookies.map((cookie) =>
                  cookie.replace(/;\s*Secure/gi, '')
                );
              }
            });
          },
        },
      },
    },
  };
});
