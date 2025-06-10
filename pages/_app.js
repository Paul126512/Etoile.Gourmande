// pages/_app.js
import React from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";

export default function MyApp({ Component, pageProps }) {
  return (
    <>
      <Component {...pageProps} />
      {/* Composant de collecte des statistiques de visiteurs */}
      <Analytics />

      {/* Composant de collecte des métriques de performance */}
      <SpeedInsights />
    </>
  );
}
