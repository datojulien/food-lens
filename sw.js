const CACHE = 'foodlens-app-v9';
const ASSETS = ['./','./index.html','./styles.css?v=9','./app.mjs?v=9','./scores.mjs?v=9','./manifest.webmanifest','./icons/favicon.svg','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name.startsWith('foodlens-app-')&&name!==CACHE).map(name=>caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return; // Never cache external product queries.
  const scope=new URL(self.registration.scope).pathname;
  if(!url.pathname.startsWith(scope))return;
  const executable=/\.(?:mjs|js|css)$/.test(url.pathname);
  const navigation=event.request.mode==='navigate';
  event.respondWith((async()=>{
    try {
      const response=await fetch(event.request, {cache:(executable||navigation)?'no-store':'default'});
      if(response.ok){const c=await caches.open(CACHE); c.put(event.request,response.clone()).catch(()=>{});}
      return response;
    } catch(err){
      const cached=await caches.match(event.request);
      if(cached)return cached;
      if(navigation)return (await caches.match('./index.html'))||Response.error();
      return Response.error(); // Never serve index.html as a JS module.
    }
  })());
});
