# Compositor de escudos

Kino pide **una sola imagen** por canal en En vivo, así que no puede mostrar los dos escudos de
un partido: el plugin manda el del equipo local. Este Worker de Cloudflare toma los dos y los
devuelve como un único PNG de 600×300, con el local a la izquierda y el visitante a la derecha,
fondo transparente.

```
https://tu-worker.workers.dev/?a=<escudo local>&b=<escudo visitante>
```

No lleva dependencias, ni clave, ni bindings: decodifica y codifica PNG con
`DecompressionStream` / `CompressionStream` del propio runtime. Solo descarga imágenes de
`a.espncdn.com` (la lista `ALLOWED`), así que no se puede apuntar a otro sitio. Cada composición
se guarda un día en el cache de Cloudflare: la segunda visita de la misma imagen no cuesta nada.

## Ponerlo en marcha

1. Entrá en <https://dash.cloudflare.com> y creá una cuenta (la gratuita sirve para probar).
2. En una terminal, dentro de esta carpeta:

   ```
   cd football-plugin/worker
   npx wrangler login      # abre el navegador una vez
   npx wrangler deploy
   ```

3. `wrangler` imprime la dirección, algo como
   `https://crest-composer.TU-SUBDOMINIO.workers.dev`. Probalá:

   ```
   https://crest-composer.TU-SUBDOMINIO.workers.dev/?a=https%3A%2F%2Fa.espncdn.com%2Fi%2Fteamlogos%2Fsoccer%2F500%2F15720.png&b=https%3A%2F%2Fa.espncdn.com%2Fi%2Fteamlogos%2Fsoccer%2F500%2F8931.png
   ```

4. En Kino: **Plugins ▸ Fútbol en vivo ▸ Configurar ▸ Compositor de escudos**, pegá esa
   dirección y guardá. Los partidos pasan a mostrar los dos escudos.

## Sobre el plan

Componer una imagen cuesta CPU: en la prueba local son ~40-80 ms por partido. El plan gratuito
de Workers corta a los 10 ms de CPU por ejecución, así que lo más probable es que te devuelva
error 1102 ("Worker exceeded CPU time limit"). El plan pago de Workers son 5 dólares al mes y
no tiene ese problema. Si no querés pagar nada, dejá el ajuste vacío y el plugin sigue andando
con el escudo del local.

## Probar sin desplegar

`wrangler dev` lo corre local. La lógica de composición también se puede probar desde Node:

```js
const mod = await import("./crest-worker.js");
const png = await mod.compose(await mod.decodePng(bytesA), await mod.decodePng(bytesB));
```
