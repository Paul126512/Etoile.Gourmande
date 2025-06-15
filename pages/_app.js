// Polyfill pour les imports ES Modules
import('isomorphic-fetch'); // npm install isomorphic-fetch

const { Analytics } = require('@vercel/analytics/react');
const { SpeedInsights } = require('@vercel/speed-insights');

module.exports = function App({ Component, pageProps }) {
  return (
    <>
      <Component {...pageProps} />
      <Analytics />
      <SpeedInsights />
    </>
  );
}
