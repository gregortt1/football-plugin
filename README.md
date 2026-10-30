# Fútbol en vivo — plugin de Kino

Partidos y canales deportivos dentro de la pestaña **En vivo** de Kino: Champions
League, Europa League, La Liga, Premier League, Serie A, Bundesliga, Ligue 1, Liga MX,
Brasileirão, Liga Profesional y el resto de ligas de Sudamérica, más el directorio de
canales deportivos para cuando no hay partidos.

## Cómo se instala

1. Abre Kino y entra en **Plugins** (menú ☰ en el teléfono, Ajustes en la TV).
2. Toca **+** y escribe la dirección del repositorio:

   ```
   gregortt1/football-plugin
   ```

3. Acepta e instala (Kino avisa que el plugin agrega canales en vivo).

Este repositorio **no está publicado en la tienda de Kino**: solo se instala escribiendo
la dirección de arriba.

## Qué muestra

Todo vive en **En vivo**, en tres categorías con el nombre del plugin:

- **Partidos en vivo**: solo los partidos que ya empezaron (o que empiezan en los próximos
  10 minutos) y todavía no terminaron. Nada de partidos que arrancan más tarde: si no
  empezó, no aparece acá.
- **Canales deportivos**: ESPN, DSports, Fox Sports, TNT Sports, TyC Sports, Win Sports,
  DAZN, LaLiga TV, Movistar Deportes, TUDN, Azteca Deportes y el resto del directorio.
  Siempre está: si no hay partidos a esta hora, acá hay algo que ver.
- **Próximos partidos**: la agenda que todavía no empieza, con la hora delante
  (`15:00 · Le Havre vs PSG`) y `mañana` cuando el partido cae después de medianoche.
  Si lo abres antes de la hora, Kino dice a qué hora empieza en vez de abrir una señal muerta.

Cada partido lleva su carátula: el escudo del equipo local (o el del visitante si falta) y,
cuando el club no está en el mapa de escudos, la tarjeta del partido con competición, equipos,
hora y fecha. Cada canal lleva su logo.

La búsqueda de En vivo encuentra equipos y canales por nombre, sin acentos y sin importar
mayúsculas, y la guía de TV muestra a qué hora empieza cada partido.

No se listan partidos de fútbol femenino, ni deportes que no son fútbol (pádel, tenis, F1,
NBA, NFL, MLB, MotoGP, boxeo, golf y compañía), aunque la agenda del sitio los incluya.

## Cómo funciona

1. Lee la agenda de `pelotalibre.biz` y se queda solo con los partidos de fútbol.
2. Un mismo partido aparece repetido en la agenda bajo dos competiciones
   (`Saudi Pro League` / `Pro League`) o con dos formas del nombre
   (`Sheffield United` / `Sheffield Utd`): se comparan los nombres normalizados y los
   equipos del mismo horario, y queda una sola tarjeta, la que tiene más fuentes.
3. Cada partido ofrece varias fuentes; el plugin prueba una por una y devuelve la señal
   que realmente está emitiendo (comprueba que el manifiesto HLS responda antes de
   entregarlo).
4. Los canales se resuelven igual, pero por el endpoint de canales del sitio.

## Las carátulas

Cada partido lleva una carátula cuadrada con los dos equipos (`Le Havre / vs / PSG`) sobre un
color que se repite para toda la competición: el mismo tono para todos los partidos de Ligue 1,
otro para LaLiga, otro para el Brasileirão. La dibuja un servicio de imágenes a partir del
nombre, así que no hay tabla de escudos que mantener ni una foto que se rompa cuando cambia un
equipo. Los escudos reales de los clubes no están todavía: el sitio no los publica, y el mapa
de escudos quedó pendiente de una fuente que aguante consultas (ver más abajo).

## Probar sin la app

El kit oficial del SDK corre el plugin como lo hace Kino (sandbox QuickJS, sin `fetch` ni
`require`, con las reglas de verdad del manifiesto):

```
node sdk/validate.mjs .
node sdk/run.mjs . live categories
node sdk/run.mjs . live channels vivo
node sdk/run.mjs . live channels canales
node sdk/run.mjs . live channels proximos
node sdk/run.mjs . live search boca
node sdk/run.mjs . live guide m-le-havre-vs-psg
node sdk/run.mjs . resolve 'm~le-havre-vs-psg~1793383200000~10403'
```

`kino.d.ts` está ahí para el editor. El kit escribe `.kino-cookies.json` y
`.kino-shared.json`: los dos están en `.gitignore`.

## Estructura

```
kino-plugin.json   manifiesto (id, hosts, capacidades)
plugin.js          código del plugin (un solo archivo, sin dependencias) + mapa de escudos
icon.png           icono 96×96
sdk/               kit de pruebas de Kino (no lo usa la app)
kino.d.ts          tipos del objeto kino
contract.json      contrato del kit
```
