# Fútbol en vivo — plugin de Kino

Partidos de fútbol y canales deportivos dentro de la pestaña **En vivo** de Kino:
Champions League, Europa League, La Liga, Premier League, Serie A, Bundesliga,
Ligue 1, Liga MX, Brasileirão, Liga Profesional y el resto de ligas de Sudamérica.

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

Todo aparece en **En vivo**, en tres secciones con el nombre del plugin:

- **Partidos en vivo**: solo los partidos que ya comenzaron (o que empiezan en los
  próximos 10 minutos).
- **Próximos partidos**: los partidos de la agenda que todavía no empiezan. Si tocas uno
  antes de la hora, Kino avisa a qué hora comienza en vez de abrir una señal muerta.
- **Canales deportivos**: ESPN, DSports, Fox Sports, TNT Sports, TyC Sports, Win Sports,
  DAZN, LaLiga TV, Movistar Deportes, TUDN, Azteca Deportes y el resto del directorio,
  para ver deportes cuando no hay partidos.

Cada partido lleva su carátula (competición, equipos, hora y fecha) y cada canal su logo.
La búsqueda de En vivo encuentra equipos y canales por nombre y la guía de TV muestra a
qué hora empieza cada partido.

No se listan partidos de fútbol femenino.

## Cómo funciona

1. Lee la agenda de `pelotalibre.biz` y se queda solo con los partidos de fútbol.
2. Cada partido ofrece varias fuentes; el plugin prueba una por una y devuelve la señal
   que realmente está emitiendo (comprueba que el manifiesto HLS responda antes de
   entregarlo).
3. Los canales se resuelven igual, pero por el endpoint de canales del sitio.

## Estructura

```
kino-plugin.json   manifiesto (id, hosts, capacidades)
plugin.js          código del plugin (un solo archivo, sin dependencias)
icon.png           icono 96×96
```
