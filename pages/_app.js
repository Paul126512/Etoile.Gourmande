// pages/_app.js
import React from "react";
import { Analytics } from "@vercel/analytics/react"; // Pour Vercel Analytics (statistiques de visiteurs)
import { SpeedInsights } from "@vercel/speed-insights/react"; // Pour Vercel Speed Insights (métriques de performance)

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
