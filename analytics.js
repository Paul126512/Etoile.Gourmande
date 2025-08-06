// analytics.js

(function() {
  const GA_MEASUREMENT_ID = 'G-HX3DHVEPGT';

  // Crée la balise <script> pour charger gtag.js
  const scriptTag = document.createElement('script');
  scriptTag.async = true;
  scriptTag.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(scriptTag);

  // Initialise la dataLayer et configure Google Analytics
  window.dataLayer = window.dataLayer || [];
  function gtag(){ dataLayer.push(arguments); }

  gtag('js', new Date());
  gtag('config', GA_MEASUREMENT_ID);
})();
