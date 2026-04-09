/* Firebase Cloud Messaging Service Worker */
importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js");

// Config is injected at registration time via query params from the client
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "FIREBASE_CONFIG") {
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(event.data.config);
      }
      const messaging = firebase.messaging();

      messaging.onBackgroundMessage((payload) => {
        const { title, body, icon } = payload.notification ?? {};
        const data = payload.data ?? {};
        self.registration.showNotification(title || "OnlyTwo", {
          body: body || "",
          icon: icon || "/favicon.svg",
          badge: "/favicon.svg",
          data: { url: data.url || "/" },
          vibrate: [100, 50, 100],
          tag: "onlytwo-message",
          renotify: true,
        });
      });
    } catch {}
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(url));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
