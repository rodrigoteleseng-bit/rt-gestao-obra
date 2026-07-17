// Recuperação de clientes que ficaram presos no index do deploy 7098fd9.
// Este caminho era o bundle principal e agora limpa o PWA antigo antes de recarregar.
(async () => {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map(registration => registration.unregister()))
    }
    if ('caches' in window) {
      const names = await caches.keys()
      await Promise.all(names.map(name => caches.delete(name)))
    }
  } finally {
    const url = new URL(window.location.href)
    url.searchParams.set('pwa-recovery', Date.now().toString())
    window.location.replace(url.toString())
  }
})()
