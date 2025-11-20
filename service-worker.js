self.addEventListener("install", () => {
    console.log("Service Worker instalado");
});

self.addEventListener("activate", () => {
    console.log("Service Worker ativo");
});

self.addEventListener("fetch", () => {});
